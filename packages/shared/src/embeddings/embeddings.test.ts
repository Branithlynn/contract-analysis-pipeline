import { APIConnectionTimeoutError, AuthenticationError } from "openai";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";
import { LlmError } from "../llm/errors.js";
import type { OllamaFetch } from "../llm/ollama-transport.js";
import { createEmbedder } from "./factory.js";
import { MockEmbedder, mockEmbedding, MOCK_EMBED_DIM } from "./mock.js";
import { buildEmbedBody, createOllamaEmbedder } from "./ollama.js";
import { createOpenAIEmbedder, type OpenAIEmbeddingsClient } from "./openai.js";
import { EMBED_BATCH_SIZE, embedInBatches, toVectors } from "./types.js";

const OPTS = { timeoutMs: 1000 };

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

async function caught(promise: Promise<unknown>): Promise<LlmError> {
  const err: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(err instanceof LlmError)) throw new Error(`expected an LlmError, got ${String(err)}`);
  return err;
}

describe("mockEmbedding", () => {
  it("gives the same unit vector for the same text, every time", () => {
    const a = mockEmbedding("Payment terms are Net 30.");
    const b = mockEmbedding("Payment terms are Net 30.");

    expect(a).toHaveLength(MOCK_EMBED_DIM);
    expect([...a]).toEqual([...b]);
    expect(cosine(a, a)).toBeCloseTo(1, 5);
    // Pinned, so a change to the hash shows up here and not as a different ranking somewhere else.
    expect([...mockEmbedding("net", 4)]).toEqual([...mockEmbedding("NET!", 4)]);
  });

  it("puts texts that share words closer than texts that do not", () => {
    const query = mockEmbedding("termination notice period");
    const close = mockEmbedding("The notice period for termination is 60 days.");
    const far = mockEmbedding("Invoices are payable in euro by bank transfer.");

    expect(cosine(query, close)).toBeGreaterThan(cosine(query, far));
  });

  it("returns a usable vector for text without any words", () => {
    const vector = mockEmbedding("  ...  ");
    expect(cosine(vector, vector)).toBeCloseTo(1, 5);
  });
});

describe("MockEmbedder", () => {
  it("returns one vector per text and records the calls", async () => {
    const embedder = new MockEmbedder({ dim: 8, model: "tiny" });

    const vectors = await embedder.embed(["a b", "c"], "document");

    expect(embedder).toMatchObject({ name: "mock", model: "tiny" });
    expect(vectors.map((v) => v.length)).toEqual([8, 8]);
    expect(embedder.calls).toEqual([{ texts: ["a b", "c"], kind: "document" }]);
  });
});

describe("toVectors", () => {
  it("rejects a reply with the wrong number of vectors", () => {
    expect(() => toVectors([[1, 2]], 2, "Ollama")).toThrow(/1 embeddings for 2 texts/);
  });

  it("rejects vectors of different lengths, empty vectors and non numbers", () => {
    expect(() => toVectors([[1, 2], [1]], 2, "Ollama")).toThrow(LlmError);
    expect(() => toVectors([[]], 1, "Ollama")).toThrow(LlmError);
    expect(() => toVectors([[1, Number.NaN]], 1, "Ollama")).toThrow(LlmError);
  });
});

describe("embedInBatches", () => {
  it("splits the texts into requests of the batch size and keeps the order", async () => {
    const embedder = new MockEmbedder();
    const texts = Array.from({ length: EMBED_BATCH_SIZE * 2 + 3 }, (_, i) => `text ${i}`);

    const vectors = await embedInBatches(embedder, texts, "document", OPTS);

    expect(embedder.calls.map((c) => c.texts.length)).toEqual([
      EMBED_BATCH_SIZE,
      EMBED_BATCH_SIZE,
      3,
    ]);
    expect(vectors).toHaveLength(texts.length);
    expect([...(vectors.at(-1) ?? [])]).toEqual([...mockEmbedding(texts.at(-1) ?? "")]);
  });

  it("makes no request for no texts", async () => {
    const embedder = new MockEmbedder();
    expect(await embedInBatches(embedder, [], "document", OPTS)).toEqual([]);
    expect(embedder.calls).toEqual([]);
  });
});

