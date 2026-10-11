import { describe, expect, it } from "vitest";
import { renderReport, type CallInfo, type CaseRun, type ReportHeader } from "./report.js";
import type { CaseScore } from "./score.js";

const HEADER: ReportHeader = {
  provider: "mock",
  model: "mock",
  prompt_version: "extract.v1",
  date: "2026-10-11",
  clock: "2026-10-09",
  cpu: "test cpu (8 threads)",
  repeat: 1,
};

function score(overrides: Partial<CaseScore> = {}): CaseScore {
  return {
    file: "samples/generated/a.pdf",
    status_ok: true,
    field_accuracy: { correct: 2, total: 2 },
    wrong_fields: [],
    null_precision: { correct: 0, total: 0 },
    not_null: [],
    risk_recall: { correct: 1, total: 1 },
    missed_risks: [],
    false_alarms: [],
    extra_risks: [],
    derived_accuracy: { correct: 1, total: 1 },
    wrong_derived: [],
    injection_passed: null,
    needs_review_ok: null,
    missing_alerts: [],
    needs_review: false,
    review_reasons: [],
    conflicts: [],
    grounding_score: 1,
    ...overrides,
  };
}

function run(label: string, latencyMs: number, overrides: Partial<CaseScore> = {}): CaseRun {
  return {
    label,
    status: "completed",
    error_code: null,
    error_message: null,
    latency_ms: latencyMs,
    meta: { chunks: 1, inputTokens: 100, outputTokens: 10 },
    score: score(overrides),
  };
}

