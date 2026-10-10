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
} from "openai";
import { describe, expect, it, vi } from "vitest";
import { LlmError, type LlmErrorKind } from "./errors.js";
import { createOpenAIProvider, type OpenAIClient, type OpenAIReply } from "./openai.js";
import type { LlmRequest } from "./types.js";

const request: LlmRequest = {
  system: "You extract contract facts.",
  messages: [{ role: "user", content: "<document>Term: 12 months</document>" }],
  schema: { type: "object", properties: { term: { type: "string" } } },
  schemaName: "extraction",
  timeoutMs: 5000,
  maxOutputTokens: 4096,
};

function reply(overrides: Partial<OpenAIReply> = {}): OpenAIReply {
  const text = overrides.output_text ?? '{"term":"12 months"}';
  return {
    output_text: text,
    output: [{ type: "message", content: [{ type: "output_text" }] }],
    status: "completed",
    incomplete_details: null,
    model: "gpt-test-model",
    usage: { input_tokens: 900, output_tokens: 40 },
    ...overrides,
  };
}

function setup(create: OpenAIClient["responses"]["create"]) {
  const createMock = vi.fn(create);
  const provider = createOpenAIProvider({
    apiKey: "test-key",
    model: "gpt-test-model",
    client: { responses: { create: createMock } },
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

describe("createOpenAIProvider", () => {
  it("exposes name and model", () => {
    const { provider } = setup(() => Promise.resolve(reply()));

    expect(provider).toMatchObject({ name: "openai", model: "gpt-test-model" });
  });

  it("sends a strict json_schema request with store off, low reasoning and no temperature", async () => {
    const { provider, createMock } = setup(() => Promise.resolve(reply()));

    await provider.complete(request);

    expect(createMock).toHaveBeenCalledOnce();
    const [body, opts] = createMock.mock.calls[0] ?? [];
    expect(body).toEqual({
      model: "gpt-test-model",
      instructions: "You extract contract facts.",
      input: [{ role: "user", content: "<document>Term: 12 months</document>" }],
      max_output_tokens: 4096,
      store: false,
      reasoning: { effort: "low" },
      text: {
        format: {
          type: "json_schema",
          name: "extraction",
          schema: request.schema,
          strict: true,
        },
      },
    });
    expect(opts).toEqual({ timeout: 5000 });
  });

  it("returns parsed json, raw text, usage, model and latency", async () => {
    const { provider } = setup(() => Promise.resolve(reply()));

    const res = await provider.complete(request);

    expect(res).toMatchObject({
      json: { term: "12 months" },
      rawText: '{"term":"12 months"}',
      usage: { inputTokens: 900, outputTokens: 40 },
      model: "gpt-test-model",
    });
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("treats missing usage as 0", async () => {
    const { provider } = setup(() => {
      const withoutUsage = reply();
      delete withoutUsage.usage;
      return Promise.resolve(withoutUsage);
    });

    const res = await provider.complete(request);

    expect(res.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("maps a refusal to bad_output with the refusal text", async () => {
    const { provider } = setup(() =>
      Promise.resolve(
        reply({
          output_text: "",
          output: [{ type: "message", content: [{ type: "refusal", refusal: "I can't help." }] }],
        }),
      ),
    );

    const err = await expectLlmError(provider.complete(request));

    expect(err.kind).toBe("bad_output");
    expect(err.message).toContain("refused");
    expect(err.rawText).toBe("I can't help.");
  });

  it("maps a content filter stop to bad_output", async () => {
    const { provider } = setup(() =>
      Promise.resolve(
        reply({
          output_text: '{"term":',
          status: "incomplete",
          incomplete_details: { reason: "content_filter" },
        }),
      ),
    );

    const err = await expectLlmError(provider.complete(request));

    expect(err.kind).toBe("bad_output");
    expect(err.message).toContain("content filter");
    expect(err.rawText).toBe('{"term":');
  });

  it("maps text that isn't json to bad_output and keeps rawText", async () => {
    const { provider } = setup(() => Promise.resolve(reply({ output_text: '{"term": "12 mon' })));

    const err = await expectLlmError(provider.complete(request));

    expect(err.kind).toBe("bad_output");
    expect(err.rawText).toBe('{"term": "12 mon');
    expect(err.cause).toBeInstanceOf(SyntaxError);
  });

  it("says so when the output hit max_output_tokens", async () => {
    const { provider } = setup(() =>
      Promise.resolve(
        reply({
          output_text: '{"term": "12 mon',
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
        }),
      ),
    );

    const err = await expectLlmError(provider.complete(request));

    expect(err.kind).toBe("bad_output");
    expect(err.message).toContain("4096");
  });

  it("maps an empty output to bad_output", async () => {
    const { provider } = setup(() => Promise.resolve(reply({ output_text: "", output: [] })));

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
    ["503", () => new InternalServerError(503, undefined, "overloaded", headers), "unavailable"],
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