describe("ollama embedder", () => {
  const make = (fetch: OllamaFetch, model = "nomic-embed-text", numGpu = 0) =>
    createOllamaEmbedder({
      baseUrl: "http://ollama:11434/",
      model,
      numGpu,
      timeoutMs: 5000,
      fetch,
    });

  it("posts to /api/embed through the agent with the call's own timeout signal", async () => {
    const fetch = vi.fn<OllamaFetch>(() => Promise.resolve(json({ embeddings: [[0.5, 0.25]] })));
    const embedder = make(fetch);

    const vectors = await embedder.embed(["hello"], "query", OPTS);

    expect(vectors.map((v) => [...v])).toEqual([[0.5, 0.25]]);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("http://ollama:11434/api/embed");
    expect(init?.method).toBe("POST");
    expect(init?.dispatcher).toBeDefined();
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "nomic-embed-text",
      input: ["search_query: hello"],
      truncate: false,
      keep_alive: "10m",
      options: { num_gpu: 0 },
    });
    await embedder.close?.();
  });

  it("sends options.num_gpu 0 by default, so the embedding model stays off the gpu", async () => {
    const fetch = vi.fn<OllamaFetch>(() => Promise.resolve(json({ embeddings: [[1, 0]] })));
    // Built from the config, like the api and the worker do.
    const embedder = createOllamaEmbedder({
      baseUrl: "http://ollama:11434",
      model: "nomic-embed-text",
      numGpu: loadConfig({}).EMBED_OLLAMA_NUM_GPU,
      timeoutMs: 5000,
      fetch,
    });

    await embedder.embed(["a"], "document", OPTS);

    const body = JSON.parse(String(fetch.mock.calls[0]?.[1].body)) as { options: unknown };
    expect(body.options).toEqual({ num_gpu: 0 });
    await embedder.close?.();
  });

  it("sends the configured num_gpu on every request, the same for documents and queries", async () => {
    const fetch = vi.fn<OllamaFetch>(() => Promise.resolve(json({ embeddings: [[1, 0]] })));
    const embedder = make(fetch, "nomic-embed-text", 99);

    await embedder.embed(["a"], "document", OPTS);
    await embedder.embed(["b"], "query", OPTS);

    // A different value on one of them would make ollama reload the model in between.
    const sent = fetch.mock.calls.map(
      ([, init]) => (JSON.parse(String(init.body)) as { options: unknown }).options,
    );
    expect(sent).toEqual([{ num_gpu: 99 }, { num_gpu: 99 }]);
    expect(buildEmbedBody("nomic-embed-text", ["a"], "query", -1).options).toEqual({ num_gpu: -1 });
  });

  it("reports each request with its model load time in milliseconds", async () => {
    const replies = [
      // Nanoseconds: 1.9s, a cold load.
      json({ embeddings: [[1, 0]], load_duration: 1_900_000_000, total_duration: 2_100_000_000 }),
      // Ollama leaves load_duration out when it is zero.
      json({ embeddings: [[1, 0]] }),
    ];
    const embedder = make(() => Promise.resolve(replies.shift() ?? json({})));
    const calls: unknown[] = [];
    const opts = { ...OPTS, onCall: (info: unknown) => calls.push(info) };

    await embedder.embed(["a"], "document", opts);
    await embedder.embed(["b"], "document", opts);

    expect(calls).toEqual([
      { texts: 1, durationMs: expect.any(Number) as number, loadMs: 1900 },
      { texts: 1, durationMs: expect.any(Number) as number, loadMs: 0 },
    ]);
  });

  it("does not report a request that failed", async () => {
    const embedder = make(() => Promise.resolve(json({ error: "out of memory" }, 500)));
    const calls: unknown[] = [];

    await caught(embedder.embed(["a"], "document", { ...OPTS, onCall: (i) => calls.push(i) }));

    expect(calls).toEqual([]);
  });

  it("prefixes nomic inputs by kind and leaves other models alone", () => {
    expect(buildEmbedBody("nomic-embed-text", ["a"], "document", 0).input).toEqual([
      "search_document: a",
    ]);
    expect(buildEmbedBody("nomic-embed-text:v1.5", ["a"], "query", 0).input).toEqual([
      "search_query: a",
    ]);
    expect(buildEmbedBody("mxbai-embed-large", ["a"], "query", 0).input).toEqual(["a"]);
  });

  it("runs one call at a time, in the order they were made", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const order: string[] = [];
    const fetch: OllamaFetch = async (_url, init) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const { input } = JSON.parse(String(init.body)) as { input: string[] };
      order.push(...input);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return json({ embeddings: input.map(() => [1, 0]) });
    };
    const embedder = make(fetch, "other");

    await Promise.all(["a", "b", "c"].map((t) => embedder.embed([t], "document", OPTS)));

    expect(maxInFlight).toBe(1);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("keeps serving after a failed call", async () => {
    const fetch = vi
      .fn<OllamaFetch>()
      .mockRejectedValueOnce(Object.assign(new TypeError("fetch failed"), { cause: { code: "X" } }))
      .mockResolvedValueOnce(json({ embeddings: [[1, 0]] }));
    const embedder = make(fetch);

    const failed = embedder.embed(["a"], "document", OPTS);
    const ok = embedder.embed(["b"], "document", OPTS);

    expect(await caught(failed)).toMatchObject({ kind: "unavailable" });
    expect(await ok).toHaveLength(1);
  });

  it("maps an unreachable ollama, a timeout and bad statuses like the chat provider", async () => {
    const unreachable = make(() => Promise.reject(new TypeError("fetch failed")));
    expect(await caught(unreachable.embed(["a"], "document", OPTS))).toMatchObject({
      kind: "unavailable",
      retryable: true,
      message: "Cannot reach Ollama at http://ollama:11434",
    });

    const slow = make(() =>
      Promise.reject(new DOMException("The operation timed out.", "TimeoutError")),
    );
    expect(await caught(slow.embed(["a"], "document", OPTS))).toMatchObject({
      kind: "timeout",
      message: "Ollama did not answer within 1000ms",
    });

    const notPulled = make(() =>
      Promise.resolve(json({ error: 'model "nomic-embed-text" not found' }, 404)),
    );
    expect(await caught(notPulled.embed(["a"], "document", OPTS))).toMatchObject({
      kind: "invalid_request",
      retryable: false,
      message: "Model nomic-embed-text not pulled. Run: ollama pull nomic-embed-text",
    });

    const broken = make(() => Promise.resolve(json({ error: "out of memory" }, 500)));
    expect(await caught(broken.embed(["a"], "document", OPTS))).toMatchObject({
      kind: "unavailable",
      message: "Ollama returned 500: out of memory",
    });
  });

  it("rejects a reply that is not embeddings, or not one per text", async () => {
    const html = make(() => Promise.resolve(new Response("<html>", { status: 200 })));
    expect(await caught(html.embed(["a"], "document", OPTS))).toMatchObject({ kind: "bad_output" });

    const other = make(() => Promise.resolve(json({ embedding: [1, 2] })));
    expect(await caught(other.embed(["a"], "document", OPTS))).toMatchObject({
      kind: "bad_output",
    });

    const short = make(() => Promise.resolve(json({ embeddings: [[1, 2]] })));
    expect(await caught(short.embed(["a", "b"], "document", OPTS))).toMatchObject({
      kind: "bad_output",
      message: "Ollama returned 1 embeddings for 2 texts",
    });
  });

  it("makes no request for no texts", async () => {
    const fetch = vi.fn<OllamaFetch>();
    expect(await make(fetch).embed([], "document", OPTS)).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("openai embedder", () => {
  it("sends all texts in one request and puts the vectors back in input order", async () => {
    const create = vi.fn<OpenAIEmbeddingsClient["embeddings"]["create"]>(() =>
      Promise.resolve({
        data: [
          { index: 1, embedding: [0, 1] },
          { index: 0, embedding: [1, 0] },
        ],
      }),
    );
    const embedder = createOpenAIEmbedder({
      apiKey: "test-openai-key",
      model: "text-embedding-3-small",
      client: { embeddings: { create } },
    });

    const vectors = await embedder.embed(["first", "second"], "document", OPTS);

    expect(vectors.map((v) => [...v])).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(create).toHaveBeenCalledWith(
      { model: "text-embedding-3-small", input: ["first", "second"], encoding_format: "float" },
      { timeout: 1000 },
    );
  });

  it("maps sdk errors to LlmError kinds", async () => {
    const failing = (err: Error) =>
      createOpenAIEmbedder({
        apiKey: "test-openai-key",
        model: "m",
        client: { embeddings: { create: () => Promise.reject(err) } },
      });

    const auth = new AuthenticationError(401, undefined, "bad key", new Headers());
    expect(await caught(failing(auth).embed(["a"], "query", OPTS))).toMatchObject({
      kind: "auth",
      retryable: false,
    });
    const timeout = new APIConnectionTimeoutError();
    expect(await caught(failing(timeout).embed(["a"], "query", OPTS))).toMatchObject({
      kind: "timeout",
      message: "OpenAI did not answer within 1000ms",
    });
    // Not an sdk error: our bug, so it is not dressed up as a provider failure.
    await expect(failing(new RangeError("boom")).embed(["a"], "query", OPTS)).rejects.toThrow(
      RangeError,
    );
  });

  it("rejects a reply with a vector missing", async () => {
    const embedder = createOpenAIEmbedder({
      apiKey: "test-openai-key",
      model: "m",
      client: {
        embeddings: { create: () => Promise.resolve({ data: [{ index: 0, embedding: [1] }] }) },
      },
    });

    expect(await caught(embedder.embed(["a", "b"], "document", OPTS))).toMatchObject({
      kind: "bad_output",
    });
  });
});

describe("createEmbedder", () => {
  it("builds the embedder the config asks for", async () => {
    const ollama = createEmbedder(loadConfig({}));
    expect(ollama).toMatchObject({ name: "ollama", model: "nomic-embed-text" });
    await ollama.close?.();

    expect(
      createEmbedder(loadConfig({ EMBED_PROVIDER: "openai", OPENAI_API_KEY: "test-openai-key" })),
    ).toMatchObject({ name: "openai", model: "text-embedding-3-small" });
    expect(createEmbedder(loadConfig({ EMBED_PROVIDER: "mock" }))).toMatchObject({
      name: "mock",
      model: "mock",
    });
  });
});
