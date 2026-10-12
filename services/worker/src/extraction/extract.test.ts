import { ErrorCode, LlmExtractionSchema, llmExtractionJsonSchema } from "@nexus/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LlmError } from "../llm/errors.js";
import { MOCK_EXTRACTION, MockProvider } from "../llm/mock.js";
import {
  EMPTY_REPLY_NOTE,
  MAX_OUTPUT_TOKENS,
  SCHEMA_NAME,
  TRUNCATED_NOTE,
  buildRepairConversation,
  buildRepairMessage,
  buildRetryConversation,
  buildSystemPrompt,
  buildUserMessage,
} from "../llm/prompts/extract.v1.js";
import { extractPrompt } from "../llm/prompts/extract.js";
import type { LlmRequest } from "../llm/types.js";
import { PermanentError } from "../pipeline/errors.js";
import { extractChunk } from "./extract.js";

const chunk = { index: 1, text: "[[page 2]]\n4. Fees\n\nUSD 1,000 per month." };
const opts = {
  filename: "msa.pdf",
  chunkCount: 3,
  timeoutMs: 5000,
  prompt: extractPrompt("extract.v1"),
};
const doc = buildUserMessage({
  filename: "msa.pdf",
  text: chunk.text,
  chunkIndex: 1,
  chunkCount: 3,
});

// Each call takes the next step; a step either returns json or throws.
function scripted(...steps: ((req: LlmRequest) => unknown)[]): MockProvider {
  let call = 0;
  return new MockProvider((req) => {
    const step = steps[call++];
    if (!step) throw new Error(`unexpected call ${String(call)}`);
    return step(req);
  });
}

// Same chars/4 estimate MockProvider reports.
function mockInputTokens(req: LlmRequest | undefined): number {
  if (!req) return 0;
  return Math.ceil(req.messages.reduce((n, m) => n + m.content.length, req.system.length) / 4);
}

const ok = () => MOCK_EXTRACTION;
const broken = () => ({ ...MOCK_EXTRACTION, vendor_name: { value: null, quote: null } });

