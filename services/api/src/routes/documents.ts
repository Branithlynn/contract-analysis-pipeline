import type { FastifyPluginCallback } from "fastify";
import { z } from "zod";
import { LlmProviderName, ModelSelectionSchema, type UploadResponse } from "@nexus/shared";
import {
  defaultModelSelection,
  getDocument,
  getExtraction,
  getExtractionForRun,
  insertEvent,
  listCompletedForExport,
  listDocuments,
  listEvents,
  listExtractionsForDocument,
  listFailedRuns,
  selectionOr,
  transitionStatus,
  type DocumentRow,
  type ModelSelection,
} from "@nexus/shared/node";
import { batchLimitError, HttpError } from "../errors.js";
import {
  readContext,
  readStoredResult,
  sourceOfListRow,
  toDetail,
  toSummary,
} from "../services/dto.js";
import { toCsv } from "../services/csv.js";
import { enqueueOrDefer } from "../services/enqueue.js";
import { EXPORT_COLUMNS, exportCells } from "../services/export.js";
import type { ModelCatalog } from "../services/models.js";
import { storeUpload, type UploadDeps } from "../services/upload.js";
import type { Config } from "@nexus/shared/node";

const UTF8_BOM = "﻿";

const ListQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) });
const IdParams = z.object({ id: z.uuid() });
// The detail shows the latest run unless another one is asked for, for comparing models.
const DetailQuery = z.object({ run: z.coerce.number().int().min(1).optional() });

// Upload takes the model as query parameters: the body is files only (the multipart limits allow
// no text field). Both or neither, half a selection is a mistake and not a request for a default.
const UploadQuery = z
  .object({
    provider: LlmProviderName.optional(),
    model: z.string().trim().min(1).max(200).optional(),
  })
  .refine((q) => (q.provider === undefined) === (q.model === undefined), {
    message: "provider and model have to be given together",
  });

// Retry keeps the model the document had unless the body names another one.
const RetryBody = ModelSelectionSchema.nullish();

export interface DocumentRouteDeps extends UploadDeps {
  config: UploadDeps["config"] &
    Pick<Config, "GROUNDING_REVIEW_THRESHOLD" | "LLM_PROVIDER" | "LLM_MODEL">;
  models: ModelCatalog;
  clock: () => Date;
}

