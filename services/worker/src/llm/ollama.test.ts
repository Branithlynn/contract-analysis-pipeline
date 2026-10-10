import { llmExtractionJsonSchema } from "@nexus/shared";
import { describe, expect, it, vi } from "vitest";
import { LlmError } from "./errors.js";
import { computeNumCtx, contextFloor, createOllamaProvider } from "./ollama.js";
import * as extract from "./prompts/extract.v1.js";
import * as summary from "./prompts/summary.v1.js";
import type { LlmRequest } from "./types.js";

const FLOOR = 14336;

function numCtxOf(init: RequestInit): number {
  return (JSON.parse(String(init.body)) as { options: { num_ctx: number } }).options.num_ctx;
}

const request: LlmRequest = {
  system: "You extract contract facts.",
  messages: [{ role: "user", content: "<document>Term: 12 months</document>" }],
  schema: { type: "object", properties: { term: { type: "string" } } },
  schemaName: "extraction",
  timeoutMs: 5000,
  maxOutputTokens: 2048,
};

function chatResponse(content: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({
    model: "qwen2.5:7b-instruct",
    message: { role: "assistant", content },
    done: true,
    done_reason: "stop",
    prompt_eval_count: 1200,
    eval_count: 80,
    ...extra,
  });
}

function setup(fetchImpl: (input: string, init: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(fetchImpl);
  const provider = createOllamaProvider({
    baseUrl: "http://ollama:11434/",
    model: "qwen2.5:7b-instruct",
    numCtxFloor: FLOOR,
    fetch: fetchMock,
  });
  return { provider, fetchMock };
}

async function expectLlmError(promise: Promise<unknown>): Promise<LlmError> {
  const err: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(LlmError);
  return err as LlmError;
}

describe("computeNumCtx", () => {
  it("adds chars/3 for the chunk and the system prompt, a margin and the output, rounded up to 1024", () => {
    // 24000/3 = 8000, + 3000/3 = 1000, + 512 + 4096 = 13608 -> 14336
    expect(computeNumCtx(24000, 3000, 4096)).toBe(14336);
  });

  it("grows with the system prompt, so a longer prompt can't silently cut the document", () => {
    // 8000 + 9000/3 = 3000, + 512 + 4096 = 15608 -> 16384
    expect(computeNumCtx(24000, 9000, 4096)).toBe(16384);
  });

  it("rounds a partial chunk up, never down", () => {
    // ceil(1/3) = 1, + 0 + 512 + 0 = 513 -> 1024
    expect(computeNumCtx(1, 0, 0)).toBe(1024);
    // 1536/3 = 512, + 512 = 1024, already a multiple
    expect(computeNumCtx(1536, 0, 0)).toBe(1024);
  });

  it("caps at 32768", () => {
    expect(computeNumCtx(200_000, 3000, 4096)).toBe(32768);
  });
});

describe("createOllamaProvider", () => {
  it("exposes name and model", () => {
    const { provider } = setup(() => Promise.resolve(chatResponse("{}")));

    expect(provider).toMatchObject({ name: "ollama", model: "qwen2.5:7b-instruct" });
  });

  it("posts the documented request body to /api/chat", async () => {
    const { provider, fetchMock } = setup(() => Promise.resolve(chatResponse("{}")));

    await provider.complete(request);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://ollama:11434/api/chat");
    expect(init).toMatchObject({ method: "POST", headers: { "content-type": "application/json" } });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "qwen2.5:7b-instruct",
      stream: false,
      format: request.schema,
      keep_alive: "10m",
      messages: [
        { role: "system", content: "You extract contract facts." },
        { role: "user", content: "<document>Term: 12 months</document>" },
      ],
      options: { temperature: 0, num_ctx: FLOOR, num_predict: 2048 },
    });
  });

  it("appends the field guide to the system prompt", async () => {
    const { provider, fetchMock } = setup(() => Promise.resolve(chatResponse("{}")));
    const schema = {
      type: "object",
      properties: {
        effective_date: { type: "string", description: "Date the agreement starts" },
        severity: { type: "string", enum: ["low", "high"] },
      },
    };

    await provider.complete({ ...request, schema });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1].body)) as {
      messages: { role: string; content: string }[];
      options: { num_ctx: number };
    };
    const system =
      "You extract contract facts.\n\nField definitions:\n" +
      "effective_date: Date the agreement starts\nseverity: one of: low, high";
    expect(body.messages[0]).toEqual({ role: "system", content: system });
    expect(body.options.num_ctx).toBe(FLOOR);
  });

  it("sends the length-capped schema as format and leaves the request's schema alone", async () => {
    const { provider, fetchMock } = setup(() => Promise.resolve(chatResponse("{}")));
    const schema = {
      type: "object",
      properties: { vendor_name: { type: "object", properties: { quote: { type: "string" } } } },
    };

    await provider.complete({ ...request, schema });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1].body)) as { format: unknown };
    expect(body.format).toEqual({
      type: "object",
      properties: {
        vendor_name: {
          type: "object",
          properties: { quote: { type: "string", maxLength: 300 } },
        },
      },
    });
    expect(schema.properties.vendor_name.properties.quote).toEqual({ type: "string" });
  });

  it("gives a normal request the floor, even with a bigger output budget", async () => {
    const { provider, fetchMock } = setup(() => Promise.resolve(chatResponse("{}")));

    await provider.complete({ ...request, maxOutputTokens: 4096 });
    await provider.complete(request);

    expect(fetchMock.mock.calls.map(([, init]) => numCtxOf(init))).toEqual([FLOOR, FLOOR]);
  });

  it("gives a repair conversation that doesn't fit the floor a larger num_ctx, for that call only", async () => {
    const { provider, fetchMock } = setup(() => Promise.resolve(chatResponse("{}")));
    const repair: LlmRequest = {
      ...request,
      maxOutputTokens: 4096,
      messages: [
        { role: "user", content: "x".repeat(24000) },
        { role: "assistant", content: "y".repeat(12000) },
        { role: "user", content: "z".repeat(300) },
      ],
    };

    await provider.complete(repair);
    await provider.complete(request);

    // 27 system + 36300 message chars = 36327 -> 12109 tokens, + 512 + 4096 = 16717 -> 17408
    expect(fetchMock.mock.calls.map(([, init]) => numCtxOf(init))).toEqual([17408, FLOOR]);
  });

  it("gives extraction and summary calls the same floor, so ollama doesn't reload between them", async () => {
    const extraction = {
      system: extract.buildSystemPrompt(),
      schema: llmExtractionJsonSchema(),
      maxOutputTokens: extract.MAX_OUTPUT_TOKENS,
    };
    const summaryCall = {
      system: summary.buildSystemPrompt(),
      schema: summary.summaryJsonSchema(),
      maxOutputTokens: extract.MAX_OUTPUT_TOKENS,
    };
    const floor = contextFloor(24000, [extraction, summaryCall]);
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(chatResponse("{}")),
    );
    const provider = createOllamaProvider({
      baseUrl: "http://ollama:11434",
      model: "qwen2.5:7b-instruct",
      numCtxFloor: floor,
      fetch: fetchMock,
    });
    const short = { role: "user" as const, content: "short" };

    await provider.complete({ ...request, ...extraction, messages: [short] });
    await provider.complete({ ...request, ...summaryCall, messages: [short] });

    expect(floor).toBe(
      Math.max(contextFloor(24000, [extraction]), contextFloor(24000, [summaryCall])),
    );
    expect(fetchMock.mock.calls.map(([, init]) => numCtxOf(init))).toEqual([floor, floor]);
  });

  it("returns parsed json, raw text, usage, model and latency", async () => {
    const { provider } = setup(() => Promise.resolve(chatResponse('{"term":"12 months"}')));

    const res = await provider.complete(request);

    expect(res).toMatchObject({
      json: { term: "12 months" },
      rawText: '{"term":"12 months"}',
      usage: { inputTokens: 1200, outputTokens: 80 },
      model: "qwen2.5:7b-instruct",
    });
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("treats missing token counts as 0, ollama omits prompt_eval_count on a cached prompt", async () => {
    const { provider } = setup(() =>
      Promise.resolve(chatResponse("{}", { prompt_eval_count: undefined, eval_count: undefined })),
    );

    const res = await provider.complete(request);

    expect(res.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("maps connection refused to unavailable and keeps the cause", async () => {
    const cause = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    });
    const { provider } = setup(() => Promise.reject(cause));

    const err = await expectLlmError(provider.complete(request));

    expect(err.kind).toBe("unavailable");
    expect(err.message).toContain("http://ollama:11434");
    expect(err.cause).toBe(cause);
  });

  it("maps an abort to timeout", async () => {
    const { provider } = setup(() =>
      Promise.reject(new DOMException("The operation timed out.", "TimeoutError")),
    );

    const err = await expectLlmError(provider.complete(request));

    expect(err.kind).toBe("timeout");
    expect(err.message).toContain("5000");
  });

  it("actually aborts after timeoutMs", async () => {
    const { provider } = setup(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason);
          });
        }),
    );

    const err = await expectLlmError(provider.complete({ ...request, timeoutMs: 10 }));

    expect(err.kind).toBe("timeout");
  });

  it("maps a model-not-found 404 to invalid_request with the pull command", async () => {
    const { provider } = setup(() =>
      Promise.resolve(
        Response.json(
          { error: 'model "qwen2.5:7b-instruct" not found, try pulling it first' },
          { status: 404 },
        ),
      ),
    );

    const err = await expectLlmError(provider.complete(request));

    expect(err.kind).toBe("invalid_request");
    expect(err.message).toBe(
      "Model qwen2.5:7b-instruct not pulled. Run: ollama pull qwen2.5:7b-instruct",
    );
  });

  it("maps a 404 not about the model (wrong OLLAMA_URL path) to a generic invalid_request", async () => {
    const { provider } = setup(() =>
      Promise.resolve(new Response("404 page not found", { status: 404 })),
    );

    const err = await expectLlmError(provider.complete(request));

    expect(err.kind).toBe("invalid_request");
    expect(err.message).toContain("404");
    expect(err.message).toContain("404 page not found");
  });

  it("maps 429 from something in front of ollama to rate_limited", async () => {
    const { provider } = setup(() =>
      Promise.resolve(new Response("too many requests", { status: 429 })),
    );

    const err = await expectLlmError(provider.complete(request));

    expect(err.kind).toBe("rate_limited");
    expect(err.retryable).toBe(true);
  });

  it("maps other 4xx to invalid_request with the ollama error text", async () => {
    const { provider } = setup(() =>
      Promise.resolve(Response.json({ error: "invalid format schema" }, { status: 400 })),
    );

    const err = await expectLlmError(provider.complete(request));

    expect(err.kind).toBe("invalid_request");
    expect(err.message).toContain("400");
    expect(err.message).toContain("invalid format schema");
  });

  it.each([500, 502, 503])("maps %i to unavailable", async (status) => {
    const { provider } = setup(() =>
      Promise.resolve(Response.json({ error: "server busy" }, { status })),
    );

    const err = await expectLlmError(provider.complete(request));

    expect(err.kind).toBe("unavailable");
    expect(err.message).toContain(String(status));
  });

  it("maps content that isn't json to bad_output and keeps rawText", async () => {
    const { provider } = setup(() => Promise.resolve(chatResponse('{"term": "12 mon')));

    const err = await expectLlmError(provider.complete(request));

    expect(err.kind).toBe("bad_output");
    expect(err.rawText).toBe('{"term": "12 mon');
    expect(err.cause).toBeInstanceOf(SyntaxError);
  });

  it("says so when the output hit num_predict, since that is the usual reason for cut-off json", async () => {
    const { provider } = setup(() =>
      Promise.resolve(chatResponse('{"term": "12 mon', { done_reason: "length" })),
    );

    const err = await expectLlmError(provider.complete(request));

    expect(err.kind).toBe("bad_output");
    expect(err.message).toContain("2048");
  });

  it("maps a 200 with an unexpected envelope to bad_output", async () => {
    const { provider } = setup(() => Promise.resolve(Response.json({ nope: true })));

    const err = await expectLlmError(provider.complete(request));

    expect(err.kind).toBe("bad_output");
    expect(err.rawText).toBe('{"nope":true}');
  });
});
