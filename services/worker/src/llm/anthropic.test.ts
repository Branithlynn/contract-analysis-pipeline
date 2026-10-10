import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
} from "@anthropic-ai/sdk";
import type { ContentBlock } from "@anthropic-ai/sdk/resources/messages";
import { describe, expect, it, vi } from "vitest";
import { createAnthropicProvider, type AnthropicClient, type AnthropicReply } from "./anthropic.js";
import { LlmError, type LlmErrorKind } from "./errors.js";
import type { LlmRequest } from "./types.js";

const request: LlmRequest = {
  system: "You extract contract facts.",
  messages: [{ role: "user", content: "<document>Term: 12 months</document>" }],
  schema: { type: "object", properties: { term: { type: "string" } } },
  schemaName: "extraction",
  timeoutMs: 5000,
  maxOutputTokens: 4096,
};

function text(value: string): ContentBlock {
  return { type: "text", text: value, citations: null };
}

function reply(overrides: Partial<AnthropicReply> = {}): AnthropicReply {
  return {
    content: [text('{"term":"12 months"}')],
    model: "claude-test-model",
    stop_reason: "end_turn",
    stop_details: null,
    usage: { input_tokens: 900, output_tokens: 40 },
    ...overrides,
  };
}

function setup(create: AnthropicClient["messages"]["create"]) {
  const createMock = vi.fn(create);
  const provider = createAnthropicProvider({
    apiKey: "test-key",
    model: "claude-test-model",
    client: { messages: { create: createMock } },
  });
  return { provider, createMock };
}

async function expectLlmError(promise: Promise<unknown>): Promise<LlmError> {
  const err: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(LlmError);
  return err as LlmError;
}

const headers = new Headers();