describe("extractChunk", () => {
  it("returns the parsed extraction from one call when the reply is valid", async () => {
    const provider = scripted(ok);

    const result = await extractChunk(provider, chunk, opts);

    expect(result).toMatchObject({ chunkIndex: 1, data: MOCK_EXTRACTION, repaired: false });
    expect(result.usage.outputTokens).toBe(100);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.calls).toEqual([
      {
        kind: "extract",
        chunkIndex: 1,
        ok: true,
        durationMs: expect.any(Number) as number,
        usage: result.usage,
        numCtx: null,
        rawText: JSON.stringify(MOCK_EXTRACTION),
      },
    ]);
    expect(provider.calls).toEqual([
      {
        system: buildSystemPrompt(),
        messages: [{ role: "user", content: doc }],
        schema: llmExtractionJsonSchema(),
        schemaName: SCHEMA_NAME,
        timeoutMs: 5000,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      },
    ]);
  });

  it("sends the system prompt and schema of the prompt version it is given, on the repair too", async () => {
    const provider = scripted(broken, ok);
    const v2 = extractPrompt("extract.v2");

    await extractChunk(provider, chunk, { ...opts, prompt: v2 });

    expect(v2.system).not.toBe(buildSystemPrompt());
    for (const call of provider.calls) {
      expect(call.system).toBe(v2.system);
      expect(call.schema).toEqual(v2.schema);
      expect(call.schemaName).toBe(SCHEMA_NAME);
    }
    // The document message is the same in every version.
    expect(provider.calls[0]?.messages).toEqual([{ role: "user", content: doc }]);
  });

  it("lowercases enum strings so 'High' doesn't cost a repair call", async () => {
    const provider = scripted(() => ({
      ...MOCK_EXTRACTION,
      document_type: { value: "Contract", quote: "Master Agreement", confidence: "High" },
      vendor_name: { value: "Acme", quote: "Acme Ltd", confidence: "MEDIUM" },
      risk_clauses: [
        {
          category: "Auto_Renewal",
          severity: "High",
          title: "Renews",
          explanation: "Locks Nexus in.",
          quote: "renews automatically",
        },
      ],
    }));

    const result = await extractChunk(provider, chunk, opts);

    expect(provider.calls).toHaveLength(1);
    expect(result.repaired).toBe(false);
    expect(result.data.document_type).toEqual({
      value: "contract",
      quote: "Master Agreement",
      confidence: "high",
    });
    expect(result.data.vendor_name).toEqual({
      value: "Acme",
      quote: "Acme Ltd",
      confidence: "medium",
    });
    expect(result.data.risk_clauses[0]).toMatchObject({
      category: "auto_renewal",
      severity: "high",
    });
    // The recorded reply is the model's, not our lowercased copy.
    expect(result.calls[0]?.rawText).toContain('"severity":"High"');
    expect(result.calls[0]?.rawText).toContain('"confidence":"MEDIUM"');
  });

  it("repairs a schema failure once with its own reply and the zod errors, summing usage", async () => {
    const provider = scripted(broken, ok);

    const result = await extractChunk(provider, chunk, opts);

    expect(result.repaired).toBe(true);
    expect(result.data).toEqual(MOCK_EXTRACTION);
    const [first, second] = provider.calls;
    expect(result.usage).toEqual({
      inputTokens: mockInputTokens(first) + mockInputTokens(second),
      outputTokens: 200,
    });
    const parsed = LlmExtractionSchema.safeParse(broken());
    const errors = parsed.success ? "" : z.prettifyError(parsed.error);
    expect(errors).toContain("vendor_name.quote");
    expect(second?.messages).toEqual(
      buildRepairConversation(doc, JSON.stringify(broken()), errors),
    );
    expect(result.calls.map((call) => [call.kind, call.ok])).toEqual([
      ["extract", false],
      ["repair", true],
    ]);
    expect(result.calls[0]?.usage.outputTokens).toBe(100);
    // Each call keeps its own reply, the rejected one included.
    expect(result.calls.map((call) => call.rawText)).toEqual([
      JSON.stringify(broken()),
      JSON.stringify(ok()),
    ]);
  });

  it("records the num_ctx of each call when the provider has one", async () => {
    const provider = scripted(broken, ok);
    // Like ollama: the repair carries the bad reply, so it needs a bigger context.
    const sized = Object.assign(provider, {
      numCtx: (req: LlmRequest) => (req.messages.length > 1 ? 12288 : 8192),
    });

    const result = await extractChunk(sized, chunk, opts);

    expect(result.calls.map((call) => call.numCtx)).toEqual([8192, 12288]);
  });

  it("cuts the error list for the repair call to 2000 chars", async () => {
    const manyBad = () => ({
      ...MOCK_EXTRACTION,
      risk_clauses: Array.from({ length: 200 }, () => ({ severity: 1 })),
    });
    const provider = scripted(manyBad, ok);

    await extractChunk(provider, chunk, opts);

    const message = provider.calls[1]?.messages[2]?.content ?? "";
    const overhead = buildRepairMessage("").length;
    expect(message.length - overhead).toBe(2000);
  });

  it("fails with EXTRACTION_INVALID and the error summary when the repair is broken too", async () => {
    const provider = scripted(broken, broken);

    const err = await extractChunk(provider, chunk, opts).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PermanentError);
    expect(err).toMatchObject({ code: ErrorCode.EXTRACTION_INVALID });
    expect((err as Error).message).toContain("vendor_name.quote");
    expect(provider.calls).toHaveLength(2);
  });

  it("repairs bad_output with the raw reply and a not-valid-json note", async () => {
    const provider = scripted(() => {
      throw new LlmError("bad_output", "model output is not valid json", '{"vendor_name": oops');
    }, ok);

    const result = await extractChunk(provider, chunk, opts);

    expect(result.repaired).toBe(true);
    expect(provider.calls[1]?.messages).toEqual(
      buildRepairConversation(doc, '{"vendor_name": oops', "Reply was not valid JSON"),
    );
    expect(result.calls[0]).toMatchObject({ ok: false, rawText: '{"vendor_name": oops' });
  });

  it("records a null reply for a bad_output error that came without one", async () => {
    const provider = scripted(() => {
      throw new LlmError("bad_output", "reply has no text block");
    }, ok);

    const result = await extractChunk(provider, chunk, opts);

    expect(result.calls.map((call) => [call.kind, call.ok, call.rawText])).toEqual([
      ["extract", false, null],
      ["retry", true, JSON.stringify(MOCK_EXTRACTION)],
    ]);
  });

  it("retries a truncated reply without sending the cut-off text back", async () => {
    const provider = scripted(() => {
      throw new LlmError(
        "bad_output",
        "output stopped at num_predict",
        '{"vendor_name": {"quote": "aaaa',
        { truncated: true },
      );
    }, ok);

    const result = await extractChunk(provider, chunk, opts);

    expect(result.repaired).toBe(true);
    expect(result.calls.map((call) => call.kind)).toEqual(["extract", "retry"]);
    expect(provider.calls[1]?.messages).toEqual(buildRetryConversation(doc, TRUNCATED_NOTE));
  });

  it("retries an empty reply with the empty note instead of an empty assistant turn", async () => {
    const provider = scripted(() => {
      throw new LlmError("bad_output", "reply has no text block", "  ");
    }, ok);

    const result = await extractChunk(provider, chunk, opts);

    expect(result.repaired).toBe(true);
    expect(provider.calls[1]?.messages).toEqual(buildRetryConversation(doc, EMPTY_REPLY_NOTE));
  });

  it("counts the tokens of a failed call in the usage", async () => {
    const provider = scripted(() => {
      throw new LlmError("bad_output", "model output is not valid json", "{", {
        usage: { inputTokens: 700, outputTokens: 4096 },
      });
    }, ok);

    const result = await extractChunk(provider, chunk, opts);

    expect(result.usage).toEqual({
      inputTokens: 700 + mockInputTokens(provider.calls[1]),
      outputTokens: 4096 + 100,
    });
  });

  it("fails with EXTRACTION_INVALID when the repair call returns bad_output too", async () => {
    const badOutput = () => {
      throw new LlmError("bad_output", "model output is not valid json", "{");
    };
    const provider = scripted(badOutput, badOutput);

    const err = await extractChunk(provider, chunk, opts).catch((e: unknown) => e);

    expect(err).toMatchObject({ code: ErrorCode.EXTRACTION_INVALID });
    expect((err as Error).message).toContain("not valid json");
  });

  it("does not repair other llm failures, bullmq retries those", async () => {
    const timeout = new LlmError("timeout", "no answer");
    const provider = scripted(() => {
      throw timeout;
    });

    await expect(extractChunk(provider, chunk, opts)).rejects.toBe(timeout);
    expect(provider.calls).toHaveLength(1);
  });
});
