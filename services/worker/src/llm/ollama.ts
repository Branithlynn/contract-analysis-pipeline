import { createRequire } from "node:module";
import { Agent, type Dispatcher } from "undici";
import { z } from "zod";
import { parseJson } from "./json.js";
import { buildFieldGuide, capSchemaForOllama } from "./ollama-schema.js";
import { LlmError } from "./errors.js";
import type { LlmProvider, LlmRequest, LlmResponse } from "./types.js";

type FetchInit = Omit<RequestInit, "dispatcher"> & { dispatcher: Dispatcher };
type Fetch = (input: string, init: FetchInit) => Promise<Response>;

// Types only: RequestInit's dispatcher is typed by the undici-types that @types/node pins (7.24),
// the Agent by the undici package (7.29), and tsc sees two different Dispatcher declarations.
// At runtime it is the same interface, the test against a local server covers that.
const nodeFetch = fetch as unknown as Fetch;

export interface OllamaOptions {
  baseUrl: string;
  model: string;
  // From contextFloor(): the num_ctx every call gets unless its messages need more.
  numCtxFloor: number;
  // LLM_TIMEOUT_MS. How long the connection may stay silent, before the headers and between chunks.
  timeoutMs: number;
  fetch?: Fetch;
}

// The Agent comes from the undici package, the fetch it is handed to is the copy bundled in node.
// They have to stay close enough to work together, so both versions go into the startup log.
export function undiciVersions(): { agent: string; nodeFetch: string | undefined } {
  const pkg: unknown = createRequire(import.meta.url)("undici/package.json");
  return {
    agent: z.object({ version: z.string() }).parse(pkg).version,
    nodeFetch: process.versions["undici"],
  };
}

const NUM_CTX_CAP = 32768;
// Any fixed number does, it only has to be the same on every call.
const SEED = 42;
// The <document> wrapper with its filename, plus the chat template's role tokens.
const MESSAGE_MARGIN_TOKENS = 512;
// Legal text tokenizes worse than prose (numbers, section refs, defined terms in caps), so this
// overestimates on purpose. Too small a context is the failure we can't see.
const CHARS_PER_TOKEN = 3;

function roundAndCap(tokens: number): number {
  return Math.min(NUM_CTX_CAP, Math.ceil(tokens / 1024) * 1024);
}

// Ollama's default context is a few thousand tokens and it drops the start of an overlong prompt
// without any error. Half a contract gives confident wrong answers, so size it to the worst case.
// The system prompt is measured instead of guessed, so the size follows prompt changes.
export function computeNumCtx(
  maxInputChars: number,
  systemChars: number,
  maxOutputTokens: number,
): number {
  return roundAndCap(
    Math.ceil(maxInputChars / CHARS_PER_TOKEN) +
      Math.ceil(systemChars / CHARS_PER_TOKEN) +
      MESSAGE_MARGIN_TOKENS +
      maxOutputTokens,
  );
}

// The grammar from `format` enforces the structure, but the model never reads it, so field meanings
// go into the system prompt as a compact guide.
export function ollamaSystemPrompt(req: Pick<LlmRequest, "system" | "schema">): string {
  const guide = buildFieldGuide(req.schema);
  return guide === "" ? req.system : `${req.system}\n\nField definitions:\n${guide}`;
}

// One size for every kind of call (extraction and summary): a changed num_ctx makes ollama reload the
// model, so a long document would otherwise reload when it moves from its chunks to the summary.
export function contextFloor(
  maxInputChars: number,
  templates: Pick<LlmRequest, "system" | "schema" | "maxOutputTokens">[],
): number {
  return Math.max(
    ...templates.map((t) =>
      computeNumCtx(maxInputChars, ollamaSystemPrompt(t).length, t.maxOutputTokens),
    ),
  );
}

// The floor is sized for one chunk, not for a repair, which also carries the previous reply (up to
// maxOutputTokens) and the error list. Sizing every call for a repair would cost ~4k tokens of kv
// cache on every call, and that decides whether the 7b model fits on the GPU at all. So a call whose
// messages don't fit gets a bigger num_ctx for itself only: one reload on a rare repair beats silently
// losing the start of the conversation.
export function requestNumCtx(floor: number, system: string, req: LlmRequest): number {
  const chars = req.messages.reduce((n, m) => n + m.content.length, system.length);
  const needed = roundAndCap(
    Math.ceil(chars / CHARS_PER_TOKEN) + MESSAGE_MARGIN_TOKENS + req.maxOutputTokens,
  );
  return Math.max(floor, needed);
}