describe("createAnthropicProvider", () => {
  it("exposes name and model", () => {
    const { provider } = setup(() => Promise.resolve(reply()));

    expect(provider).toMatchObject({ name: "anthropic", model: "claude-test-model" });
  });

  it("puts the schema in the system prompt, with no output format, tools or temperature", async () => {
    const { provider, createMock } = setup(() => Promise.resolve(reply()));

    await provider.complete(request);

    expect(createMock).toHaveBeenCalledOnce();
    const [body, opts] = createMock.mock.calls[0] ?? [];
    expect(body).toEqual({
      model: "claude-test-model",
      max_tokens: 4096,
      system:
        "You extract contract facts.\n\nReply with a single JSON object that matches this JSON Schema:\n" +
        '{"type":"object","properties":{"term":{"type":"string"}}}',
      messages: [{ role: "user", content: "<document>Term: 12 months</document>" }],
      output_config: { effort: "low" },
    });
    expect(opts).toEqual({ timeout: 5000 });
  });

  it.each([
    ["a ```json fence", '```json\n{"term":"12 months"}\n```'],
    ["a bare ``` fence", '```\n{"term":"12 months"}\n```'],
    ["a fence with surrounding whitespace", '\n  ```JSON  \n{"term":"12 months"}```\n'],
  ])("strips %s before parsing and keeps rawText as written", async (_label, output) => {
    const { provider } = setup(() => Promise.resolve(reply({ content: [text(output)] })));

    const res = await provider.complete(request);

    expect(res.json).toEqual({ term: "12 months" });
    expect(res.rawText).toBe(output);
  });

  it("leaves text alone when the fence doesn't wrap the whole reply", async () => {
    const output = 'Here you go:\n```json\n{"term":"12 months"}\n```';
    const { provider } = setup(() => Promise.resolve(reply({ content: [text(output)] })));

    const err = await expectLlmError(provider.complete(request));

    expect(err.kind).toBe("bad_output");
    expect(err.rawText).toBe(output);
  });

  it("maps a fenced reply that still isn't json to bad_output with the fence in rawText", async () => {
    const output = '```json\n{"term": "12 mon\n```';
    const { provider } = setup(() => Promise.resolve(reply({ content: [text(output)] })));

    const err = await expectLlmError(provider.complete(request));

    expect(err.kind).toBe("bad_output");
    expect(err.rawText).toBe(output);
  });

  it("returns parsed json, raw text, usage, model and latency", async () => {
    const { provider } = setup(() => Promise.resolve(reply()));

    const res = await provider.complete(request);

    expect(res).toMatchObject({
      json: { term: "12 months" },
      rawText: '{"term":"12 months"}',
      usage: { inputTokens: 900, outputTokens: 40 },
      model: "claude-test-model",
    });
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("ignores thinking blocks and joins the text blocks", async () => {
    const { provider } = setup(() =>
      Promise.resolve(
        reply({
          content: [
            { type: "thinking", thinking: "", signature: "sig" },
            text('{"term":'),
            text('"12 months"}'),
          ],
        }),
      ),
    );

    const res = await provider.complete(request);

    expect(res.json).toEqual({ term: "12 months" });
  });

  it("maps a refusal to bad_output with the category and the text", async () => {
    const { provider } = setup(() =>
      Promise.resolve(
        reply({
          content: [text("I can't help with that.")],
          stop_reason: "refusal",
          stop_details: { type: "refusal", category: "general_harms", explanation: null },
        }),
      ),
    );

    const err = await expectLlmError(provider.complete(request));

    expect(err.kind).toBe("bad_output");
    expect(err.message).toContain("refus");
    expect(err.message).toContain("general_harms");
    expect(err.rawText).toBe("I can't help with that.");
  });

  it("maps a refusal that happens to be valid json to bad_output too", async () => {
    const { provider } = setup(() =>
      Promise.resolve(reply({ stop_reason: "refusal", stop_details: null })),
    );

    const err = await expectLlmError(provider.complete(request));

    expect(err.kind).toBe("bad_output");
  });

  it("maps text that isn't json to bad_output and keeps rawText", async () => {
    const { provider } = setup(() =>
      Promise.resolve(reply({ content: [text('{"term": "12 mon')] })),
    );

    const err = await expectLlmError(provider.complete(request));

    expect(err.kind).toBe("bad_output");
    expect(err.rawText).toBe('{"term": "12 mon');
    expect(err.cause).toBeInstanceOf(SyntaxError);
  });

  it("says so when the output hit max_tokens", async () => {
    const { provider } = setup(() =>
      Promise.resolve(reply({ content: [text('{"term": "12 mon')], stop_reason: "max_tokens" })),
    );

    const err = await expectLlmError(provider.complete(request));

    expect(err.kind).toBe("bad_output");
    expect(err.message).toContain("4096");
  });

  it("maps a reply with no text block to bad_output", async () => {
    const { provider } = setup(() => Promise.resolve(reply({ content: [] })));

    const err = await expectLlmError(provider.complete(request));

    expect(err.kind).toBe("bad_output");
    expect(err.rawText).toBe("");
  });

  it.each<[string, () => Error, LlmErrorKind]>([
    ["connection timeout", () => new APIConnectionTimeoutError(), "timeout"],
    [
      "connection error",
      () =>
        new APIConnectionError({ message: "Connection error.", cause: new Error("ECONNRESET") }),
      "unavailable",
    ],
    ["401", () => new AuthenticationError(401, undefined, "bad key", headers), "auth"],
    ["403", () => new PermissionDeniedError(403, undefined, "forbidden", headers), "auth"],
    ["429", () => new RateLimitError(429, undefined, "slow down", headers), "rate_limited"],
    ["409", () => new ConflictError(409, undefined, "conflict", headers), "rate_limited"],
    ["500", () => new InternalServerError(500, undefined, "oops", headers), "unavailable"],
    ["529", () => new InternalServerError(529, undefined, "overloaded", headers), "unavailable"],
    ["400", () => new BadRequestError(400, undefined, "bad schema", headers), "invalid_request"],
    ["404", () => new NotFoundError(404, undefined, "no such model", headers), "invalid_request"],
    [
      "422",
      () => new UnprocessableEntityError(422, undefined, "unprocessable", headers),
      "invalid_request",
    ],
    ["413", () => new APIError(413, undefined, "request too large", headers), "invalid_request"],
  ])("maps %s to %s and keeps the cause", async (_label, makeError, kind) => {
    const sdkError = makeError();
    const { provider } = setup(() => Promise.reject(sdkError));

    const err = await expectLlmError(provider.complete(request));

    expect(err.kind).toBe(kind);
    expect(err.cause).toBe(sdkError);
  });

  it("checks the timeout before the connection error it extends", async () => {
    const { provider } = setup(() => Promise.reject(new APIConnectionTimeoutError()));

    const err = await expectLlmError(provider.complete(request));

    expect(err.kind).toBe("timeout");
    expect(err.message).toContain("5000");
  });

  it("rethrows errors that don't come from the sdk untouched", async () => {
    const bug = new TypeError("undefined is not a function");
    const { provider } = setup(() => Promise.reject(bug));

    await expect(provider.complete(request)).rejects.toBe(bug);
  });
});
