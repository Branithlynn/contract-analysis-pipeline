import type { ExtractionResult, Severity } from "@nexus/shared";
import type { ExportRow } from "@nexus/shared/node";
import type { Cell } from "./csv.js";
import { daysUntil } from "./dto.js";

export const EXPORT_COLUMNS = [
  "id",
  "file",
  "status",
  "needs_review",
  "vendor",
  "customer",
  "document_type",
  "effective_date",
  "expiration_date",
  "expiration_source",
  "notice_deadline",
  "days_until_notice_deadline",
  "auto_renewal",
  "total_value",
  "currency",
  "payment_terms",
  "governing_law",
  "high_risks",
  "medium_risks",
  "low_risks",
  "grounding_score",
  "model",
  "prompt_version",
] as const;

type ExportColumn = (typeof EXPORT_COLUMNS)[number];

function countSeverity(result: ExtractionResult, severity: Severity): number {
  return result.risk_clauses.filter((clause) => clause.severity === severity).length;
}

// result is null when the stored json was broken: the document columns still go out, the rest stays empty.
export function exportCells(
  row: ExportRow,
  result: ExtractionResult | null,
  today: string,
): Cell[] {
  const values: Record<ExportColumn, Cell> = {
    id: row.id,
    file: row.original_name,
    status: row.status,
    needs_review: row.needs_review === 1,
    vendor: result?.vendor_name.value ?? null,
    customer: result?.customer_name.value ?? null,
    document_type: result?.document_type.value ?? null,
    effective_date: result?.effective_date.value ?? null,
    expiration_date: result?.derived.expiration_date ?? null,
    expiration_source: result?.derived.expiration_source ?? null,
    notice_deadline: result?.derived.notice_deadline ?? null,
    days_until_notice_deadline: result ? daysUntil(result.derived.notice_deadline, today) : null,
    auto_renewal: result?.auto_renewal.value ?? null,
    total_value: result?.total_contract_value.value?.amount ?? null,
    currency: result?.total_contract_value.value?.currency ?? null,
    payment_terms: result?.payment_terms.value ?? null,
    governing_law: result?.governing_law.value ?? null,
    high_risks: result ? countSeverity(result, "high") : null,
    medium_risks: result ? countSeverity(result, "medium") : null,
    low_risks: result ? countSeverity(result, "low") : null,
    grounding_score: result?.grounding_score ?? null,
    // From the extraction row, not the json, so they survive a broken result and help find the bad run.
    model: row.model,
    prompt_version: row.prompt_version,
  };
  return EXPORT_COLUMNS.map((column) => values[column]);
}
