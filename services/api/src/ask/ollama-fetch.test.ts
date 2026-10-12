import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { ChatOllama } from "@langchain/ollama";
import { afterEach, describe, expect, it } from "vitest";
import { createOllamaAgent, LlmError } from "@nexus/shared/node";
import { ollamaChatFetch } from "./ollama-fetch.js";

// A local server that behaves like ollama with a model that is still loading: it takes the
// request and sends nothing, no headers either. No network, the server is on 127.0.0.1.

interface SilentOllama {
  baseUrl: string;
  // Resolves when a chat request has arrived.
  requested: Promise<IncomingMessage>;
  // Resolves when the client has dropped that request's connection.
  dropped: Promise<void>;
  close(): Promise<void>;
}

async function silentOllama(): Promise<SilentOllama> {
  let onRequest: (req: IncomingMessage) => void = () => undefined;
  let onDropped: () => void = () => undefined;
  const requested = new Promise<IncomingMessage>((resolve) => (onRequest = resolve));
  const dropped = new Promise<void>((resolve) => (onDropped = resolve));
  const server = createServer((req, res) => {
    req.resume();
    res.on("close", onDropped);
    onRequest(req);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    requested,
    dropped,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

const TIMEOUT_MS = 60_000;
const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

async function setup() {
  const server = await silentOllama();
  const agent = createOllamaAgent(TIMEOUT_MS);
  cleanup.push(
    () => agent.close(),
    () => server.close(),
  );
  const question = new AbortController();
  const model = new ChatOllama({
    model: "qwen2.5:7b-instruct",
    baseUrl: server.baseUrl,
    maxRetries: 0,
    fetch: ollamaChatFetch({
      agent,
      signal: question.signal,
      baseUrl: server.baseUrl,
      timeoutMs: TIMEOUT_MS,
    }),
  });
  return { server, question, model };
}

describe("ollamaChatFetch under ChatOllama", () => {
  it("ends the request when the question is aborted before ollama sent any headers", async () => {
    const { server, question, model } = await setup();

    const started = Date.now();
    const answer = model.invoke("hello");
    const failure = answer.then(
      () => undefined,
      (err: unknown) => err,
    );
    const request = await server.requested;
    expect(request.url).toBe("/api/chat");

    question.abort(new DOMException("the question timed out", "TimeoutError"));

    const err = await failure;
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ kind: "timeout" });
    // The connection is gone on ollama's side, not only the promise on ours.
    await server.dropped;
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("leaves the request open without the wrapper's signal, which is why the wrapper exists", async () => {
    // ChatOllama's own call signal, the way langchain passes a timeout. It does not reach fetch.
    const server = await silentOllama();
    cleanup.push(() => server.close());
    const model = new ChatOllama({ model: "m", baseUrl: server.baseUrl, maxRetries: 0 });
    const own = new AbortController();
    // Settles only when the server is closed in the cleanup.
    void model.invoke("hello", { signal: own.signal }).catch(() => undefined);
    await server.requested;
    own.abort();

    const state = await Promise.race([
      server.dropped.then(() => "dropped"),
      new Promise<string>((resolve) => setTimeout(resolve, 300, "still open")),
    ]);
    expect(state).toBe("still open");
  });

  it("sends the dispatcher that lifts node's 300s header limit", async () => {
    const seen: unknown[] = [];
    const agent = createOllamaAgent(TIMEOUT_MS);
    cleanup.push(() => agent.close());
    const wrapped = ollamaChatFetch({
      agent,
      signal: new AbortController().signal,
      baseUrl: "http://ollama.test",
      timeoutMs: TIMEOUT_MS,
      fetch: (_url, init) => {
        seen.push(init.dispatcher, init.signal);
        return Promise.resolve(new Response("{}"));
      },
    });

    await wrapped("http://ollama.test/api/chat", { method: "POST" });

    expect(seen[0]).toBe(agent);
    expect(seen[1]).toBeInstanceOf(AbortSignal);
  });

  it("reports a connection that cannot be made as unavailable, not as a timeout", async () => {
    const wrapped = ollamaChatFetch({
      agent: createOllamaAgent(TIMEOUT_MS),
      signal: new AbortController().signal,
      baseUrl: "http://ollama.test",
      timeoutMs: TIMEOUT_MS,
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });

    await expect(wrapped("http://ollama.test/api/chat")).rejects.toMatchObject({
      kind: "unavailable",
    });
  });
});
