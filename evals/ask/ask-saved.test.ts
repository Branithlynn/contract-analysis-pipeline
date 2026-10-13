import { describe, expect, it } from "vitest";
import { SavedAskFileSchema, rescoreAskRun } from "./ask-saved.js";
import { askPassed, type AskCase, type NamedContract } from "./ask-score.js";

const CORPUS: NamedContract[] = [
  { file: "consulting-sow.docx", names: ["Meridian"] },
  { file: "mutual-nda.docx", names: ["Northpeak"] },
];

const SOW: AskCase = {
  id: "sow-end-date",
  kind: "structured",
  question: "When does the consulting statement of work end?",
  expect_contracts: ["consulting-sow.docx"],
  expect_facts: ["2026-08-31"],
  expect_tools: [{ any_of: ["find_contracts", "get_contract", "search_clauses"] }],
  must_not: [],
};

// One run as ask.ts writes it, with the score the scorer gave it back then.
function saved(): unknown {
  return {
    header: {
      provider: "openai",
      model: "gpt-5-mini",
      prompt_version: "ask.v2",
      embed_provider: "ollama",
      embed_model: "nomic-embed-text",
      date: "2026-10-13",
      clock: "2026-10-09",
      cpu: "Test CPU (8 threads)",
      repeat: 1,
      max_steps: 6,
      timeout_ms: 180000,
    },
    runs: [
      {
        label: "sow-end-date",
        kind: "structured",
        question: SOW.question,
        status: "done",
        error_message: null,
        answer: '"continues until 31 August 2026, when it expires." [chunk:82]',
        citations: [
          {
            marker: "[chunk:82]",
            start: 51,
            kind: "chunk",
            id: "82",
            status: "verified",
            document_id: "71f0",
            file_name: "consulting-sow.docx",
            page_start: null,
            page_end: null,
            quotes: [],
          },
        ],
        steps: [{ tool: "search_clauses", input: { query: "term ends" }, result: "6 passages" }],
        model_calls: 0,
        latency_ms: 4768,
        tokens: null,
        score: { tools_ok: false, missed_facts: ["2026-08-31"] },
      },
    ],
  };
}

describe("a saved ask run", () => {
  it("is scored again with the current scorer, whatever score it was saved with", () => {
    const file = SavedAskFileSchema.parse(saved());
    const [run] = file.runs;
    if (run === undefined) throw new Error("no run");

    const again = rescoreAskRun(run, SOW, CORPUS);

    expect(again.score).toMatchObject({ missed_facts: [], tools_ok: true, missed_contracts: [] });
    expect(askPassed(again.status, again.score)).toBe(true);
    // What the run measured stays as it was saved.
    expect(again).toMatchObject({ model_calls: 0, tokens: null, latency_ms: 4768 });
  });

  it("is refused when it is not one", () => {
    expect(SavedAskFileSchema.safeParse({ header: {}, runs: [] }).success).toBe(false);
    expect(SavedAskFileSchema.safeParse({ runs: [{ label: "x" }] }).success).toBe(false);
  });
});
