import { describe, expect, it } from "vitest";
import {
  ErrorCode,
  ExtractionResultSchema,
  type ExtractionResult,
  type RunSummary,
} from "@nexus/shared";
import { canReanalyze, failedRunNote, runHint } from "./detailModel.js";
import {
  errorPhrase,
  formatBytes,
  formatDateWithDays,
  formatElapsed,
  formatMoney,
  formatRelativeDays,
  isNoticeSoon,
} from "./format.js";
import { countDifferences, diffRuns, fieldText } from "./runDiff.js";
import { statusChip } from "./statusChip.js";

// The formatting and view models added with the sidebar and drawer ui.

describe("formatRelativeDays", () => {
  it("says how far away a date is", () => {
    expect(formatRelativeDays(34)).toBe("in 34 days");
    expect(formatRelativeDays(1)).toBe("in 1 day");
    expect(formatRelativeDays(0)).toBe("today");
    expect(formatRelativeDays(-1)).toBe("1 day ago");
    expect(formatRelativeDays(-12)).toBe("12 days ago");
  });
});

describe("formatDateWithDays", () => {
  it("joins the date and the distance like the table shows them", () => {
    expect(formatDateWithDays("2026-11-15", 34)).toBe("15 Nov 2026 · in 34 days");
    expect(formatDateWithDays("2026-10-12", 0)).toBe("12 Oct 2026 · today");
    expect(formatDateWithDays("2026-09-30", -12)).toBe("30 Sep 2026 · 12 days ago");
  });

  it("is only the date when the distance is not known", () => {
    expect(formatDateWithDays("2026-11-15", null)).toBe("15 Nov 2026");
  });

  it("does not shift a date by timezone", () => {
    // Taken apart as text, never through Date.
    expect(formatDateWithDays("2027-01-01", 81)).toBe("1 Jan 2027 · in 81 days");
    expect(formatDateWithDays("2026-12-31", 80)).toBe("31 Dec 2026 · in 80 days");
  });
});

describe("money in the table", () => {
  it("shows the value with its currency, whichever one the contract uses", () => {
    expect(formatMoney({ amount: 84000, currency: "EUR" })).toBe("€84,000");
    expect(formatMoney({ amount: 150000, currency: "USD" })).toBe("US$150,000");
    // A currency without a symbol gets its code, and Intl puts a non-breaking space after it,
    // so the amount never wraps away from its currency.
    expect(formatMoney({ amount: 1250000, currency: "CHF" })).toBe("CHF 1,250,000");
    expect(formatMoney({ amount: 9800.5, currency: "GBP" })).toBe("£9,800.50");
  });
});

describe("isNoticeSoon", () => {
  it("is true for a deadline that is ahead and under 60 days away", () => {
    expect(isNoticeSoon(0)).toBe(true);
    expect(isNoticeSoon(34)).toBe(true);
    expect(isNoticeSoon(59)).toBe(true);
  });

  it("is false from 60 days on, and for a deadline that has passed", () => {
    expect(isNoticeSoon(60)).toBe(false);
    expect(isNoticeSoon(200)).toBe(false);
    expect(isNoticeSoon(-1)).toBe(false);
  });
});

describe("formatElapsed", () => {
  it("counts in the largest two units", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(42_900)).toBe("42s");
    expect(formatElapsed(72_000)).toBe("1m 12s");
    expect(formatElapsed(605_000)).toBe("10m 05s");
    expect(formatElapsed(3_780_000)).toBe("1h 03m");
  });

  it("never goes below zero when the clocks disagree", () => {
    expect(formatElapsed(-5000)).toBe("0s");
  });
});

describe("errorPhrase", () => {
  it("has words for every error code, in lower case for use in a sentence", () => {
    for (const code of Object.values(ErrorCode)) {
      const phrase = errorPhrase(code);
      expect(phrase.length, code).toBeGreaterThan(3);
      expect(phrase, code).toBe(phrase.toLowerCase());
      expect(phrase, code).not.toContain("_");
    }
    expect(errorPhrase("LLM_AUTH")).toBe("api key rejected");
  });
});

describe("formatBytes", () => {
  it("picks a unit that reads", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(48_000)).toBe("47 KB");
    expect(formatBytes(3_400_000)).toBe("3.2 MB");
  });
});

