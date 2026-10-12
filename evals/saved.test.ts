import { describe, expect, it } from "vitest";
import { casePassed, type ExpectedCase } from "./score.js";
import { SavedFileSchema, caseName, rescoreRun, type SavedRun } from "./saved.js";

const CLOCK = "2026-10-09";
const THRESHOLD = 0.8;

function field<T>(value: T | null, verified = value !== null) {
  return {
    value,
    quote: verified ? "quote" : null,
    confidence: "high" as const,
    quote_verified: verified,
    quote_page: null,
  };
}

// The shape run.ts wrote before suspected_injections and per call data existed, with the two
// things the first real runs got wrong: a made up expiration date and a country code.
function savedFile(): unknown {
  return {
    header: {
      provider: "ollama",
      model: "qwen2.5:7b-instruct",
      prompt_version: "extract.v1",
      date: "2026-10-11",
      clock: CLOCK,
      cpu: "test cpu (8 threads)",
      repeat: 1,
    },
    runs: [
      {
        label: "msa",
        status: "completed",
        error_code: null,
        error_message: null,
        latency_ms: 634500,
        meta: { chunks: 7, inputTokens: 20400, outputTokens: 4471 },
        score: { needs_review: true, field_accuracy: { correct: 99, total: 99 } },
        result: {
          document_type: field("contract"),
          vendor_name: field("Atlas Ridge Technologies LLC"),
          customer_name: field("Nexus Corp"),
          payment_terms: field<string>(null),
          governing_law: field("DE"),
          liability_cap: field<string>(null),
          effective_date: field("2026-02-01"),
          expiration_date: field("2024-10-01", false),
          initial_term_months: field(24),
          renewal_term_months: field(12),
          termination_notice_days: field(90),
          auto_renewal: field(true),
          total_contract_value: field<{ amount: number; currency: string }>(null),
          risk_clauses: [],
          summary: "A services agreement.",
          derived: {
            expiration_date: "2024-10-01",
            expiration_source: "stated",
            current_term_end: "2028-01-31",
            next_renewal_date: "2028-02-01",
            notice_deadline: "2027-11-02",
            days_until_notice_deadline: 389,
            alerts: [],
          },
          conflicts: [],
          warnings: [],
          grounding_score: 0.94,
        },
      },
      {
        label: "scan #2",
        status: "failed",
        error_code: "NO_TEXT_LAYER",
        error_message: "no text",
        latency_ms: 4,
        meta: null,
        score: { needs_review: false },
        result: null,
      },
    ],
  };
}

const MSA: ExpectedCase = {
  file: "samples/generated/master-services-agreement.pdf",
  expect_status: "completed",
  fields: { vendor_name: "Atlas Ridge Technologies LLC", governing_law: "Delaware" },
  must_be_null: [],
  risk_categories: [],
  must_not_risk_categories: [],
  derived: { expiration_date: "2028-01-31", notice_deadline: "2027-11-02" },
  injection_check: null,
};

function msaRun(): SavedRun {
  const run = SavedFileSchema.parse(savedFile()).runs[0];
  if (!run) throw new Error("fixture has no runs");
  return run;
}

describe("SavedFileSchema", () => {
  it("reads a run saved before the newer fields existed", () => {
    const parsed = SavedFileSchema.parse(savedFile());

    expect(parsed.header.clock).toBe(CLOCK);
    expect(parsed.runs[0]?.result?.suspected_injections).toEqual([]);
    expect(parsed.runs[0]?.meta?.calls).toBeUndefined();
    expect(parsed.runs[1]?.result).toBeNull();
  });

  it("keeps the raw reply of each call, and reads a call saved without one", () => {
    const call = {
      kind: "extract",
      chunkIndex: 0,
      ok: true,
      durationMs: 1200,
      usage: { inputTokens: 900, outputTokens: 300 },
      numCtx: 8192,
    };
    const file = savedFile() as { runs: { meta: Record<string, unknown> | null }[] };
    const meta = file.runs[0]?.meta;
    if (!meta) throw new Error("fixture has no meta");
    meta.calls = [
      { ...call, rawText: '{"vendor_name": "Atlas"}' },
      { ...call, rawText: null },
      call,
    ];

    const calls = SavedFileSchema.parse(file).runs[0]?.meta?.calls ?? [];

    expect(calls.map((c) => c.rawText)).toEqual(['{"vendor_name": "Atlas"}', null, undefined]);
  });

  it("rejects a file that is not a saved run", () => {
    expect(SavedFileSchema.safeParse({ header: {}, runs: [] }).success).toBe(false);
    expect(SavedFileSchema.safeParse({ runs: [] }).success).toBe(false);
  });
});

describe("caseName", () => {
  it("drops the repeat number", () => {
    expect(caseName("saas-subscription-pdf #2")).toBe("saas-subscription-pdf");
    expect(caseName("mutual-nda")).toBe("mutual-nda");
  });
});

describe("rescoreRun", () => {
  it("rebuilds the derived dates with the current deriveDates before scoring", () => {
    const rescored = rescoreRun(msaRun(), MSA, CLOCK, THRESHOLD);

    // The saved derived block said 2024-10-01, from a stated date with no quote.
    expect(rescored.score.wrong_derived).toEqual([]);
    expect(rescored.score.derived_accuracy).toEqual({ correct: 2, total: 2 });
  });

  it("scores with the current scorer, not the saved score", () => {
    const rescored = rescoreRun(msaRun(), MSA, CLOCK, THRESHOLD);

    expect(rescored.score.field_accuracy).toEqual({ correct: 1, total: 2 });
    expect(rescored.score.wrong_fields).toEqual([
      { field: "governing_law", expected: "Delaware", actual: "DE" },
    ]);
    expect(casePassed(rescored.score)).toBe(false);
  });

  it("keeps what only the pipeline can know: needs_review, latency and tokens", () => {
    const rescored = rescoreRun(msaRun(), MSA, CLOCK, THRESHOLD);

    expect(rescored.score.needs_review).toBe(true);
    expect(rescored.latency_ms).toBe(634500);
    expect(rescored.meta).toMatchObject({ chunks: 7, inputTokens: 20400, outputTokens: 4471 });
  });

  it("does not make up the injection alert for a run from before the filter", () => {
    const expected: ExpectedCase = {
      ...MSA,
      expect_alerts: ["prompt_injection_suspected"],
    };

    const rescored = rescoreRun(msaRun(), expected, CLOCK, THRESHOLD);

    expect(rescored.score.missing_alerts).toEqual(["prompt_injection_suspected"]);
  });

  it("scores a failed document without a result", () => {
    const failed = SavedFileSchema.parse(savedFile()).runs[1];
    if (!failed) throw new Error("fixture has no failed run");
    const expected: ExpectedCase = {
      ...MSA,
      expect_status: "failed",
      expect_error_code: "NO_TEXT_LAYER",
      fields: {},
      derived: {},
    };

    expect(casePassed(rescoreRun(failed, expected, CLOCK, THRESHOLD).score)).toBe(true);
  });
});
