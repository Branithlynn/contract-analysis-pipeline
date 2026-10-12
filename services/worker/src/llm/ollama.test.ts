import { createServer } from "node:http";
import { llmExtractionJsonSchema } from "@nexus/shared";
import { describe, expect, it, vi } from "vitest";
import { LlmError } from "./errors.js";
import { computeNumCtx, contextFloor, createOllamaProvider, type OllamaOptions } from "./ollama.js";
import * as extract from "./prompts/extract.v1.js";
import * as summary from "./prompts/summary.v1.js";
import type { LlmRequest } from "./types.js";

const FLOOR = 14336;

type FetchInit = Parameters<NonNullable<OllamaOptions["fetch"]>>[1];

function numCtxOf(init: FetchInit): number {
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

const encoder = new TextEncoder();

function chunkLine(content: string, extra: Record<string, unknown> = {}): string {
  const chunk = {
    model: "qwen2.5:7b-instruct",
    message: { role: "assistant", content },
    done: false,
    ...extra,
  };
  return JSON.stringify(chunk) + "\n";
}

const DONE = { done: true, done_reason: "stop", prompt_eval_count: 1200, eval_count: 80 };

type StreamEnd = "close" | { error: unknown } | { hangUntilAbort: AbortSignal | null | undefined };

// What ollama sends with stream: true. `pieces` are network packets, not lines, so a test can split
// a line in the middle. `end` is what happens after the last piece.
function streamResponse(pieces: (string | Uint8Array)[], end: StreamEnd = "close"): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) {
        controller.enqueue(typeof piece === "string" ? encoder.encode(piece) : piece);
      }
      if (end === "close") {
        controller.close();
      } else if ("error" in end) {
        controller.error(end.error);
      } else {
        // Like fetch: an abort while the body is being read fails the read with the signal's reason.
        const signal = end.hangUntilAbort;
        signal?.addEventListener("abort", () => {
          controller.error(signal.reason);
        });
      }
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson" } });
}

function undiciError(message: string, props: { name?: string; code?: string }): Error {
  return Object.assign(new Error(message), props);
}

function setup(fetchImpl: (input: string, init: FetchInit) => Promise<Response>) {
  const fetchMock = vi.fn(fetchImpl);
  const provider = createOllamaProvider({
    baseUrl: "http://ollama:11434/",
    model: "qwen2.5:7b-instruct",
    numCtxFloor: FLOOR,
    timeoutMs: 5000,
    fetch: fetchMock,
  });
  return { provider, fetchMock };
}

