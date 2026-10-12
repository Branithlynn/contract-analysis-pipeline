import { ExtractedFieldName, type ExtractionResult, type Severity } from "@nexus/shared";
import {
  documentTypeLabel,
  EMPTY,
  fieldLabel,
  formatDate,
  formatMoney,
  formatPercent,
  plural,
} from "./format.js";

// Two runs of one document side by side: what each model extracted, field by field.

export interface DiffRow {
  label: string;
  left: string;
  right: string;
  same: boolean;
}

const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

// One extracted value as text. The same wording for both sides, so equal values compare equal.
export function fieldText(result: ExtractionResult, name: ExtractedFieldName): string {
  switch (name) {
    case "document_type":
      return result.document_type.value === null
        ? EMPTY
        : documentTypeLabel(result.document_type.value);
    case "effective_date":
    case "expiration_date": {
      const value = result[name].value;
      return value === null ? EMPTY : formatDate(value);
    }
    case "initial_term_months":
    case "renewal_term_months": {
      const value = result[name].value;
      return value === null ? EMPTY : plural(value, "month");
    }
    case "termination_notice_days": {
      const value = result.termination_notice_days.value;
      return value === null ? EMPTY : plural(value, "day");
    }
    case "auto_renewal": {
      const value = result.auto_renewal.value;
      return value === null ? EMPTY : value ? "Yes" : "No";
    }
    case "total_contract_value": {
      const value = result.total_contract_value.value;
      return value === null ? EMPTY : formatMoney(value);
    }
    default:
      return result[name].value ?? EMPTY;
  }
}

function risksText(result: ExtractionResult): string {
  const clauses = result.risk_clauses;
  if (clauses.length === 0) return "none";
  const highest = clauses.reduce<Severity>(
    (max, clause) => (SEVERITY_RANK[clause.severity] > SEVERITY_RANK[max] ? clause.severity : max),
    "low",
  );
  return `${clauses.length}, highest ${highest}`;
}

function row(label: string, left: string, right: string): DiffRow {
  // Models differ in case and spacing for the same answer ("Net 30" / "net 30").
  const norm = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
  return { label, left, right, same: norm(left) === norm(right) };
}

export function diffRuns(left: ExtractionResult, right: ExtractionResult): DiffRow[] {
  const date = (value: string | null) => (value === null ? EMPTY : formatDate(value));
  const grounding = (value: number | null) => (value === null ? EMPTY : formatPercent(value));
  return [
    ...ExtractedFieldName.options.map((name) =>
      row(fieldLabel(name), fieldText(left, name), fieldText(right, name)),
    ),
    row("Notice deadline", date(left.derived.notice_deadline), date(right.derived.notice_deadline)),
    row("Risks", risksText(left), risksText(right)),
    row("Grounding", grounding(left.grounding_score), grounding(right.grounding_score)),
  ];
}

export function countDifferences(rows: readonly DiffRow[]): number {
  return rows.filter((r) => !r.same).length;
}