describe("renderReport", () => {
  it("sums correct and total across cases instead of averaging rates", () => {
    const report = renderReport({
      header: HEADER,
      runs: [
        run("a", 1000),
        run("b", 3000, {
          field_accuracy: { correct: 1, total: 8 },
          wrong_fields: [{ field: "payment_terms", expected: "Net 30", actual: null }],
        }),
        run("c", 2000),
      ],
      expectedStatuses: ["completed", "completed", "completed"],
    });

    expect(report).toContain("- cases passed: 2/3");
    expect(report).toContain("- field accuracy: 5/12 (42%)");
    expect(report).toContain("- null precision: -");
    expect(report).toContain("- latency: p50 2.0s, max 3.0s");
    expect(report).toContain("- tokens: 300 in, 30 out");
    expect(report).toContain('- b.payment_terms: expected "Net 30", got null');
  });

  it("lists every kind of mismatch as case.field", () => {
    const report = renderReport({
      header: HEADER,
      runs: [
        run("nda", 10, {
          not_null: ["liability_cap"],
          missed_risks: ["exclusivity"],
          false_alarms: ["uncapped_liability"],
          extra_risks: ["other"],
          wrong_derived: [{ key: "notice_deadline", expected: null, actual: "2027-01-01" }],
          injection_passed: false,
          review_reasons: ["chunks disagree on vendor_name"],
          conflicts: ["vendor_name"],
        }),
      ],
      expectedStatuses: ["completed"],
    });

    expect(report).toContain("- nda.liability_cap: expected null, got a value");
    expect(report).toContain("- nda.risk_categories: expected exclusivity, not reported");
    expect(report).toContain("- nda.risk_categories: expected no uncapped_liability, got one");
    expect(report).toContain('- nda.derived.notice_deadline: expected null, got "2027-01-01"');
    expect(report).toContain("- nda.injection: expected the injected amount to be ignored");
    expect(report).not.toContain("nda.needs_review");
    expect(report).toContain("- nda: other");
    expect(report).toContain("- nda: review, chunks disagree on vendor_name");
    expect(report).toContain("- nda: conflict on vendor_name");
  });

  it("lists a wrong needs_review and a missing alert as mismatches", () => {
    const report = renderReport({
      header: HEADER,
      runs: [
        run("nda", 10, {
          needs_review: false,
          needs_review_ok: false,
          missing_alerts: ["prompt_injection_suspected"],
        }),
      ],
      expectedStatuses: ["completed"],
    });

    expect(report).toContain("- cases passed: 0/1");
    expect(report).toContain("- nda.needs_review: expected true, got false");
    expect(report).toContain("- nda.alerts: expected prompt_injection_suspected, not raised");
  });

  it("lists every call and points out where num_ctx changed", () => {
    const call = (overrides: Partial<CallInfo>): CallInfo => ({
      kind: "extract",
      chunkIndex: 0,
      ok: true,
      durationMs: 1000,
      usage: { inputTokens: 100, outputTokens: 10 },
      numCtx: 8192,
      ...overrides,
    });
    const withCalls = (label: string, calls: CallInfo[]): CaseRun => ({
      ...run(label, 1000),
      meta: { chunks: 1, inputTokens: 100, outputTokens: 10, calls },
    });
    const report = renderReport({
      header: HEADER,
      runs: [
        withCalls("saas", [
          call({ ok: false, durationMs: 140000 }),
          call({ kind: "repair", durationMs: 136000, numCtx: 12288 }),
        ]),
        withCalls("msa", [
          call({ durationMs: 90000 }),
          call({ chunkIndex: 1 }),
          call({ kind: "summary", chunkIndex: null }),
        ]),
      ],
      expectedStatuses: ["completed", "completed"],
    });

    expect(report).toContain(
      "| case | call | kind | chunk | duration | tokens in / out | num_ctx |",
    );
    expect(report).toContain(
      "| saas | 1 | extract (unusable reply) | 1 | 140.0s | 100 / 10 | 8192 |",
    );
    expect(report).toContain("| saas | 2 | repair | 1 | 136.0s | 100 / 10 | 12288 |");
    expect(report).toContain("| msa | 3 | summary | - | 1.0s | 100 / 10 | 8192 |");
    expect(report).toContain("Ollama reloads the model when num_ctx changes");
    expect(report).toContain(
      "- saas: call 2 (repair) ran with num_ctx 12288, the call before it in the same document used 8192",
    );
    expect(report).toContain(
      "- msa: call 1 (extract) ran with num_ctx 8192, the last call of saas used 12288",
    );
  });

  it("says so when num_ctx never changed, when there is none and when calls were not recorded", () => {
    const one = (numCtx: number | null): CaseRun => ({
      ...run("a", 1000),
      meta: {
        chunks: 1,
        inputTokens: 100,
        outputTokens: 10,
        calls: [
          {
            kind: "extract",
            chunkIndex: 0,
            ok: true,
            durationMs: 1000,
            usage: { inputTokens: 100, outputTokens: 10 },
            numCtx,
          },
        ],
      },
    });
    const render = (runs: CaseRun[]) =>
      renderReport({ header: HEADER, runs, expectedStatuses: runs.map(() => "completed") });

    expect(render([one(8192), one(8192)])).toContain("num_ctx was the same for every call.");
    expect(render([one(null)])).toContain("This provider has no num_ctx.");
    expect(render([run("old", 1000)])).toContain("## Calls\n\nNot recorded for this run.");
  });

  it("prints the notes under the header", () => {
    const report = renderReport({
      header: HEADER,
      runs: [run("a", 1000)],
      expectedStatuses: ["completed"],
      notes: ["Rescored from x.json.", "Pipeline changes are not in here."],
    });

    expect(report).toContain(
      "- repeat: 1\n\nRescored from x.json.\n\nPipeline changes are not in here.\n\n## Cases",
    );
  });

  it("reports an expected failure with the right code as a pass and a wrong status as a mismatch", () => {
    const failed: CaseRun = {
      label: "scan",
      status: "failed",
      error_code: "NO_TEXT_LAYER",
      error_message: "no text",
      latency_ms: 5,
      meta: null,
      score: score({
        field_accuracy: { correct: 0, total: 0 },
        risk_recall: { correct: 0, total: 0 },
        derived_accuracy: { correct: 0, total: 0 },
        grounding_score: null,
      }),
    };
    const ok = renderReport({
      header: HEADER,
      runs: [failed],
      expectedStatuses: ["failed NO_TEXT_LAYER"],
    });
    const wrong = renderReport({
      header: HEADER,
      runs: [{ ...failed, score: { ...failed.score, status_ok: false } }],
      expectedStatuses: ["completed"],
    });

    expect(ok).toContain("- cases passed: 1/1");
    expect(ok).toContain("## Mismatches\n\nNone.");
    expect(wrong).toContain(
      "- scan.status: expected completed, got failed NO_TEXT_LAYER (no text)",
    );
  });
});
