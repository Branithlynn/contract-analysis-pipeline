import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import {
  ExtractionResultSchema,
  type DocumentDetail,
  type DocumentEvent,
  type DocumentSummary,
  type ExtractionResult,
  type Severity,
} from "@nexus/shared";
import type { DocumentRow, EventRow, ExtractionRow } from "@nexus/shared/node";

const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };
const DAY_MS = 24 * 60 * 60 * 1000;

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

// The stored value was computed on the day of extraction and goes stale, so it is recomputed per read.
// Both dates are calendar dates, compared in UTC.
export function daysUntil(deadline: string | null, today: string): number | null {
  if (deadline === null) return null;
  return Math.round((Date.parse(deadline) - Date.parse(today)) / DAY_MS);
}

export function todayUtc(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function toSummary(
  row: DocumentRow,
  result: ExtractionResult | null,
  today: string,
): DocumentSummary {
  const noticeDeadline = result?.derived.notice_deadline ?? null;
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
    notice_deadline: noticeDeadline,
    days_until_notice_deadline: result ? daysUntil(noticeDeadline, today) : null,
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
  today: string,
): DocumentDetail {
  const parsed = extraction ? parseStoredResult(extraction.result_json, row.id, log) : null;
  // Same fresh value as the summary, so the detail view never shows two different day counts.
  const result: ExtractionResult | null = parsed && {
    ...parsed,
    derived: {
      ...parsed.derived,
      days_until_notice_deadline: daysUntil(parsed.derived.notice_deadline, today),
    },
  };
  return {
    ...toSummary(row, result, today),
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
          }
        : null,
    events: events.map(toEvent),
  };
}
