import { ExtractionResultSchema, type ExtractionResult, type Severity } from "@nexus/shared";
import type { JobQueue } from "../queue.js";

// Shared by the route tests. Excluded from the build in tsconfig.json, typechecked via tsconfig.test.json.

// Pinned so day counts don't depend on when the suite runs.
export const NOW = new Date("2026-06-01T12:00:00Z");

export const okQueue: JobQueue = {
  enqueue: () => Promise.resolve(),
  ping: () => Promise.resolve(),
  isReady: () => true,
  onReady: () => () => undefined,
  close: () => Promise.resolve(),
};

export function docId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export function addDays(days: number): string {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export const field = <T>(value: T | null) => ({
  value,
  quote: value === null ? null : "quoted text",
  confidence: "high" as const,
  quote_verified: value !== null,
  quote_page: value === null ? null : 1,
});

export function clause(severity: Severity) {
  return {
    category: "auto_renewal" as const,
    severity,
    title: "Auto renewal",
    explanation: "Renews unless cancelled.",
    quote: "renews automatically",
    quote_verified: true,
    quote_page: 1,
  };
}

// A result that passes the strict schema, so tests only spell out what they care about.
export function extractionResult(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return ExtractionResultSchema.parse({
    document_type: field("contract"),
    vendor_name: field("Acme Ltd"),
    customer_name: field("Nexus Corp"),
    payment_terms: field("net 30"),
    governing_law: field("England"),
    liability_cap: field(null),
    effective_date: field("2026-01-01"),
    expiration_date: field("2027-01-01"),
    initial_term_months: field(12),
    renewal_term_months: field(12),
    termination_notice_days: field(30),
    auto_renewal: field(true),
    total_contract_value: field({ amount: 120000, currency: "USD" }),
    risk_clauses: [clause("medium"), clause("high"), clause("low")],
    summary: "A contract.",
    derived: {
      expiration_date: "2027-01-01",
      expiration_source: "stated",
      current_term_end: "2027-01-01",
      next_renewal_date: "2027-01-01",
      notice_deadline: addDays(10),
      // Deliberately stale, the api recomputes it.
      days_until_notice_deadline: 999,
      alerts: [],
    },
    conflicts: [],
    warnings: [],
    grounding_score: 0.9,
    ...overrides,
  });
}
