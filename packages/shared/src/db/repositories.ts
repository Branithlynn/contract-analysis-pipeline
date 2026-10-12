import { randomUUID } from "node:crypto";
import type { EventOutcome } from "../schemas/api.js";
import type { LlmProviderName, ModelSelection } from "../providers.js";
import type { ExtractionResult } from "../schemas/extraction.js";
import {
  ALLOWED_TRANSITIONS,
  type DocumentStatus,
  type ErrorCode,
  type IndexStatus,
  type Stage,
} from "../status.js";
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
  // The model the current run was asked to use. Null: the default from the environment.
  llm_provider: LlmProviderName | null;
  llm_model: string | null;
  // Not null while a new run of a completed document is under way: the needs_review to go back
  // to if that run fails. See failRun.
  fallback_needs_review: number | null;
  index_status: IndexStatus | null;
  // Why the last indexing attempt failed. Null unless index_status is failed.
  index_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentListRow extends DocumentRow {
  result_json: string | null;
  // The model and prompt of the extraction the values come from. Null without an extraction.
  result_provider: string | null;
  result_model: string | null;
  result_prompt_version: string | null;
}

export interface ExportRow extends DocumentRow {
  result_json: string | null;
  model: string | null;
  prompt_version: string | null;
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
  // Relative to UPLOAD_DIR, e.g. "<id>.pdf". Readers resolve it against their own UPLOAD_DIR.
  storage_path: string;
  // completed is for duplicates, which reuse the original's extraction instead of being processed.
  status: "queued" | "completed";
  duplicate_of?: string | null;
  latest_extraction_id?: string | null;
  // The model this document is to be analyzed with.
  model?: ModelSelection | null;
}