// One ndjson line of the stream. Every line carries a piece of message.content, and the last one
// (done: true) also has done_reason and the token counts.
const ChatChunk = z.object({
  model: z.string().optional(),
  message: z.object({ content: z.string() }),
  done: z.boolean(),
  done_reason: z.string().optional(),
  // Ollama leaves prompt_eval_count out when the prompt came from its cache.
  prompt_eval_count: z.number().optional(),
  eval_count: z.number().optional(),
});

const ErrorBody = z.object({ error: z.string() });

// GET /api/tags: the models that are pulled.
const TagsBody = z.object({ models: z.array(z.object({ name: z.string() })) });
// Listing models is instant on a healthy ollama. Much shorter than LLM_TIMEOUT_MS on purpose: the
// check exists so that a dead ollama is noticed before a call waits that long.
const CHECK_TIMEOUT_MS = 10_000;

const ABORT_NAMES = new Set(["AbortError", "TimeoutError"]);

// The connection's own limits (see the Agent below): time until the response headers, and time
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
function fetchFailure(
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

interface ChatReply {
  content: string;
  last: z.infer<typeof ChatChunk>;
}

function readLine(line: string): z.infer<typeof ChatChunk> {
  const json = parseJson(line);
  const error = json.ok ? ErrorBody.safeParse(json.value) : null;
  if (error?.success) {
    // Ollama reports a failure after the headers went out (e.g. out of memory) as a line of its own.
    throw new LlmError("unavailable", `Ollama failed mid-answer: ${error.data.error}`);
  }
  const chunk = json.ok ? ChatChunk.safeParse(json.value) : null;
  if (!chunk?.success) {
    throw new LlmError("bad_output", "Ollama response is not a chat completion", line, {
      cause: json.ok ? chunk?.error : json.error,
    });
  }
  return chunk.data;
}

// Collects message.content from the ndjson stream until the line with done: true.
async function readChat(body: ReadableStream<Uint8Array> | null): Promise<ChatReply> {
  const reader = body?.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let content = "";
  while (reader) {
    const { done, value } = await reader.read();
    buffered += done ? decoder.decode() : decoder.decode(value, { stream: true });
    const lines = buffered.split("\n");
    // The last piece is an unfinished line until the stream ends.
    buffered = done ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (line.trim() === "") continue;
      const chunk = readLine(line);
      content += chunk.message.content;
      if (chunk.done) return { content, last: chunk };
    }
    if (done) break;
  }
  // A clean end without done: true. Half an answer is not bad model output, so no repair: retry.
  throw new LlmError("unavailable", "Ollama closed the stream before the answer was complete");
}

function errorText(body: string): string {
  try {
    const parsed = ErrorBody.safeParse(JSON.parse(body));
    if (parsed.success) return parsed.data.error;
  } catch {
    // Not json (e.g. a proxy's html page), fall through to the raw body.
  }
  return body.slice(0, 500);
}

// Exported so the smoke script can print exactly what gets sent.
export function buildChatBody(model: string, numCtxFloor: number, req: LlmRequest) {
  const system = ollamaSystemPrompt(req);
  return {
    model,
    // With stream: false ollama sends nothing, not even headers, until the whole answer exists.
    // Streaming gets the headers out with the first token, and a stalled answer shows up as silence
    // between chunks instead of only at the total timeout.
    stream: true,
    format: capSchemaForOllama(req.schema),
    // Chunks of one document arrive back to back; unloading in between means reloading gigabytes.
    keep_alive: "10m",
    messages: [{ role: "system", content: system }, ...req.messages],
    options: {
      // Same document in, same extraction out. Temperature 0 alone did not get there: two runs of
      // the same prompt on the same document gave different answers. The fixed seed takes one
      // source of variation away. How ollama splits the model between gpu and cpu can still differ.
      temperature: 0,
      seed: SEED,
      num_ctx: requestNumCtx(numCtxFloor, system, req),
      num_predict: req.maxOutputTokens,
    },
  };
}

