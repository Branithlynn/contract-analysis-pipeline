import { LlmExtractionSchema } from "@nexus/shared";
import { describe, expect, it } from "vitest";
import { LlmError } from "./errors.js";
import { MOCK_EXTRACTION, MockProvider } from "./mock.js";
import type { LlmRequest } from "./types.js";

const request: LlmRequest = {
  system: "12345678", // 8 chars
  messages: [
    { role: "user", content: "abcdefghij" }, // 10 chars
    { role: "assistant", content: "x" }, // 1 char
  ],
  schema: {},
  schemaName: "extraction",
  timeoutMs: 1000,
  maxOutputTokens: 100,
};

describe("MockProvider", () => {
  it("is named mock", () => {
    expect(new MockProvider()).toMatchObject({ name: "mock", model: "mock" });
  });

  it("returns a default extraction that passes the llm schema", async () => {
    const res = await new MockProvider().complete(request);

    expect(LlmExtractionSchema.safeParse(res.json).error).toBeUndefined();
    expect(res.json).toBe(MOCK_EXTRACTION);
  });

  it("defaults to nothing found: null values, empty quotes, low confidence, type other", () => {
    const { document_type, risk_clauses, summary, ...fields } = MOCK_EXTRACTION;

    expect(document_type).toEqual({ value: "other", quote: "", confidence: "low" });
    for (const field of Object.values(fields)) {
      expect(field).toEqual({ value: null, quote: "", confidence: "low" });
    }
    expect(risk_clauses).toEqual([]);
    expect(summary).toBe("Mock extraction.");
  });

  it("reports ceil(chars / 4) input tokens over system and messages, 100 output", async () => {
    const res = await new MockProvider().complete(request);

    // 8 + 10 + 1 = 19 chars -> 5 tokens
    expect(res.usage).toEqual({ inputTokens: 5, outputTokens: 100 });
    expect(res.model).toBe("mock");
  });

  it("uses the responder's json and stringifies it as rawText", async () => {
    const provider = new MockProvider(() => ({ term: "12 months" }));

    const res = await provider.complete(request);

    expect(res.json).toEqual({ term: "12 months" });
    expect(res.rawText).toBe('{"term":"12 months"}');
  });

  it("awaits an async responder", async () => {
    const provider = new MockProvider(() => Promise.resolve({ ok: true }));

    expect((await provider.complete(request)).json).toEqual({ ok: true });
  });

  it("propagates a thrown LlmError so tests can simulate provider failures", async () => {
    const failure = new LlmError("unavailable", "down");
    const provider = new MockProvider(() => {
      throw failure;
    });

    await expect(provider.complete(request)).rejects.toBe(failure);
  });

  it("records every request", async () => {
    const provider = new MockProvider();

    await provider.complete(request);
    await provider.complete({ ...request, schemaName: "repair" });

    expect(provider.calls.map((c) => c.schemaName)).toEqual(["extraction", "repair"]);
  });
});