export const documentRoutes: FastifyPluginCallback<DocumentRouteDeps> = (app, deps, done) => {
  const { db, clock, models } = deps;
  const context = () => readContext(clock(), deps.config.GROUNDING_REVIEW_THRESHOLD);
  const defaultModel = defaultModelSelection(deps.config);

  // A model named in a request is checked against what is available at this moment. The default
  // from the environment is not: with ollama down for a minute an upload is still accepted and
  // the job retries, as it always did.
  async function requireAvailable(selection: ModelSelection): Promise<ModelSelection> {
    const check = await models.check(selection);
    if (!check.ok) throw new HttpError(400, "MODEL_UNAVAILABLE", check.reason);
    return selection;
  }

  app.post("/documents", async (request, reply) => {
    const query = UploadQuery.parse(request.query);
    const model =
      query.provider !== undefined && query.model !== undefined
        ? await requireAvailable({ provider: query.provider, model: query.model })
        : defaultModel;

    const body: UploadResponse = { accepted: [], rejected: [] };
    try {
      // One file at a time: each is streamed to disk before the next part is read.
      for await (const part of request.files()) {
        const outcome = await storeUpload(deps, part, request.log, model);
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
    const ctx = context();
    return listDocuments(db, { limit }).map((row) =>
      toSummary(
        row,
        readStoredResult(row.result_json, row.id, request.log, ctx),
        sourceOfListRow(row),
      ),
    );
  });

  // Registered before /documents/:id, so export.csv is never read as an id.
  app.get("/documents/export.csv", (request, reply) => {
    const ctx = context();
    const rows = listCompletedForExport(db).map((row) =>
      exportCells(row, readStoredResult(row.result_json, row.id, request.log, ctx)),
    );
    return (
      reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="contracts-${ctx.today}.csv"`)
        // Excel reads a csv without a BOM in the local ANSI codepage and mangles non-ascii vendor names.
        .send(UTF8_BOM + toCsv(EXPORT_COLUMNS, rows))
    );
  });

  app.get("/documents/:id", (request) => {
    const { id } = IdParams.parse(request.params);
    const { run } = DetailQuery.parse(request.query);
    const row = getDocument(db, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "Document not found");

    let extraction;
    if (run === undefined) {
      extraction = row.latest_extraction_id
        ? getExtraction(db, row.latest_extraction_id)
        : undefined;
    } else {
      extraction = getExtractionForRun(db, id, run);
      if (!extraction) {
        throw new HttpError(404, "RUN_NOT_FOUND", `Run ${String(run)} has no extraction`);
      }
    }
    const runs = listExtractionsForDocument(db, id, row.latest_extraction_id);
    return toDetail(
      row,
      extraction,
      runs,
      listFailedRuns(db, id),
      listEvents(db, id),
      request.log,
      context(),
    );
  });

  // Puts a document back in the queue as a new run with the given model. The guard on the status
  // that was read makes it safe against a worker or a second request getting there first.
  // A completed document keeps its result if the new run fails: transitionStatus sees to that
  // for every run that starts from completed, a retry as much as a reanalysis.
  async function requeue(row: DocumentRow, model: ModelSelection, log: typeof app.log) {
    const moved = transitionStatus(db, row.id, "queued", {
      from: row.status,
      bumpRun: true,
      resetAttempts: true,
      // The new run decides review again.
      needs_review: false,
      model,
    });
    if (!moved) return undefined;

    const run = row.run + 1;
    // Still 202 when this fails: the row stays queued and the reconciler delivers it.
    const enqueue = await enqueueOrDefer(deps, row.id, run, model);
    const fields = { documentId: row.id, run, from: row.status, ...model };
    if (enqueue.enqueued) log.info(fields, "run queued");
    else log.warn({ ...fields, err: enqueue.err }, "run left queued, queue unavailable");
    const updated = getDocument(db, row.id);
    if (!updated) throw new Error(`document ${row.id} vanished after it was queued`);
    return { run, updated };
  }

  app.post("/documents/:id/retry", async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const requested = RetryBody.parse(request.body);
    const row = getDocument(db, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "Document not found");
    if (!isRetryable(row)) {
      throw new HttpError(
        409,
        "NOT_RETRYABLE",
        `A ${describeState(row)} document cannot be retried`,
      );
    }
    const model =
      requested == null
        ? selectionOr({ provider: row.llm_provider, model: row.llm_model }, defaultModel)
        : await requireAvailable(requested);

    const queued = await requeue(row, model, request.log);
    if (!queued) throw new HttpError(409, "NOT_RETRYABLE", "Document changed while retrying");
    // The answer shows no values while the run is queued; the list and the detail still show the
    // previous result, labelled with the model that produced it.
    return reply.status(202).send(toSummary(queued.updated, null, null));
  });

  // Another model on a document that is already done. Not a retry: nothing went wrong, and the
  // model is the point. The old extraction stays, each run keeps its own row.
  app.post("/documents/:id/reanalyze", async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const requested = ModelSelectionSchema.parse(request.body);
    const row = getDocument(db, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "Document not found");
    if (row.status !== "completed" && row.status !== "failed") {
      throw new HttpError(
        409,
        "NOT_REANALYZABLE",
        `A ${row.status} document is still being worked on, wait until it is done`,
      );
    }
    const model = await requireAvailable(requested);

    // A completed document stays completed if this run fails: it keeps the extraction it has.
    // A failed document has nothing to keep, a failed reanalysis leaves it failed.
    const queued = await requeue(row, model, request.log);
    if (!queued) throw new HttpError(409, "NOT_REANALYZABLE", "Document changed while reanalyzing");
    insertEvent(db, {
      document_id: id,
      run: queued.run,
      stage: "queue",
      outcome: "info",
      message: `reanalysis with ${model.provider} / ${model.model}`,
    });
    return reply.status(202).send(toSummary(queued.updated, null, null));
  });

  done();
};

function isRetryable(row: DocumentRow): boolean {
  return row.status === "failed" || (row.status === "completed" && row.needs_review === 1);
}

function describeState(row: DocumentRow): string {
  return row.status === "completed" ? "completed (not needing review)" : row.status;
}
