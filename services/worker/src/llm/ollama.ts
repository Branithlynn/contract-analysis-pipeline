import { z } from "zod";
import { parseJson } from "./json.js";
import { buildFieldGuide, capSchemaForOllama } from "./ollama-schema.js";
import { LlmError } from "./errors.js";
import type { LlmProvider, LlmRequest, LlmResponse } from "./types.js";

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export interface OllamaOptions {
  baseUrl: string;
  model: string;
  // From contextFloor(): the num_ctx every call gets unless its messages need more.
  numCtxFloor: number;
  fetch?: Fetch;
}

const NUM_CTX_CAP = 32768;
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

const ChatResponse = z.object({
  model: z.string().optional(),
  message: z.object({ content: z.string() }),
  done_reason: z.string().optional(),
  // Ollama leaves prompt_eval_count out when the prompt came from its cache.
  prompt_eval_count: z.number().optional(),
  eval_count: z.number().optional(),
});

const ErrorBody = z.object({ error: z.string() });

const ABORT_NAMES = new Set(["AbortError", "TimeoutError"]);

function isAbort(err: unknown): boolean {
  return err instanceof Error && ABORT_NAMES.has(err.name);
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
    stream: false,
    format: capSchemaForOllama(req.schema),
    // Chunks of one document arrive back to back; unloading in between means reloading gigabytes.
    keep_alive: "10m",
    messages: [{ role: "system", content: system }, ...req.messages],
    options: {
      // Same document in, same extraction out.
      temperature: 0,
      num_ctx: requestNumCtx(numCtxFloor, system, req),
      num_predict: req.maxOutputTokens,
    },
  };
}

export function createOllamaProvider(opts: OllamaOptions): LlmProvider {
  const { model, numCtxFloor } = opts;
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  const doFetch: Fetch = opts.fetch ?? fetch;

  async function send(req: LlmRequest): Promise<{ status: number; body: string }> {
    const body = buildChatBody(model, numCtxFloor, req);
    try {
      // The timeout covers reading the body too: with stream: false that is where generation time goes.
      const res = await doFetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(req.timeoutMs),
      });
      return { status: res.status, body: await res.text() };
    } catch (err) {
      if (isAbort(err)) {
        throw new LlmError(
          "timeout",
          `Ollama did not answer within ${req.timeoutMs}ms`,
          undefined,
          {
            cause: err,
          },
        );
      }
      throw new LlmError("unavailable", `Cannot reach Ollama at ${baseUrl}`, undefined, {
        cause: err,
      });
    }
  }

  return {
    name: "ollama",
    model,
    async complete(req: LlmRequest): Promise<LlmResponse> {
      const started = performance.now();
      const { status, body } = await send(req);
      const latencyMs = Math.round(performance.now() - started);

      if (status >= 500) {
        throw new LlmError("unavailable", `Ollama returned ${status}: ${errorText(body)}`);
      }
      if (status === 429) {
        // Ollama itself doesn't send this, but a proxy or gateway in front of it can.
        throw new LlmError("rate_limited", `Ollama returned 429: ${errorText(body)}`);
      }
      if (status >= 400) {
        const text = errorText(body);
        if (status === 404 && /model/i.test(text)) {
          throw new LlmError(
            "invalid_request",
            `Model ${model} not pulled. Run: ollama pull ${model}`,
          );
        }
        throw new LlmError("invalid_request", `Ollama returned ${status}: ${text}`);
      }

      const envelope = parseJson(body);
      const parsed = envelope.ok ? ChatResponse.safeParse(envelope.value) : null;
      if (!parsed?.success) {
        throw new LlmError("bad_output", "Ollama response is not a chat completion", body, {
          cause: envelope.ok ? parsed?.error : envelope.error,
        });
      }

      const { message, done_reason, prompt_eval_count, eval_count } = parsed.data;
      const content = parseJson(message.content);
      if (!content.ok) {
        const reason =
          done_reason === "length"
            ? `output stopped at num_predict (${req.maxOutputTokens} tokens) before the json was complete`
            : "model output is not valid json";
        throw new LlmError("bad_output", reason, message.content, { cause: content.error });
      }

      return {
        json: content.value,
        rawText: message.content,
        usage: { inputTokens: prompt_eval_count ?? 0, outputTokens: eval_count ?? 0 },
        model: parsed.data.model ?? model,
        latencyMs,
      };
    },
  };
}