export function createDocument(db: Db, input: CreateDocumentInput): void {
  const ts = now();
  const { model, ...rest } = input;
  db.prepare<Record<string, unknown>>(
    `INSERT INTO documents
       (id, original_name, mime, size_bytes, sha256, storage_path, status, duplicate_of,
        latest_extraction_id, llm_provider, llm_model, created_at, updated_at)
     VALUES
       (@id, @original_name, @mime, @size_bytes, @sha256, @storage_path, @status, @duplicate_of,
        @latest_extraction_id, @llm_provider, @llm_model, @created_at, @updated_at)`,
  ).run({
    ...rest,
    llm_provider: model?.provider ?? null,
    llm_model: model?.model ?? null,
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
      `SELECT d.*, e.result_json, e.provider AS result_provider, e.model AS result_model,
              e.prompt_version AS result_prompt_version
       FROM documents d
       LEFT JOIN extractions e ON e.id = d.latest_extraction_id
       ORDER BY d.created_at DESC
       LIMIT ?`,
    )
    .all(limit);
}

// No limit: the export is the whole register, which is what replaces the spreadsheet.
export function listCompletedForExport(db: Db): ExportRow[] {
  return db
    .prepare<[], ExportRow>(
      `SELECT d.*, e.result_json, e.model, e.prompt_version
       FROM documents d
       LEFT JOIN extractions e ON e.id = d.latest_extraction_id
       WHERE d.status = 'completed'
       ORDER BY d.created_at DESC`,
    )
    .all();
}

// What makes two analyses the same: the file, the model and the prompt. The same file with another
// model or prompt version is a new analysis, not a duplicate.
export interface AnalysisKey extends ModelSelection {
  promptVersion: string;
}

// A finished, trusted analysis of this file by this model and prompt, to reuse instead of running
// it again. Only a document's latest extraction counts: needs_review is known for that one only.
export function findCompletedBySha256(
  db: Db,
  sha256: string,
  key: AnalysisKey,
): DocumentRow | undefined {
  return db
    .prepare<[string, string, string, string], DocumentRow>(
      `SELECT d.* FROM documents d
       JOIN extractions e ON e.id = d.latest_extraction_id
       WHERE d.sha256 = ? AND d.status = 'completed' AND d.needs_review = 0
         AND e.provider = ? AND e.model = ? AND e.prompt_version = ?
       ORDER BY d.created_at DESC
       LIMIT 1`,
    )
    .get(sha256, key.provider, key.model, key.promptVersion);
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
  // The model for the run that starts with this transition. Only when moving to queued.
  model?: ModelSelection;
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
  if (opts.model !== undefined && to !== "queued")
    throw new Error(`A model can only be set when moving to queued, not ${to}`);

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
  if (opts.model !== undefined) {
    sets.push("llm_provider = @llm_provider", "llm_model = @llm_model");
    params.llm_provider = opts.model.provider;
    params.llm_model = opts.model.model;
  }
  // A completed document never becomes failed because a later run failed, whichever request
  // started that run. So a new run of a completed document remembers the needs_review to go back
  // to, here, where every new run starts: no caller can forget it. sqlite reads status and
  // needs_review on the right hand side as they were before this update.
  // Written on each of these moves, so a value from an earlier run cannot linger.
  if (to === "queued") {
    sets.push(
      "fallback_needs_review = CASE WHEN status = 'completed' THEN needs_review ELSE NULL END",
    );
  } else if (to === "completed" || to === "failed") {
    sets.push("fallback_needs_review = NULL");
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

// Not a document status: the document is completed either way. updated_at is left alone, it is
// the time the document itself last changed.
export function setIndexStatus(
  db: Db,
  id: string,
  status: IndexStatus,
  error: string | null = null,
): boolean {
  if (status === "indexed" && error !== null) {
    throw new Error("An indexed document cannot carry an index error");
  }
  const result = db
    .prepare<[IndexStatus, string | null, string]>(
      "UPDATE documents SET index_status = ?, index_error = ? WHERE id = ?",
    )
    .run(status, error, id);
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

// Every finished run of a document, newest first. A duplicate has no runs of its own, so the
// extraction it reuses is listed for it.
export function listExtractionsForDocument(
  db: Db,
  documentId: string,
  latestExtractionId: string | null,
): ExtractionRow[] {
  return db
    .prepare<[string, string | null], ExtractionRow>(
      `SELECT * FROM extractions
       WHERE document_id = ? OR id = ?
       ORDER BY created_at DESC, run DESC`,
    )
    .all(documentId, latestExtractionId);
}

export function getExtractionForRun(
  db: Db,
  documentId: string,
  run: number,
): ExtractionRow | undefined {
  return db
    .prepare<[string, number], ExtractionRow>(
      "SELECT * FROM extractions WHERE document_id = ? AND run = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(documentId, run);
}

// failed runs

export interface FailedRunRow {
  id: number;
  document_id: string;
  run: number;
  provider: string;
  model: string;
  prompt_version: string;
  error_code: ErrorCode;
  error_message: string;
  created_at: string;
}

export function listFailedRuns(db: Db, documentId: string): FailedRunRow[] {
  return db
    .prepare<[string], FailedRunRow>(
      "SELECT * FROM failed_runs WHERE document_id = ? ORDER BY run DESC",
    )
    .all(documentId);
}

export interface FailRunInput {
  documentId: string;
  run: number;
  model: ModelSelection;
  promptVersion: string;
  code: ErrorCode;
  message: string;
}

// failed: the document is failed now. kept_completed: it was a new run of a completed document
// (a retry or a reanalysis), which is completed again with the extraction it had. skipped: the document is not
// processing this run any more, nothing was written.
export type FailRunOutcome = "failed" | "kept_completed" | "skipped";

const MAX_EVENT_CHARS = 500;

// The one place a run ends without a result. Records the run as failed, then either fails the
// document or, when the document was completed before this run, puts it back: completed, the
// needs_review it had, latest_extraction_id never touched. Only a document that never completed
// can be failed. A second opinion that did not arrive is no reason to take away the first.
// One transaction, guarded on status and run like the success path, so it never overrides what
// another run wrote.
export function failRun(db: Db, input: FailRunInput): FailRunOutcome {
  const { documentId, run, model, code, message } = input;
  return db.transaction((): FailRunOutcome => {
    const doc = getDocument(db, documentId);
    if (doc?.status !== "processing" || doc.run !== run) return "skipped";

    db.prepare<Record<string, unknown>>(
      `INSERT OR REPLACE INTO failed_runs
         (document_id, run, provider, model, prompt_version, error_code, error_message, created_at)
       VALUES
         (@document_id, @run, @provider, @model, @prompt_version, @error_code, @error_message, @created_at)`,
    ).run({
      document_id: documentId,
      run,
      provider: model.provider,
      model: model.model,
      prompt_version: input.promptVersion,
      error_code: code,
      error_message: message,
      created_at: now(),
    });

    if (doc.fallback_needs_review === null) {
      const moved = transitionStatus(db, documentId, "failed", {
        from: "processing",
        error_code: code,
        error_message: message,
      });
      return moved ? "failed" : "skipped";
    }

    const moved = transitionStatus(db, documentId, "completed", {
      from: "processing",
      needs_review: doc.fallback_needs_review === 1,
    });
    if (!moved) return "skipped";
    insertEvent(db, {
      document_id: documentId,
      run,
      stage: "job",
      outcome: "error",
      message:
        `run ${String(run)} with ${model.provider} / ${model.model} failed, the previous result is kept. ${code}: ${message}`.slice(
          0,
          MAX_EVENT_CHARS,
        ),
    });
    return "kept_completed";
  })();
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