describe("statusChip", () => {
  const NOW = Date.parse("2026-10-12T10:01:12.000Z");
  const base = {
    status: "queued",
    stage: null,
    needs_review: false,
    error_code: null,
    error_message: null,
    updated_at: "2026-10-12T10:00:00.000Z",
  } as const;

  it("is plain for queued and completed", () => {
    expect(statusChip(base, NOW)).toMatchObject({ kind: "queued", label: "Queued", detail: null });
    expect(statusChip({ ...base, status: "completed" }, NOW)).toMatchObject({
      kind: "completed",
      label: "Completed",
    });
  });

  it("shows the stage and how long it has been running while processing", () => {
    expect(statusChip({ ...base, status: "processing", stage: "extracting" }, NOW)).toEqual({
      kind: "processing",
      label: "Processing",
      detail: "extracting · 1m 12s",
      title: null,
    });
    expect(statusChip({ ...base, status: "processing" }, NOW).detail).toBe("starting · 1m 12s");
  });

  it("is its own kind for a completed document that needs review", () => {
    expect(statusChip({ ...base, status: "completed", needs_review: true }, NOW)).toMatchObject({
      kind: "review",
      label: "Needs review",
    });
  });

  it("says in words why a document failed, with the full message for hover", () => {
    expect(
      statusChip(
        {
          ...base,
          status: "failed",
          error_code: "NO_TEXT_LAYER",
          error_message: "PDF has no extractable text (likely scanned). OCR is not supported.",
        },
        NOW,
      ),
    ).toEqual({
      kind: "failed",
      label: "Failed",
      detail: "scanned pdf, no text to read",
      title: "PDF has no extractable text (likely scanned). OCR is not supported.",
    });
    expect(statusChip({ ...base, status: "failed" }, NOW).detail).toBeNull();
  });
});

describe("runHint", () => {
  it("names the requested model while a new run of a document with values is under way", () => {
    const doc = {
      status: "queued",
      requested_model: "gpt-5-mini",
      result_model: "qwen2.5:7b-instruct",
    } as const;

    expect(runHint(doc)).toBe("re-analyzing with gpt-5-mini...");
    expect(runHint({ ...doc, status: "processing" })).toBe("re-analyzing with gpt-5-mini...");
  });

  it("says analyzing for a first run, which has no values yet", () => {
    expect(
      runHint({ status: "processing", requested_model: "qwen2.5:7b-instruct", result_model: null }),
    ).toBe("analyzing with qwen2.5:7b...");
  });

  it("is nothing once the document is done, or when no model is known", () => {
    const done = { requested_model: "gpt-5-mini", result_model: "gpt-5-mini" };
    expect(runHint({ ...done, status: "completed" })).toBeNull();
    expect(runHint({ ...done, status: "failed" })).toBeNull();
    expect(runHint({ status: "queued", requested_model: null, result_model: null })).toBeNull();
  });
});

describe("canReanalyze", () => {
  it("is for documents that are done, either way", () => {
    expect(canReanalyze({ status: "completed" })).toBe(true);
    expect(canReanalyze({ status: "failed" })).toBe(true);
    expect(canReanalyze({ status: "queued" })).toBe(false);
    expect(canReanalyze({ status: "processing" })).toBe(false);
  });
});

function run(overrides: Partial<RunSummary>): RunSummary {
  return {
    run: 1,
    status: "completed",
    error_code: null,
    error_message: null,
    provider: "ollama",
    model: "qwen2.5:7b-instruct",
    prompt_version: "extract.v3",
    grounding_score: 0.9,
    chunk_count: 1,
    input_tokens: 10,
    output_tokens: 20,
    duration_ms: 30,
    created_at: "2026-10-12T10:00:00.000Z",
    latest: false,
    ...overrides,
  };
}

