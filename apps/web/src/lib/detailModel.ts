import {
  REVIEW_PREFIX,
  type Alert,
  type AlertLevel,
  type DocumentSummary,
  type ExtractionResult,
  type Severity,
} from "@nexus/shared";

export interface SplitWarnings {
  // Why a human has to look, without the prefix.
  review: string[];
  // Everything else: what normalize dropped, the summary fallback.
  notes: string[];
}

export function splitWarnings(warnings: readonly string[]): SplitWarnings {
  const split: SplitWarnings = { review: [], notes: [] };
  for (const warning of warnings) {
    if (warning.startsWith(REVIEW_PREFIX)) split.review.push(warning.slice(REVIEW_PREFIX.length));
    else split.notes.push(warning);
  }
  return split;
}

const LEVEL_RANK: Record<AlertLevel, number> = { critical: 0, warning: 1, info: 2 };

export function sortAlerts(alerts: readonly Alert[]): Alert[] {
  return [...alerts].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
}

export type RiskClause = ExtractionResult["risk_clauses"][number];

const SEVERITY_ORDER: readonly Severity[] = ["high", "medium", "low"];

// High to low, and a severity with no clauses gets no group.
export function groupRisks(
  clauses: readonly RiskClause[],
): { severity: Severity; clauses: RiskClause[] }[] {
  return SEVERITY_ORDER.map((severity) => ({
    severity,
    clauses: clauses.filter((clause) => clause.severity === severity),
  })).filter((group) => group.clauses.length > 0);
}

// Mirrors the rule in the api's retry route. The api still decides: a stale answer here gets a 409.
// A contract that just ends has no notice deadline by design. That is different from one that
// renews but where no notice period was found, and the panel should not make them look the same.
export function noticeDeadlineEmptyText(autoRenewal: boolean | null): string {
  return autoRenewal === false ? "Not applicable (no auto-renewal)" : "Not computed";
}

export function canRetry(doc: Pick<DocumentSummary, "status" | "needs_review">): boolean {
  return doc.status === "failed" || (doc.status === "completed" && doc.needs_review);
}