function tagsResponse(...names: string[]): Response {
  return Response.json({ models: names.map((name) => ({ name, size: 4683087332 })) });
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

describe("ollama check", () => {
  it("asks /api/tags and passes when the model is listed", async () => {
    const { provider, fetchMock } = setup(() =>
      Promise.resolve(tagsResponse("llama3.2:3b", "qwen2.5:7b-instruct")),
    );

    await expect(provider.check?.()).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://ollama:11434/api/tags");
    expect(init?.method).toBe("GET");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("takes a model pulled without a tag as name:latest", async () => {
    const provider = createOllamaProvider({
      baseUrl: "http://ollama:11434",
      model: "qwen2.5",
      numCtxFloor: FLOOR,
      timeoutMs: 5000,
      fetch: () => Promise.resolve(tagsResponse("qwen2.5:latest")),
    });

    await expect(provider.check?.()).resolves.toBeUndefined();
  });

  it("says how to pull the model when it is not listed", async () => {
    const { provider } = setup(() => Promise.resolve(tagsResponse("llama3.2:3b")));

    const err = await expectLlmError(provider.check?.() ?? Promise.resolve());

    expect(err.kind).toBe("invalid_request");
    expect(err.message).toBe(
      "Model qwen2.5:7b-instruct not pulled. Run: ollama pull qwen2.5:7b-instruct",
    );
  });

  it("reports an ollama that is not running as unavailable", async () => {
    const { provider } = setup(() =>
      Promise.reject(new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") })),
    );

    const err = await expectLlmError(provider.check?.() ?? Promise.resolve());

    expect(err.kind).toBe("unavailable");
    expect(err.message).toBe("Cannot reach Ollama at http://ollama:11434");
  });

  it("reports an ollama that does not answer the check within 10 s as a timeout", async () => {
    const { provider } = setup(() =>
      Promise.reject(new DOMException("The operation timed out.", "TimeoutError")),
    );

    const err = await expectLlmError(provider.check?.() ?? Promise.resolve());

    expect(err.kind).toBe("timeout");
    expect(err.message).toBe("Ollama did not answer within 10000ms");
  });

  it("does not take another server on that port for ollama", async () => {
    const { provider: wrongBody } = setup(() => Promise.resolve(Response.json({ hello: 1 })));
    const { provider: wrongStatus } = setup(() =>
      Promise.resolve(new Response("not found", { status: 404 })),
    );

    expect((await expectLlmError(wrongBody.check?.() ?? Promise.resolve())).message).toBe(
      "http://ollama:11434/api/tags did not answer like Ollama",
    );
    expect((await expectLlmError(wrongStatus.check?.() ?? Promise.resolve())).message).toBe(
      "Ollama returned 404 for /api/tags: not found",
    );
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
      stream: true,
      format: request.schema,
      keep_alive: "10m",
      messages: [
        { role: "system", content: "You extract contract facts." },
        { role: "user", content: "<document>Term: 12 months</document>" },
      ],
      options: { temperature: 0, seed: 42, num_ctx: FLOOR, num_predict: 2048 },
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
    // What the eval records per call has to be the number that was really sent.
    expect([provider.numCtx?.(repair), provider.numCtx?.(request)]).toEqual([17408, FLOOR]);
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
    const fetchMock = vi.fn<(url: string, init: FetchInit) => Promise<Response>>(() =>
      Promise.resolve(chatResponse("{}")),
    );
    const provider = createOllamaProvider({
      baseUrl: "http://ollama:11434",
      model: "qwen2.5:7b-instruct",
      numCtxFloor: floor,
      timeoutMs: 5000,
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
    expect(err.truncated).toBe(false);
    expect(err.usage).toEqual({ inputTokens: 1200, outputTokens: 80 });
  });

  it("says so when the output hit num_predict, since that is the usual reason for cut-off json", async () => {
    const { provider } = setup(() =>
      Promise.resolve(chatResponse('{"term": "12 mon', { done_reason: "length" })),
    );

    const err = await expectLlmError(provider.complete(request));

    expect(err.kind).toBe("bad_output");
    expect(err.message).toContain("2048");
    expect(err.truncated).toBe(true);
  });

  it("maps a 200 with an unexpected envelope to bad_output", async () => {
    const { provider } = setup(() => Promise.resolve(Response.json({ nope: true })));

    const err = await expectLlmError(provider.complete(request));

    expect(err.kind).toBe("bad_output");
    expect(err.rawText).toBe('{"nope":true}');
    expect(err.usage).toBeUndefined();
  });

  describe("streaming", () => {
    it("collects the content of all chunks and takes usage from the done chunk", async () => {
      const { provider } = setup(() =>
        Promise.resolve(
          streamResponse([
            chunkLine('{"term":'),
            chunkLine('"12 '),
            chunkLine('months"}'),
            chunkLine("", DONE),
          ]),
        ),
      );

      const res = await provider.complete(request);

      expect(res).toMatchObject({
        json: { term: "12 months" },
        rawText: '{"term":"12 months"}',
        usage: { inputTokens: 1200, outputTokens: 80 },
        model: "qwen2.5:7b-instruct",
      });
    });

    it("puts lines back together when a packet ends mid-line or mid-character", async () => {
      const bytes = encoder.encode(chunkLine('{"term":"12 Monate für"}') + chunkLine("", DONE));
      // 30 lands inside the first line, and cutting after 0xc3 splits the two bytes of "ü".
      const umlaut = bytes.indexOf(0xc3);
      const { provider } = setup(() =>
        Promise.resolve(
          streamResponse([
            bytes.slice(0, 30),
            bytes.slice(30, umlaut + 1),
            bytes.slice(umlaut + 1),
          ]),
        ),
      );

      const res = await provider.complete(request);

      expect(res.json).toEqual({ term: "12 Monate für" });
    });

    it("flags a stream that ended with done_reason length as truncated, with its usage", async () => {
      const { provider } = setup(() =>
        Promise.resolve(
          streamResponse([
            chunkLine('{"term": '),
            chunkLine('"12 mon'),
            chunkLine("", { ...DONE, done_reason: "length", eval_count: 2048 }),
          ]),
        ),
      );

      const err = await expectLlmError(provider.complete(request));

      expect(err.kind).toBe("bad_output");
      expect(err.truncated).toBe(true);
      expect(err.rawText).toBe('{"term": "12 mon');
      expect(err.usage).toEqual({ inputTokens: 1200, outputTokens: 2048 });
    });

    it("maps complete output that isn't json to bad_output, not truncated", async () => {
      const { provider } = setup(() =>
        Promise.resolve(streamResponse([chunkLine("Sure! Here is"), chunkLine(" the json", DONE)])),
      );

      const err = await expectLlmError(provider.complete(request));

      expect(err.kind).toBe("bad_output");
      expect(err.truncated).toBe(false);
      expect(err.rawText).toBe("Sure! Here is the json");
    });

    it("maps a stream that closes before the done chunk to unavailable, so it is retried not repaired", async () => {
      const { provider } = setup(() =>
        Promise.resolve(streamResponse([chunkLine('{"term":'), chunkLine('"12 ')])),
      );

      const err = await expectLlmError(provider.complete(request));

      expect(err.kind).toBe("unavailable");
      expect(err.retryable).toBe(true);
      expect(err.message).toContain("before the answer was complete");
      expect(err.rawText).toBeUndefined();
    });

    it("maps a connection that drops mid-stream to unavailable", async () => {
      const cause = new TypeError("terminated", {
        cause: undiciError("other side closed", { code: "UND_ERR_SOCKET" }),
      });
      const { provider } = setup(() =>
        Promise.resolve(streamResponse([chunkLine('{"term":')], { error: cause })),
      );

      const err = await expectLlmError(provider.complete(request));

      expect(err.kind).toBe("unavailable");
      expect(err.cause).toBe(cause);
    });

    it("maps an error line in the stream to unavailable with ollama's text", async () => {
      const { provider } = setup(() =>
        Promise.resolve(
          streamResponse([
            chunkLine('{"term":'),
            '{"error":"llama runner process has terminated"}\n',
          ]),
        ),
      );

      const err = await expectLlmError(provider.complete(request));

      expect(err.kind).toBe("unavailable");
      expect(err.message).toContain("llama runner process has terminated");
    });

    it("maps an abort while the stream is being read to timeout", async () => {
      const { provider } = setup((_url, init) =>
        Promise.resolve(streamResponse([chunkLine('{"term":')], { hangUntilAbort: init.signal })),
      );

      const err = await expectLlmError(provider.complete({ ...request, timeoutMs: 10 }));

      expect(err.kind).toBe("timeout");
      expect(err.message).toBe("Ollama did not answer within 10ms");
    });

    it.each([
      ["its name", undiciError("Headers Timeout Error", { name: "HeadersTimeoutError" })],
      ["its code", undiciError("Headers Timeout Error", { code: "UND_ERR_HEADERS_TIMEOUT" })],
    ])("maps fetch failed caused by a headers timeout (by %s) to timeout", async (_by, root) => {
      // The shape from the cpu-only run: TypeError("fetch failed") <- TypeError <- HeadersTimeoutError.
      const cause = new TypeError("fetch failed", {
        cause: new TypeError("fetch failed", { cause: root }),
      });
      const { provider } = setup(() => Promise.reject(cause));

      const err = await expectLlmError(provider.complete(request));

      expect(err.kind).toBe("timeout");
      expect(err.retryable).toBe(true);
      expect(err.message).toContain("Ollama did not respond within");
      expect(err.message).toContain("did not start answering");
      expect(err.message).not.toContain("Cannot reach");
      expect(err.cause).toBe(cause);
    });

    it.each([
      ["its name", undiciError("Body Timeout Error", { name: "BodyTimeoutError" })],
      ["its code", undiciError("Body Timeout Error", { code: "UND_ERR_BODY_TIMEOUT" })],
    ])("maps a stream ended by a body timeout (by %s) to timeout", async (_by, root) => {
      const cause = new TypeError("terminated", { cause: root });
      const { provider } = setup(() =>
        Promise.resolve(streamResponse([chunkLine('{"term":')], { error: cause })),
      );

      const err = await expectLlmError(provider.complete(request));

      expect(err.kind).toBe("timeout");
      expect(err.message).toContain("stopped sending mid-answer");
    });
  });

  // Real fetch and a real socket on loopback: the agent's limits can't be seen through a stubbed fetch.
  describe("against a local server that is slow to send headers", () => {
    const HEADER_DELAY_MS = 2000;

    async function slowServer() {
      const server = createServer((req, res) => {
        req.resume();
        const timer = setTimeout(() => {
          res.writeHead(200, { "content-type": "application/x-ndjson" });
          res.end(chunkLine('{"term":"12 months"}', DONE));
        }, HEADER_DELAY_MS);
        res.on("close", () => {
          clearTimeout(timer);
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("no port");
      return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => {
              resolve();
            });
          }),
      };
    }

    async function completeWith(agentTimeoutMs: number) {
      const server = await slowServer();
      const provider = createOllamaProvider({
        baseUrl: server.baseUrl,
        model: "qwen2.5:7b-instruct",
        numCtxFloor: FLOOR,
        timeoutMs: agentTimeoutMs,
      });
      try {
        // The total limit is far away, so only the agent's header limit can end the call early.
        return await provider.complete({ ...request, timeoutMs: 30_000 }).then(
          (value) => ({ value, error: undefined }),
          (error: unknown) => ({ value: undefined, error }),
        );
      } finally {
        await provider.close?.();
        await server.close();
      }
    }

    it("times out with 'did not start answering' when the agent's header limit is shorter", async () => {
      const started = performance.now();
      const { error } = await completeWith(300);

      expect(error).toBeInstanceOf(LlmError);
      expect(error).toMatchObject({
        kind: "timeout",
        message: "Ollama did not respond within 300ms (it did not start answering)",
      });
      expect(performance.now() - started).toBeLessThan(HEADER_DELAY_MS);
    });

    it("succeeds when the agent's header limit is longer than the wait", async () => {
      const { value, error } = await completeWith(10_000);

      expect(error).toBeUndefined();
      expect(value).toMatchObject({
        json: { term: "12 months" },
        usage: { inputTokens: 1200, outputTokens: 80 },
      });
      expect(value?.latencyMs).toBeGreaterThanOrEqual(HEADER_DELAY_MS - 100);
    });
  });
});
