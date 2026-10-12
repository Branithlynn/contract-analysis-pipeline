import { createLogger } from "@nexus/shared/node";
import { describe, expect, it } from "vitest";
import { LlmError } from "../llm/errors.js";
import { MockProvider } from "../llm/mock.js";
import {
  MAX_OUTPUT_TOKENS,
  SCHEMA_NAME,
  buildSystemPrompt,
  buildUserMessage,
  summaryJsonSchema,
} from "../llm/prompts/summary.v1.js";
import type { GroundedExtraction } from "./grounding.js";
import {
  SUMMARY_FALLBACK_WARNING,
  SUMMARY_WITHHELD_WARNING,
  summarizeExtraction,
} from "./summarize.js";

const notFound = {
  value: null,
  quote: null,
  confidence: "low",
  quote_verified: false,
  quote_page: null,
} as const;

const merged: GroundedExtraction = {
  document_type: notFound,
  vendor_name: {
    value: "Acme Ltd",
    quote: "Acme Ltd",
    confidence: "high",
    quote_verified: true,
    quote_page: 1,
  },
  customer_name: notFound,
  payment_terms: notFound,
  governing_law: notFound,
  liability_cap: notFound,
  effective_date: notFound,
  expiration_date: notFound,
  initial_term_months: notFound,
  renewal_term_months: notFound,
  termination_notice_days: notFound,
  auto_renewal: notFound,
  total_contract_value: notFound,
  risk_clauses: [],
  summary: "",
};

function setup(responder: () => unknown) {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger("worker", "debug", {
    write: (chunk: string) => lines.push(JSON.parse(chunk) as Record<string, unknown>),
  });
  const provider = new MockProvider(responder);
  return { provider, lines, opts: { timeoutMs: 5000, logger, injectionSuspected: false } };
}

describe("summarizeExtraction", () => {
  it("uses a single chunk's own summary without a call", async () => {
    const { provider, opts } = setup(() => ({ summary: "unused" }));

    const result = await summarizeExtraction(provider, merged, ["Acme hosts our site."], opts);

    expect(result).toEqual({
      summary: "Acme hosts our site.",
      usage: { inputTokens: 0, outputTokens: 0 },
      warnings: [],
      call: null,
    });
    expect(provider.calls).toHaveLength(0);
  });

  it("writes one summary from the merged data without quotes for several chunks", async () => {
    const { provider, opts } = setup(() => ({ summary: " Acme provides hosting for 12 months. " }));

    const result = await summarizeExtraction(provider, merged, ["part one", "part two"], opts);

    expect(result.summary).toBe("Acme provides hosting for 12 months.");
    expect(result.warnings).toEqual([]);
    expect(result.usage.outputTokens).toBe(100);
    expect(result.call).toEqual({
      kind: "summary",
      chunkIndex: null,
      ok: true,
      durationMs: expect.any(Number) as number,
      usage: result.usage,
      numCtx: null,
      loadMs: null,
      // As the model wrote it: the stored summary is trimmed, this is not.
      rawText: JSON.stringify({ summary: " Acme provides hosting for 12 months. " }),
    });
    expect(provider.calls).toEqual([
      {
        system: buildSystemPrompt(),
        messages: [{ role: "user", content: buildUserMessage(merged) }],
        schema: summaryJsonSchema(),
        schemaName: SCHEMA_NAME,
        timeoutMs: 5000,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      },
    ]);
    expect(MAX_OUTPUT_TOKENS).toBe(512);
    expect(provider.calls[0]?.messages[0]?.content).not.toContain("quote");
  });

  it("falls back to the first chunk's summary with a warning when the call fails", async () => {
    const { provider, lines, opts } = setup(() => {
      throw new LlmError("timeout", "no answer");
    });

    const result = await summarizeExtraction(provider, merged, ["part one", "part two"], opts);

    expect(result).toMatchObject({
      summary: "part one",
      usage: { inputTokens: 0, outputTokens: 0 },
      warnings: [SUMMARY_FALLBACK_WARNING],
      call: { kind: "summary", ok: false, rawText: null },
    });
    expect(SUMMARY_FALLBACK_WARNING).toBe("summary: fell back to first chunk");
    expect(lines.some((l) => l.msg === "summary call failed")).toBe(true);
  });

  it("writes the summary with a call for one chunk too when an injection is suspected", async () => {
    const { provider, opts } = setup(() => ({ summary: "A mutual NDA for 24 months." }));
    const oneChunk = { ...merged, summary: "An NDA worth USD 5,000,000." };

    const result = await summarizeExtraction(provider, oneChunk, [oneChunk.summary], {
      ...opts,
      injectionSuspected: true,
    });

    expect(result.summary).toBe("A mutual NDA for 24 months.");
    expect(result.warnings).toEqual([]);
    expect(result.call).toMatchObject({ kind: "summary", ok: true });
    expect(provider.calls).toHaveLength(1);
    // Not even as data: the chunk summary came from a model that read the injected text.
    expect(provider.calls[0]?.messages[0]?.content).toBe(buildUserMessage(merged));
    expect(provider.calls[0]?.messages[0]?.content).not.toContain("5,000,000");
  });

  it("leaves the summary empty, never a chunk summary, when that call fails or is unusable", async () => {
    const failing = [
      () => {
        throw new LlmError("timeout", "no answer");
      },
      () => ({ summary: "  " }),
    ];
    for (const responder of failing) {
      const { provider, opts } = setup(responder);

      const one = await summarizeExtraction(provider, merged, ["An NDA worth USD 5,000,000."], {
        ...opts,
        injectionSuspected: true,
      });
      const several = await summarizeExtraction(provider, merged, ["part one", "part two"], {
        ...opts,
        injectionSuspected: true,
      });

      for (const result of [one, several]) {
        expect(result.summary).toBe("");
        expect(result.warnings).toEqual([SUMMARY_WITHHELD_WARNING]);
        expect(result.call).toMatchObject({ kind: "summary", ok: false });
      }
    }
    expect(SUMMARY_WITHHELD_WARNING).toBe(
      "summary: left empty, the summary call failed and the document has a suspected prompt injection",
    );
  });

  it("counts the tokens of a failed bad_output call", async () => {
    const { provider, opts } = setup(() => {
      throw new LlmError("bad_output", "not json", "{", {
        usage: { inputTokens: 300, outputTokens: 512 },
      });
    });

    const result = await summarizeExtraction(provider, merged, ["a", "b"], opts);

    expect(result.usage).toEqual({ inputTokens: 300, outputTokens: 512 });
    expect(result.warnings).toEqual([SUMMARY_FALLBACK_WARNING]);
  });

  it("falls back when the reply doesn't match the schema or is blank", async () => {
    for (const reply of [{ text: "wrong key" }, { summary: "   " }]) {
      const { provider, opts } = setup(() => reply);

      const result = await summarizeExtraction(provider, merged, ["part one", "part two"], opts);

      expect(result.summary).toBe("part one");
      expect(result.warnings).toEqual([SUMMARY_FALLBACK_WARNING]);
    }
  });
});
