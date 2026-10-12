import type { DocumentStatus, DocumentSummary, Severity } from "@nexus/shared";
import { formatDate } from "./format.js";

export type SortKey = "newest" | "notice" | "risk";

const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

// Nulls go last whatever the direction: a document with no deadline or no extraction is never the urgent one.
function nullsLast<T>(a: T | null, b: T | null, compare: (a: T, b: T) => number): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return compare(a, b);
}

function byNewest(a: DocumentSummary, b: DocumentSummary): number {
  // Both are UTC iso timestamps from the api, so they order as text.
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
}

// Upcoming deadlines first, the closest on top. A passed deadline is not the next thing to act on (that
// window is gone and the contract renews), so those follow, most recently passed first. Nulls go last.
function byNotice(a: DocumentSummary, b: DocumentSummary): number {
  return nullsLast(a.days_until_notice_deadline, b.days_until_notice_deadline, (x, y) => {
    if (x < 0 !== y < 0) return x < 0 ? 1 : -1;
    return x < 0 ? y - x : x - y;
  });
}

function byRisk(a: DocumentSummary, b: DocumentSummary): number {
  const severity = nullsLast(
    a.max_risk_severity,
    b.max_risk_severity,
    (x, y) => SEVERITY_RANK[y] - SEVERITY_RANK[x],
  );
  if (severity !== 0) return severity;
  return nullsLast(a.risk_count, b.risk_count, (x, y) => y - x);
}

export interface ExpiresLabel {
  date: string;
  // What the date means, when it is not simply the day the contract ends.
  note: "renews" | "expired" | null;
}

type ExpiresInput = Pick<
  DocumentSummary,
  "expiration_date" | "current_term_end" | "auto_renewal" | "alerts"
>;

// The Expires cell. A contract that renews by itself shows the end of the term it is in today:
// the original expiration of one that already rolled over is in the past and reads as expired.
// "expired" comes from the alert the api computed, not from the browser clock, so the table and
// the csv export agree on what today is.
export function expiresLabel(doc: ExpiresInput): ExpiresLabel | null {
  if (doc.auto_renewal === true && doc.current_term_end !== null) {
    return { date: formatDate(doc.current_term_end), note: "renews" };
  }
  if (doc.expiration_date === null) return null;
  const expired = doc.alerts.some((alert) => alert.code === "expired");
  return { date: formatDate(doc.expiration_date), note: expired ? "expired" : null };
}

export function sortDocuments(docs: readonly DocumentSummary[], key: SortKey): DocumentSummary[] {
  // Array.sort is stable, so sorting by newest first makes that the tie-break for the other keys.
  const newest = [...docs].sort(byNewest);
  if (key === "notice") return newest.sort(byNotice);
  if (key === "risk") return newest.sort(byRisk);
  return newest;
}

export interface StatusCounts extends Record<DocumentStatus, number> {
  // Completed documents flagged for review. They are also counted in completed.
  needs_review: number;
}

export function countByStatus(docs: readonly DocumentSummary[]): StatusCounts {
  const counts: StatusCounts = {
    queued: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    needs_review: 0,
  };
  for (const doc of docs) {
    counts[doc.status] += 1;
    if (doc.status === "completed" && doc.needs_review) counts.needs_review += 1;
  }
  return counts;
}
