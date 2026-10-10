import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { MultipartFile } from "@fastify/multipart";
import type { FastifyBaseLogger } from "fastify";
import { fileTypeFromFile } from "file-type";
import { ErrorCode, type UploadResponse } from "@nexus/shared";
import { createDocument, findCompletedBySha256, type Config, type Db } from "@nexus/shared/node";
import type { JobQueue } from "../queue.js";
import { enqueueOrDefer } from "./enqueue.js";

// Keyed by the mime file-type detects from the bytes. The client's extension and content-type are ignored.
const ALLOWED_TYPES: ReadonlyMap<string, string> = new Map([
  ["application/pdf", "pdf"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
]);

export interface UploadDeps {
  db: Db;
  queue: JobQueue;
  config: Pick<Config, "UPLOAD_DIR" | "MAX_UPLOAD_MB">;
}

export type AcceptedFile = UploadResponse["accepted"][number];
export type RejectedFile = UploadResponse["rejected"][number];
export type UploadOutcome = { accepted: AcceptedFile } | { rejected: RejectedFile };

type LogOutcome = "queued" | "duplicate" | "queue_unavailable" | "too_large" | "unsupported_type";

// sha256 and size in the same pass that writes the file, so a 20mb upload is never held in memory.
async function writeHashed(
  source: Readable,
  path: string,
): Promise<{ sha256: string; size: number }> {
  const hash = createHash("sha256");
  let size = 0;
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      size += chunk.length;
      callback(null, chunk);
    },
  });
  await pipeline(source, tap, createWriteStream(path));
  return { sha256: hash.digest("hex"), size };
}

export async function storeUpload(
  { db, queue, config }: UploadDeps,
  part: MultipartFile,
  log: FastifyBaseLogger,
): Promise<UploadOutcome> {
  const id = randomUUID();
  const originalName = part.filename;
  const tmpDir = join(config.UPLOAD_DIR, "tmp");
  const tmpPath = join(tmpDir, `${id}.part`);
  await mkdir(tmpDir, { recursive: true });

  try {
    const { sha256, size } = await writeHashed(part.file, tmpPath);
    const logLine = (outcome: LogOutcome, mime: string | null, extra: object = {}) => {
      const level = outcome === "queue_unavailable" ? "warn" : "info";
      log[level]({ documentId: id, sha256, size, mime, outcome, ...extra }, "upload handled");
    };
    const reject = (code: ErrorCode, message: string): UploadOutcome => ({
      rejected: { original_name: originalName, code, message },
    });

    if (part.file.truncated) {
      logLine("too_large", null);
      return reject(ErrorCode.FILE_TOO_LARGE, `File is larger than ${config.MAX_UPLOAD_MB} MB`);
    }

    const detected = await fileTypeFromFile(tmpPath);
    const ext = detected ? ALLOWED_TYPES.get(detected.mime) : undefined;
    if (!detected || !ext) {
      const what = detected?.mime ?? "unknown";
      logLine("unsupported_type", detected?.mime ?? null);
      return reject(ErrorCode.UNSUPPORTED_TYPE, `Only PDF and DOCX are accepted, detected ${what}`);
    }

    // The stored name is always the uuid, so nothing the client sends ends up in a path.
    // Stored relative to UPLOAD_DIR so dev and docker can mount it in different places.
    const storageName = `${id}.${ext}`;
    const storagePath = join(config.UPLOAD_DIR, storageName);
    await rename(tmpPath, storagePath);
    const row = {
      id,
      original_name: originalName,
      mime: detected.mime,
      size_bytes: size,
      sha256,
      storage_path: storageName,
    };

    const original = findCompletedBySha256(db, sha256);
    try {
      if (original) {
        createDocument(db, {
          ...row,
          status: "completed",
          duplicate_of: original.id,
          latest_extraction_id: original.latest_extraction_id,
        });
      } else {
        createDocument(db, { ...row, status: "queued" });
      }
    } catch (err) {
      // No row points at the file, so nothing would ever clean it up.
      await rm(storagePath, { force: true });
      throw err;
    }

    if (original) {
      logLine("duplicate", detected.mime, { duplicateOf: original.id });
      return {
        accepted: {
          id,
          original_name: originalName,
          status: "completed",
          duplicate_of: original.id,
        },
      };
    }

    const enqueue = await enqueueOrDefer({ db, queue }, id, 1);
    if (enqueue.enqueued) logLine("queued", detected.mime);
    else logLine("queue_unavailable", detected.mime, { err: enqueue.err });
    return { accepted: { id, original_name: originalName, status: "queued", duplicate_of: null } };
  } finally {
    // Gone already when the file was moved; this is for rejections and errors halfway through.
    await rm(tmpPath, { force: true });
  }
}