export function createOllamaProvider(opts: OllamaOptions): LlmProvider {
  const { model, numCtxFloor } = opts;
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  const doFetch: Fetch = opts.fetch ?? nodeFetch;
  // node's fetch gives up after 300s without response headers, and again after 300s without a body
  // chunk, whatever our AbortSignal says. Ollama only sends headers with the first token, and on a
  // cpu a cold start (loading the model, reading the prompt) takes longer than that. So ollama gets
  // its own agent with both limits raised to our timeout, and the AbortSignal stays the total limit.
  const agent = new Agent({ headersTimeout: opts.timeoutMs, bodyTimeout: opts.timeoutMs });

  type Sent = { status: number; body: string } | ({ status: 200 } & ChatReply);

  async function send(req: LlmRequest): Promise<Sent> {
    const body = buildChatBody(model, numCtxFloor, req);
    try {
      // The signal stays attached while the stream is read, so it is the one limit on the whole call.
      const res = await doFetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(req.timeoutMs),
        dispatcher: agent,
      });
      if (res.status !== 200) return { status: res.status, body: await res.text() };
      return { status: 200, ...(await readChat(res.body)) };
    } catch (err) {
      if (err instanceof LlmError) throw err;
      throw fetchFailure(err, baseUrl, req.timeoutMs, opts.timeoutMs);
    }
  }

  return {
    name: "ollama",
    model,
    close: () => agent.close(),
    numCtx: (req) => buildChatBody(model, numCtxFloor, req).options.num_ctx,
    async check(): Promise<void> {
      let res: Response;
      try {
        res = await doFetch(`${baseUrl}/api/tags`, {
          method: "GET",
          signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
          dispatcher: agent,
        });
      } catch (err) {
        throw fetchFailure(err, baseUrl, CHECK_TIMEOUT_MS, CHECK_TIMEOUT_MS);
      }
      const body = await res.text();
      if (res.status !== 200) {
        throw new LlmError(
          "unavailable",
          `Ollama returned ${res.status} for /api/tags: ${errorText(body)}`,
        );
      }
      const json = parseJson(body);
      const tags = json.ok ? TagsBody.safeParse(json.value) : null;
      if (!tags?.success) {
        throw new LlmError("unavailable", `${baseUrl}/api/tags did not answer like Ollama`, body);
      }
      // A model pulled without a tag is listed as name:latest.
      const pulled = tags.data.models.some((m) => m.name === model || m.name === `${model}:latest`);
      if (!pulled) {
        throw new LlmError(
          "invalid_request",
          `Model ${model} not pulled. Run: ollama pull ${model}`,
        );
      }
    },
    async complete(req: LlmRequest): Promise<LlmResponse> {
      const started = performance.now();
      const sent = await send(req);
      const latencyMs = Math.round(performance.now() - started);

      if (!("content" in sent)) {
        const { status, body } = sent;
        if (status >= 500) {
          throw new LlmError("unavailable", `Ollama returned ${status}: ${errorText(body)}`);
        }
        if (status === 429) {
          // Ollama itself doesn't send this, but a proxy or gateway in front of it can.
          throw new LlmError("rate_limited", `Ollama returned 429: ${errorText(body)}`);
        }
        const text = errorText(body);
        if (status === 404 && /model/i.test(text)) {
          throw new LlmError(
            "invalid_request",
            `Model ${model} not pulled. Run: ollama pull ${model}`,
          );
        }
        throw new LlmError("invalid_request", `Ollama returned ${status}: ${text}`);
      }

      const { done_reason, prompt_eval_count, eval_count } = sent.last;
      const usage = { inputTokens: prompt_eval_count ?? 0, outputTokens: eval_count ?? 0 };
      const content = parseJson(sent.content);
      if (!content.ok) {
        const truncated = done_reason === "length";
        const reason = truncated
          ? `output stopped at num_predict (${req.maxOutputTokens} tokens) before the json was complete`
          : "model output is not valid json";
        throw new LlmError("bad_output", reason, sent.content, {
          cause: content.error,
          truncated,
          usage,
        });
      }

      return {
        json: content.value,
        rawText: sent.content,
        usage,
        model: sent.last.model ?? model,
        latencyMs,
      };
    },
  };
}