describe("failedRunNote", () => {
  it("says which run failed, why, and which run is shown instead", () => {
    const runs = [
      run({
        run: 2,
        status: "failed",
        error_code: "LLM_AUTH",
        provider: "openai",
        model: "gpt-5-mini",
      }),
      run({ run: 1, latest: true }),
    ];

    expect(failedRunNote(runs)).toBe(
      "run 2 with gpt-5-mini failed (api key rejected), showing run 1",
    );
  });

  it("points at the run that is shown, not simply the one before", () => {
    const runs = [
      run({ run: 4, status: "failed", error_code: "LLM_UNAVAILABLE" }),
      run({ run: 3, status: "failed", error_code: "LLM_UNAVAILABLE" }),
      run({ run: 2, latest: true, model: "gpt-5-mini" }),
      run({ run: 1 }),
    ];

    expect(failedRunNote(runs)).toBe(
      "run 4 with qwen2.5:7b failed (model not reachable), showing run 2",
    );
  });

  it("is nothing when the newest run worked, or when there is no older result to show", () => {
    expect(failedRunNote([run({ run: 2, latest: true }), run({ run: 1 })])).toBeNull();
    expect(
      failedRunNote([run({ run: 1, status: "failed", error_code: "PARSE_ERROR" })]),
    ).toBeNull();
    expect(failedRunNote([])).toBeNull();
  });
});

const field = <T>(value: T | null) => ({
  value,
  quote: value === null ? null : "quoted text",
  confidence: "high" as const,
  quote_verified: value !== null,
  quote_page: value === null ? null : 1,
});

function result(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return ExtractionResultSchema.parse({
    document_type: field("contract"),
    vendor_name: field("Acme Ltd"),
    customer_name: field("Nexus Corp"),
    payment_terms: field("Net 30"),
    governing_law: field("England"),
    liability_cap: field(null),
    effective_date: field("2025-07-12"),
    expiration_date: { ...field("2026-07-11"), quote: "and expires on 11 July 2026" },
    initial_term_months: field(12),
    renewal_term_months: field(12),
    termination_notice_days: field(30),
    auto_renewal: field(true),
    total_contract_value: field({ amount: 120000, currency: "USD" }),
    risk_clauses: [],
    summary: "A contract.",
    derived: {
      expiration_date: "2026-07-11",
      expiration_source: "stated",
      current_term_end: "2026-07-11",
      next_renewal_date: "2026-07-12",
      notice_deadline: "2026-06-11",
      days_until_notice_deadline: 10,
      alerts: [],
    },
    conflicts: [],
    warnings: [],
    grounding_score: 0.9,
    ...overrides,
  });
}

describe("diffRuns", () => {
  it("has one row per extracted field plus notice deadline, risks and grounding", () => {
    const rows = diffRuns(result(), result());

    expect(rows.map((r) => r.label)).toEqual([
      "Type",
      "Vendor",
      "Customer",
      "Payment terms",
      "Governing law",
      "Liability cap",
      "Effective",
      "Expiration",
      "Initial term",
      "Renewal term",
      "Notice days",
      "Auto renewal",
      "Total value",
      "Notice deadline",
      "Risks",
      "Grounding",
    ]);
    expect(countDifferences(rows)).toBe(0);
  });

  it("marks the fields two runs disagree on and shows both values", () => {
    const other = result({
      vendor_name: field("Acme Limited"),
      total_contract_value: field({ amount: 84000, currency: "EUR" }),
      termination_notice_days: field(60),
      liability_cap: field("12 months of fees"),
      grounding_score: 0.62,
    });

    const rows = diffRuns(result(), other);
    const changed = rows.filter((r) => !r.same);

    expect(changed).toEqual([
      { label: "Vendor", left: "Acme Ltd", right: "Acme Limited", same: false },
      { label: "Liability cap", left: "-", right: "12 months of fees", same: false },
      { label: "Notice days", left: "30 days", right: "60 days", same: false },
      { label: "Total value", left: "US$120,000", right: "€84,000", same: false },
      { label: "Grounding", left: "90%", right: "62%", same: false },
    ]);
    expect(countDifferences(rows)).toBe(5);
  });

  it("does not count a difference in case or spacing", () => {
    const rows = diffRuns(result(), result({ payment_terms: field("net  30") }));

    expect(rows.find((r) => r.label === "Payment terms")).toMatchObject({
      left: "Net 30",
      right: "net  30",
      same: true,
    });
  });

  it("formats each kind of value as text", () => {
    const r = result();
    expect(fieldText(r, "document_type")).toBe("Contract");
    expect(fieldText(r, "effective_date")).toBe("12 Jul 2025");
    expect(fieldText(r, "initial_term_months")).toBe("12 months");
    expect(fieldText(r, "auto_renewal")).toBe("Yes");
    expect(fieldText(r, "liability_cap")).toBe("-");
  });
});
