import { describe, expect, it } from "vitest";
import { renderAskReport, type AskHeader, type AskRun } from "./ask-report.js";
import type { AskScore } from "./ask-score.js";

const HEADER: AskHeader = {
  provider: "ollama",
  model: "qwen2.5:7b-instruct",
  prompt_version: "ask.v2",
  embed_provider: "ollama",
  embed_model: "nomic-embed-text",
  date: "2026-10-12",
  clock: "2026-10-09",
  cpu: "Test CPU (8 threads)",
  repeat: 1,
  max_steps: 6,
  timeout_ms: 180000,
};

function score(overrides: Partial<AskScore> = {}): AskScore {
  return {
    contracts: { correct: 1, total: 1 },
    missed_contracts: [],
    extra_contracts: [],
    facts: { correct: 1, total: 1 },
    missed_facts: [],
    tools_ok: true,
    missed_tools: [],
    tools_used: ["find_contracts"],
    citations: { correct: 2, total: 2 },
    forbidden: [],
    answered_without_lookup: false,
    nudges: 0,
    ...overrides,
  };
}

function run(overrides: Partial<AskRun> = {}): AskRun {
  return {
    label: "nearest-notice-deadline",
    kind: "structured",
    question: "What is the nearest notice deadline and for which contract?",
    status: "done",
    error_message: null,
    answer: "Notice for Cloudhaven is due on 2026-11-15 [contract:abc].",
    citations: [],
    steps: [],
    model_calls: 2,
    latency_ms: 4200,
    tokens: { input: 1800, output: 60 },
    score: score(),
    ...overrides,
  };
}

describe("renderAskReport", () => {
  it("prints the header, one row per case and the totals", () => {
    const report = renderAskReport({
      header: HEADER,
      runs: [
        run(),
        run({
          label: "late-payment-charge",
          kind: "semantic",
          model_calls: 3,
          latency_ms: 9000,
          tokens: { input: 5000, output: 120 },
          score: score({
            facts: { correct: 0, total: 1 },
            missed_facts: ["2%"],
            citations: { correct: 1, total: 2 },
            nudges: 1,
            tools_used: ["search_clauses"],
          }),
        }),
      ],
    });

    expect(report).toContain("# Ask eval: ollama / qwen2.5:7b-instruct");
    expect(report).toContain("- prompt version: ask.v2");
    expect(report).toContain("- embeddings: ollama / nomic-embed-text");
    expect(report).toContain("- limits per question: 6 model calls, 180.0s");
    expect(report).toContain(
      "| nearest-notice-deadline | structured | 1/1 | 1/1 | ok | 2/2 (100%) | no | 0 | 2 | 4.2s | 1800 / 60 | pass |",
    );
    expect(report).toContain(
      "| late-payment-charge | semantic | 1/1 | 0/1 | ok | 1/2 (50%) | no | 1 | 3 | 9.0s | 5000 / 120 | FAIL |",
    );
    expect(report).toContain("- cases passed: 1/2");
    expect(report).toContain("- answered: 2/2");
    expect(report).toContain("- expected contracts found: 2/2 (100%)");
    expect(report).toContain("- key facts found: 1/2 (50%)");
    expect(report).toContain("- tool choice right: 2/2 (100%)");
    expect(report).toContain("- citations verified: 3/4 (75%)");
    expect(report).toContain("- answered without lookup: 0 (should be 0)");
    expect(report).toContain("- lookup reminders used: 1");
    expect(report).toContain("- steps: 5 model calls, p50 2 per question");
    expect(report).toContain("- latency: p50 4.2s, max 9.0s");
    expect(report).toContain("- tokens: 6800 in, 180 out");
    expect(report).toContain('- late-payment-charge.facts: expected "2%", not in the answer');
    expect(report).toContain(
      "- nearest-notice-deadline (find_contracts): Notice for Cloudhaven is due on 2026-11-15",
    );
  });

  it("lists every kind of mismatch", () => {
    const report = renderAskReport({
      header: HEADER,
      runs: [
        run({
          label: "nda-total-value",
          score: score({
            contracts: { correct: 0, total: 1 },
            missed_contracts: ["mutual-nda.docx"],
            tools_ok: false,
            missed_tools: ["find_contracts or get_contract"],
            tools_used: [],
            forbidden: ["5,000,000"],
            answered_without_lookup: true,
            nudges: 1,
          }),
        }),
      ],
    });

    expect(report).toContain("| WRONG |");
    expect(report).toContain("| YES | 1 |");
    expect(report).toContain(
      "- nda-total-value.contracts: expected mutual-nda.docx, not named or cited",
    );
    expect(report).toContain(
      "- nda-total-value.tools: expected find_contracts or get_contract, used none",
    );
    expect(report).toContain('- nda-total-value.must_not: "5,000,000" is in the answer');
    expect(report).toContain("- nda-total-value.lookup: answered without calling a tool");
    expect(report).toContain("- must-not strings in answers: 1");
    expect(report).toContain("- answered without lookup: 1 (should be 0)");
    expect(report).toContain("- nda-total-value (no tool): Notice for");
  });

  it("shows a question that got no answer, and a provider without usage", () => {
    const report = renderAskReport({
      header: HEADER,
      runs: [
        run({
          label: "slow",
          status: "timeout",
          answer: null,
          tokens: null,
          score: score({ citations: { correct: 0, total: 0 } }),
        }),
        run({
          label: "broken",
          status: "error",
          error_message: "connect\nECONNREFUSED | 11434",
          answer: null,
          tokens: null,
          score: score({ citations: { correct: 0, total: 0 } }),
        }),
      ],
      notes: ["STOPPED EARLY after 2 of 10 runs."],
    });

    expect(report).toContain("STOPPED EARLY after 2 of 10 runs.");
    expect(report).toContain("| - | - | 0 | 2 | 4.2s | - | FAIL (timeout) |");
    expect(report).toContain("- cases passed: 0/2");
    expect(report).toContain("- answered: 0/2");
    expect(report).toContain("- citations verified: -");
    expect(report).toContain("- tokens: not reported by this provider");
    expect(report).toContain("- slow.status: expected an answer, got timeout");
    // No line break and no pipe from the error text, either would break the markdown.
    expect(report).toContain(
      "- broken.status: expected an answer, got error (connect ECONNREFUSED / 11434)",
    );
    expect(report).toContain("- slow (find_contracts): no answer, timeout");
  });

  it("says when nothing is off", () => {
    const report = renderAskReport({
      header: HEADER,
      runs: [run({ score: score({ extra_contracts: [] }) })],
    });

    expect(report).toContain("## Mismatches\n\nNone.");
    expect(report).toContain("## Other contracts named (listed, not scored)\n\nNone.");
  });

  it("lists contracts an answer named on top of the expected ones", () => {
    const report = renderAskReport({
      header: HEADER,
      runs: [run({ score: score({ extra_contracts: ["hardware-supply.pdf"] }) })],
    });

    expect(report).toContain("- nearest-notice-deadline: hardware-supply.pdf");
  });
});
