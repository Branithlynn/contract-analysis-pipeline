import { createRequire } from "node:module";
import { Agent, type Dispatcher } from "undici";
import { z } from "zod";
import { LlmError } from "./errors.js";

// What chat and embeddings share when they talk to ollama: the connection limits and how a failed
// fetch is turned into an LlmError.

type FetchInit = Omit<RequestInit, "dispatcher"> & { dispatcher: Dispatcher };
export type OllamaFetch = (input: string, init: FetchInit) => Promise<Response>;

// Types only: RequestInit's dispatcher is typed by the undici-types that @types/node pins (7.24),
// the Agent by the undici package (7.29), and tsc sees two different Dispatcher declarations.
// At runtime it is the same interface, the test against a local server covers that.
export const nodeFetch = fetch as unknown as OllamaFetch;

// The Agent comes from the undici package, the fetch it is handed to is the copy bundled in node.
// They have to stay close enough to work together, so both versions go into the startup log.
export function undiciVersions(): { agent: string; nodeFetch: string | undefined } {
  const pkg: unknown = createRequire(import.meta.url)("undici/package.json");
  return {
    agent: z.object({ version: z.string() }).parse(pkg).version,
    nodeFetch: process.versions["undici"],
  };
}

// node's fetch gives up after 300s without response headers, and again after 300s without a body
// chunk, whatever our AbortSignal says. Ollama only sends headers with the first token, and on a
// cpu a cold start (loading the model, reading the prompt) takes longer than that. So ollama gets
// its own agent with both limits raised to our timeout, and the AbortSignal stays the total limit.
export function createOllamaAgent(timeoutMs: number): Agent {
  return new Agent({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs });
}

const ABORT_NAMES = new Set(["AbortError", "TimeoutError"]);

// The connection's own limits (see the Agent above): time until the response headers, and time
// between two body chunks. They surface as a TypeError("fetch failed") or "terminated" with one of
// these further down the cause chain.
const UNDICI_TIMEOUTS: Readonly<Record<string, string>> = {
  HeadersTimeoutError: "did not start answering",
  UND_ERR_HEADERS_TIMEOUT: "did not start answering",
  BodyTimeoutError: "stopped sending mid-answer",
  UND_ERR_BODY_TIMEOUT: "stopped sending mid-answer",
};

function causeChain(err: unknown): Error[] {
  const chain: Error[] = [];
  // Capped, a cause chain can point back at itself.
  for (let current = err; current instanceof Error && chain.length < 8; current = current.cause) {
    chain.push(current);
  }
  return chain;
}

function errorCode(err: Error): string | undefined {
  return "code" in err && typeof err.code === "string" ? err.code : undefined;
}

// A timeout means ollama was reachable and just slow, which needs a different fix (a bigger
// LLM_TIMEOUT_MS, a smaller model) than a connection error (wrong OLLAMA_URL, ollama not running).
export function ollamaFetchFailure(
  err: unknown,
  baseUrl: string,
  timeoutMs: number,
  silenceLimitMs: number,
): LlmError {
  const chain = causeChain(err);
  if (chain.some((e) => ABORT_NAMES.has(e.name))) {
    return new LlmError("timeout", `Ollama did not answer within ${timeoutMs}ms`, undefined, {
      cause: err,
    });
  }
  for (const e of chain) {
    const what = UNDICI_TIMEOUTS[e.name] ?? UNDICI_TIMEOUTS[errorCode(e) ?? ""];
    if (what !== undefined) {
      return new LlmError(
        "timeout",
        `Ollama did not respond within ${silenceLimitMs}ms (it ${what})`,
        undefined,
        { cause: err },
      );
    }
  }
  return new LlmError("unavailable", `Cannot reach Ollama at ${baseUrl}`, undefined, {
    cause: err,
  });
}

export const OllamaErrorBody = z.object({ error: z.string() });

export function ollamaErrorText(body: string): string {
  try {
    const parsed = OllamaErrorBody.safeParse(JSON.parse(body));
    if (parsed.success) return parsed.data.error;
  } catch {
    // Not json (e.g. a proxy's html page), fall through to the raw body.
  }
  return body.slice(0, 500);
}

// The same reading of a non-200 for chat and embeddings. model is only used for the 404 hint.
export function ollamaStatusError(status: number, body: string, model: string): LlmError {
  if (status >= 500) {
    return new LlmError("unavailable", `Ollama returned ${status}: ${ollamaErrorText(body)}`);
  }
  if (status === 429) {
    // Ollama itself doesn't send this, but a proxy or gateway in front of it can.
    return new LlmError("rate_limited", `Ollama returned 429: ${ollamaErrorText(body)}`);
  }
  const text = ollamaErrorText(body);
  if (status === 404 && /model/i.test(text)) {
    return new LlmError("invalid_request", `Model ${model} not pulled. Run: ollama pull ${model}`);
  }
  return new LlmError("invalid_request", `Ollama returned ${status}: ${text}`);
}
