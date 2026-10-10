import type { FastifyPluginCallback } from "fastify";
import { z } from "zod";
import type { UploadResponse } from "@nexus/shared";
import {
  getDocument,
  getExtraction,
  listCompletedForExport,
  listDocuments,
  listEvents,
  transitionStatus,
  type DocumentRow,
} from "@nexus/shared/node";
import { batchLimitError, HttpError } from "../errors.js";
import { parseStoredResult, toDetail, todayUtc, toSummary } from "../services/dto.js";
import { toCsv } from "../services/csv.js";
import { enqueueOrDefer } from "../services/enqueue.js";
import { EXPORT_COLUMNS, exportCells } from "../services/export.js";
import { storeUpload, type UploadDeps } from "../services/upload.js";

const UTF8_BOM = "\uFEFF";

const ListQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) });
const IdParams = z.object({ id: z.uuid() });

export interface DocumentRouteDeps extends UploadDeps {
  clock: () => Date;
}

export const documentRoutes: FastifyPluginCallback<DocumentRouteDeps> = (app, deps, done) => {
  const { db, clock } = deps;

  app.post("/documents", async (request, reply) => {
    const body: UploadResponse = { accepted: [], rejected: [] };
    try {
      // One file at a time: each is streamed to disk before the next part is read.
      for await (const part of request.files()) {
        const outcome = await storeUpload(deps, part, request.log);
        if ("accepted" in outcome) body.accepted.push(outcome.accepted);
        else body.rejected.push(outcome.rejected);
      }
    } catch (err) {
      const limit = batchLimitError(err);
      if (!limit) throw err;
      body.error = limit;
    }
    if (body.accepted.length === 0 && body.rejected.length === 0 && !body.error) {
      body.error = { code: "NO_FILES", message: "No files in request" };
    }
    return reply.status(body.accepted.length > 0 ? 202 : 400).send(body);
  });

  app.get("/documents", (request) => {
    const { limit } = ListQuery.parse(request.query);
    const today = todayUtc(clock());
    return listDocuments(db, { limit }).map((row) =>
      toSummary(row, parseStoredResult(row.result_json, row.id, request.log), today),
    );
  });

  // Registered before /documents/:id, so export.csv is never read as an id.
  app.get("/documents/export.csv", (request, reply) => {
    const today = todayUtc(clock());
    const rows = listCompletedForExport(db).map((row) =>
      exportCells(row, parseStoredResult(row.result_json, row.id, request.log), today),
    );
    return (
      reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="contracts-${today}.csv"`)
        // Excel reads a csv without a BOM in the local ANSI codepage and mangles non-ascii vendor names.
        .send(UTF8_BOM + toCsv(EXPORT_COLUMNS, rows))
    );
  });

  app.get("/documents/:id", (request) => {
    const { id } = IdParams.parse(request.params);
    const row = getDocument(db, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "Document not found");
    const extraction = row.latest_extraction_id
      ? getExtraction(db, row.latest_extraction_id)
      : undefined;
    return toDetail(row, extraction, listEvents(db, id), request.log, todayUtc(clock()));
  });

  app.post("/documents/:id/retry", async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const row = getDocument(db, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "Document not found");
    if (!isRetryable(row)) {
      throw new HttpError(
        409,
        "NOT_RETRYABLE",
        `A ${describeState(row)} document cannot be retried`,
      );
    }

    // Guarded on the status we just read: if a worker or another retry got there first, this matches nothing.
    const moved = transitionStatus(db, id, "queued", {
      from: row.status,
      bumpRun: true,
      resetAttempts: true,
      // The new run decides review again.
      needs_review: false,
    });
    if (!moved) throw new HttpError(409, "NOT_RETRYABLE", "Document changed while retrying");

    const run = row.run + 1;
    // Still 202 when this fails: the row stays queued and the reconciler delivers it.
    const enqueue = await enqueueOrDefer(deps, id, run);
    if (enqueue.enqueued) {
      request.log.info({ documentId: id, run, from: row.status }, "retry queued");
    } else {
      request.log.warn(
        { documentId: id, run, from: row.status, err: enqueue.err },
        "retry left queued, queue unavailable",
      );
    }
    const updated = getDocument(db, id);
    if (!updated) throw new Error(`document ${id} vanished after retry`);
    // queued has no extraction worth showing yet; the old one comes back via the detail endpoint.
    return reply.status(202).send(toSummary(updated, null, todayUtc(clock())));
  });

  done();
};

function isRetryable(row: DocumentRow): boolean {
  return row.status === "failed" || (row.status === "completed" && row.needs_review === 1);
}

function describeState(row: DocumentRow): string {
  return row.status === "completed" ? "completed (not needing review)" : row.status;
}
