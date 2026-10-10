import { randomUUID } from "node:crypto";
import type { EventOutcome } from "../schemas/api.js";
import type { ExtractionResult } from "../schemas/extraction.js";
import { ALLOWED_TRANSITIONS, type DocumentStatus, type ErrorCode, type Stage } from "../status.js";
import type { Db } from "./client.js";

// Rows mirror the tables 1:1. The CHECK constraints are what make the narrowed union types safe.

export interface DocumentRow {
  id: string;
  original_name: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  storage_path: string;
  status: DocumentStatus;
  stage: Stage | null;
  needs_review: number;
  error_code: ErrorCode | null;
  error_message: string | null;
  attempts: number;
  run: number;
  duplicate_of: string | null;
  latest_extraction_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentListRow extends DocumentRow {
  result_json: string | null;
}

export interface ExtractionRow {
  id: string;
  document_id: string;
  run: number;
  provider: string;
  model: string;
  prompt_version: string;
  result_json: string;
  grounding_score: number | null;
  chunk_count: number;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  created_at: string;
}

export interface EventRow {
  id: number;
  document_id: string;
  run: number;
  stage: string;
  outcome: EventOutcome;
  message: string;
  duration_ms: number | null;
  created_at: string;
}

function now(): string {
  return new Date().toISOString();
}

// documents

export interface CreateDocumentInput {
  id: string;
  original_name: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  storage_path: string;
  // completed is for duplicates, which reuse the original's extraction instead of being processed.
  status: "queued" | "completed";
  duplicate_of?: string | null;
  latest_extraction_id?: string | null;
}

export function createDocument(db: Db, input: CreateDocumentInput): void {
  const ts = now();
  db.prepare<Record<string, unknown>>(
    `INSERT INTO documents
       (id, original_name, mime, size_bytes, sha256, storage_path, status, duplicate_of, latest_extraction_id, created_at, updated_at)
     VALUES
       (@id, @original_name, @mime, @size_bytes, @sha256, @storage_path, @status, @duplicate_of, @latest_extraction_id, @created_at, @updated_at)`,
  ).run({
    ...input,
    duplicate_of: input.duplicate_of ?? null,
    latest_extraction_id: input.latest_extraction_id ?? null,
    created_at: ts,
    updated_at: ts,
  });
}

export function getDocument(db: Db, id: string): DocumentRow | undefined {
  return db.prepare<[string], DocumentRow>("SELECT * FROM documents WHERE id = ?").get(id);
}

export function listDocuments(db: Db, { limit }: { limit: number }): DocumentListRow[] {
  return db
    .prepare<[number], DocumentListRow>(
      `SELECT d.*, e.result_json
       FROM documents d
       LEFT JOIN extractions e ON e.id = d.latest_extraction_id
       ORDER BY d.created_at DESC
       LIMIT ?`,
    )
    .all(limit);
}

export function findCompletedBySha256(db: Db, sha256: string): DocumentRow | undefined {
  return db
    .prepare<[string], DocumentRow>(
      `SELECT * FROM documents
       WHERE sha256 = ? AND status = 'completed' AND needs_review = 0
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(sha256);
}

// updated_at rather than created_at, so a document that was just retried is not counted as stale.
export function findStaleQueued(db: Db, olderThanIso: string): DocumentRow[] {
  return db
    .prepare<[string], DocumentRow>(
      "SELECT * FROM documents WHERE status = 'queued' AND updated_at < ? ORDER BY updated_at",
    )
    .all(olderThanIso);
}

export interface TransitionOptions {
  from: DocumentStatus | readonly DocumentStatus[];
  stage?: Stage;
  error_code?: ErrorCode;
  error_message?: string;
  needs_review?: boolean;
  bumpRun?: boolean;
  bumpAttempts?: boolean;
  resetAttempts?: boolean;
}

// The WHERE status IN (...) guard is the concurrency control: if two workers, or a worker and a retry,
// race on the same document, only one UPDATE matches and the loser gets false.
export function transitionStatus(
  db: Db,
  id: string,
  to: DocumentStatus,
  opts: TransitionOptions,
): boolean {
  const from: readonly DocumentStatus[] = typeof opts.from === "string" ? [opts.from] : opts.from;
  if (from.length === 0) throw new Error("transitionStatus needs at least one from status");
  for (const f of from) {
    const allowed: readonly DocumentStatus[] = ALLOWED_TRANSITIONS[f];
    if (!allowed.includes(to)) throw new Error(`Illegal status transition ${f} -> ${to}`);
  }

  const clearsErrors = to === "queued" || to === "completed";
  const clearsStage = to === "completed" || to === "failed";
  if (clearsErrors && (opts.error_code !== undefined || opts.error_message !== undefined)) {
    throw new Error(`Error fields cannot be set when moving to ${to}`);
  }
  if (clearsStage && opts.stage !== undefined)
    throw new Error(`Stage cannot be set when moving to ${to}`);
  if (opts.bumpAttempts && opts.resetAttempts)
    throw new Error("bumpAttempts and resetAttempts are exclusive");

  const sets = ["status = @to", "updated_at = @now"];
  const params: Record<string, unknown> = { id, to, now: now() };

  if (clearsStage) sets.push("stage = NULL");
  else if (opts.stage !== undefined) {
    sets.push("stage = @stage");
    params.stage = opts.stage;
  }

  if (clearsErrors) sets.push("error_code = NULL", "error_message = NULL");
  else {
    if (opts.error_code !== undefined) {
      sets.push("error_code = @error_code");
      params.error_code = opts.error_code;
    }
    if (opts.error_message !== undefined) {
      sets.push("error_message = @error_message");
      params.error_message = opts.error_message;
    }
  }

  if (opts.needs_review !== undefined) {
    sets.push("needs_review = @needs_review");
    params.needs_review = opts.needs_review ? 1 : 0;
  }
  if (opts.bumpRun) sets.push("run = run + 1");
  if (opts.bumpAttempts) sets.push("attempts = attempts + 1");
  if (opts.resetAttempts) sets.push("attempts = 0");

  const fromParams = from.map((f, i) => {
    params[`from${i}`] = f;
    return `@from${i}`;
  });

  const result = db
    .prepare<Record<string, unknown>>(
      `UPDATE documents SET ${sets.join(", ")} WHERE id = @id AND status IN (${fromParams.join(", ")})`,
    )
    .run(params);
  return result.changes === 1;
}

// Guarded on processing: a stage only means something while a worker owns the document.
export function setStage(db: Db, id: string, stage: Stage): boolean {
  const result = db
    .prepare<[Stage, string, string]>(
      "UPDATE documents SET stage = ?, updated_at = ? WHERE id = ? AND status = 'processing'",
    )
    .run(stage, now(), id);
  return result.changes === 1;
}

// extractions

export interface InsertExtractionInput {
  document_id: string;
  run: number;
  provider: string;
  model: string;
  prompt_version: string;
  result: ExtractionResult;
  grounding_score: number | null;
  chunk_count: number;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
}

export function insertExtraction(db: Db, input: InsertExtractionInput): string {
  const id = randomUUID();
  const ts = now();
  const insert = db.prepare<Record<string, unknown>>(
    `INSERT INTO extractions
       (id, document_id, run, provider, model, prompt_version, result_json, grounding_score,
        chunk_count, input_tokens, output_tokens, duration_ms, created_at)
     VALUES
       (@id, @document_id, @run, @provider, @model, @prompt_version, @result_json, @grounding_score,
        @chunk_count, @input_tokens, @output_tokens, @duration_ms, @created_at)`,
  );
  const point = db.prepare<[string, string, string]>(
    "UPDATE documents SET latest_extraction_id = ?, updated_at = ? WHERE id = ?",
  );
  const { result, ...rest } = input;
  // One transaction so a document never points at an extraction that was not written, or vice versa.
  db.transaction(() => {
    insert.run({ ...rest, id, result_json: JSON.stringify(result), created_at: ts });
    point.run(id, ts, input.document_id);
  })();
  return id;
}

export function getExtraction(db: Db, id: string): ExtractionRow | undefined {
  return db.prepare<[string], ExtractionRow>("SELECT * FROM extractions WHERE id = ?").get(id);
}

// events

export interface InsertEventInput {
  document_id: string;
  run: number;
  stage: string;
  outcome: EventOutcome;
  message: string;
  duration_ms?: number | null;
}

export function insertEvent(db: Db, input: InsertEventInput): number {
  const result = db
    .prepare<Record<string, unknown>>(
      `INSERT INTO processing_events (document_id, run, stage, outcome, message, duration_ms, created_at)
       VALUES (@document_id, @run, @stage, @outcome, @message, @duration_ms, @created_at)`,
    )
    .run({ ...input, duration_ms: input.duration_ms ?? null, created_at: now() });
  return Number(result.lastInsertRowid);
}

export function listEvents(db: Db, documentId: string): EventRow[] {
  return db
    .prepare<[string], EventRow>(
      "SELECT * FROM processing_events WHERE document_id = ? ORDER BY id",
    )
    .all(documentId);
}
