import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import {
  deriveDates,
  ExtractionResultSchema,
  type DocumentDetail,
  type DocumentEvent,
  type DocumentSummary,
  type ExtractionResult,
  type Severity,
} from "@nexus/shared";
import type { DocumentRow, EventRow, ExtractionRow } from "@nexus/shared/node";

const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

// What a read needs to recompute the derived block: today's date from the injected clock (UTC) and
// the grounding threshold behind the low_grounding alert.
export interface ReadContext {
  today: string;
  groundingThreshold: number;
}

export function readContext(now: Date, groundingThreshold: number): ReadContext {
  return { today: now.toISOString().slice(0, 10), groundingThreshold };
}

// json read from the db is a boundary too. A broken row logs and loses its extraction fields
// instead of failing the whole list.
export function parseStoredResult(
  json: string | null,
  documentId: string,
  log: FastifyBaseLogger,
): ExtractionResult | null {
  if (json === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    log.warn({ documentId, err }, "stored extraction is not valid json");
    return null;
  }
  const parsed = ExtractionResultSchema.safeParse(raw);
  if (!parsed.success) {
    log.warn(
      { documentId, issues: z.prettifyError(parsed.error) },
      "stored extraction does not match the schema",
    );
    return null;
  }
  return parsed.data;
}

function maxSeverity(result: ExtractionResult): Severity | null {
  let max: Severity | null = null;
  for (const clause of result.risk_clauses) {
    if (max === null || SEVERITY_RANK[clause.severity] > SEVERITY_RANK[max]) max = clause.severity;
  }
  return max;
}

// The stored derived block was right on the day of extraction. Days left, alerts and a rolled auto
// renewal term go stale daily, so every read replaces it with one computed from the stored facts,
// using the same deriveDates the worker stored it with.
export function withFreshDerived(result: ExtractionResult, ctx: ReadContext): ExtractionResult {
  const derived = deriveDates(
    result,
    result.risk_clauses,
    result.grounding_score,
    ctx.groundingThreshold,
    ctx.today,
  );
  return { ...result, derived };
}

// Parse plus recompute, so no caller can forget the second half.
export function readStoredResult(
  json: string | null,
  documentId: string,
  log: FastifyBaseLogger,
  ctx: ReadContext,
): ExtractionResult | null {
  const parsed = parseStoredResult(json, documentId, log);
  return parsed && withFreshDerived(parsed, ctx);
}

// Expects a result that already went through withFreshDerived.
export function toSummary(row: DocumentRow, result: ExtractionResult | null): DocumentSummary {
  return {
    id: row.id,
    original_name: row.original_name,
    status: row.status,
    stage: row.stage,
    needs_review: row.needs_review === 1,
    error_code: row.error_code,
    error_message: row.error_message,
    duplicate_of: row.duplicate_of,
    created_at: row.created_at,
    updated_at: row.updated_at,
    vendor_name: result?.vendor_name.value ?? null,
    total_contract_value: result?.total_contract_value.value ?? null,
    expiration_date: result?.derived.expiration_date ?? null,
    notice_deadline: result?.derived.notice_deadline ?? null,
    days_until_notice_deadline: result?.derived.days_until_notice_deadline ?? null,
    max_risk_severity: result ? maxSeverity(result) : null,
    risk_count: result ? result.risk_clauses.length : null,
    grounding_score: result?.grounding_score ?? null,
  };
}

function toEvent(row: EventRow): DocumentEvent {
  return {
    stage: row.stage,
    outcome: row.outcome,
    message: row.message,
    duration_ms: row.duration_ms,
    created_at: row.created_at,
  };
}

export function toDetail(
  row: DocumentRow,
  extraction: ExtractionRow | undefined,
  events: EventRow[],
  log: FastifyBaseLogger,
  ctx: ReadContext,
): DocumentDetail {
  const result = extraction ? readStoredResult(extraction.result_json, row.id, log, ctx) : null;
  return {
    ...toSummary(row, result),
    mime: row.mime,
    size_bytes: row.size_bytes,
    attempts: row.attempts,
    run: row.run,
    extraction:
      extraction && result
        ? {
            result,
            provider: extraction.provider,
            model: extraction.model,
            prompt_version: extraction.prompt_version,
            input_tokens: extraction.input_tokens,
            output_tokens: extraction.output_tokens,
            duration_ms: extraction.duration_ms,
            chunk_count: extraction.chunk_count,
            created_at: extraction.created_at,
          }
        : null,
    events: events.map(toEvent),
  };
}
