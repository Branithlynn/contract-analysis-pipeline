import Anthropic, {
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
import type {
  Message,
  MessageCreateParamsNonStreaming,
  Usage,
} from "@anthropic-ai/sdk/resources/messages";
import { parseJson } from "./json.js";
import { LlmError, type LlmErrorKind } from "./errors.js";
import type { LlmProvider, LlmRequest, LlmResponse } from "./types.js";

// Only the fields we read, so tests can build a reply without the full Message shape.
export type AnthropicReply = Pick<Message, "content" | "model" | "stop_reason" | "stop_details"> & {
  usage: Pick<Usage, "input_tokens" | "output_tokens">;
};

export interface AnthropicClient {
  messages: {
    create(
      body: MessageCreateParamsNonStreaming,
      options?: { timeout?: number },
    ): Promise<AnthropicReply>;
  };
}

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  client?: AnthropicClient;
}

// Order matters: subclasses before the classes they extend (timeout before connection error,
// every status class before plain APIError).
function toKind(err: APIError): LlmErrorKind {
  if (err instanceof APIConnectionTimeoutError) return "timeout";
  if (err instanceof APIConnectionError) return "unavailable";
  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) return "auth";
  // 409 is a conflict on Anthropic's side, not in our request; it clears up on retry.
  if (err instanceof RateLimitError || err instanceof ConflictError) return "rate_limited";
  // Covers 529 overloaded too: the sdk has no class for it and files every status >= 500 here.
  if (err instanceof InternalServerError) return "unavailable";
  if (
    err instanceof BadRequestError ||
    err instanceof NotFoundError ||
    err instanceof UnprocessableEntityError
  ) {
    return "invalid_request";
  }
  // 413 has no class of its own and arrives as a plain APIError.
  if (err.status === undefined || err.status >= 500) return "unavailable";
  return "invalid_request";
}

// No output_config.format here. With the extraction schema, claude-sonnet-5-5 rejected it with
// 400 "The compiled grammar is too large, which would cause performance issues. Simplify your tool
// schemas or reduce the number of strict tools." So the schema goes into the system prompt as a hint,
// and zod validation plus the one repair call stay the real contract, as for every provider.
function systemWithSchema(req: LlmRequest): string {
  return `${req.system}\n\nReply with a single JSON object that matches this JSON Schema:\n${JSON.stringify(req.schema)}`;
}

// Without constrained decoding the model sometimes wraps its json in a markdown fence.
const FENCE = /^\s*```(?:json)?[^\S\n]*\n([\s\S]*?)\n?```\s*$/i;

function stripFence(text: string): string {
  return FENCE.exec(text)?.[1] ?? text;
}

export function createAnthropicProvider(opts: AnthropicOptions): LlmProvider {
  const { model } = opts;
  // bullmq is the only retry layer; sdk retries would multiply with its attempts.
  const client: AnthropicClient =
    opts.client ?? new Anthropic({ apiKey: opts.apiKey, maxRetries: 0 });

  async function send(req: LlmRequest): Promise<AnthropicReply> {
    try {
      return await client.messages.create(
        {
          model,
          max_tokens: req.maxOutputTokens,
          system: systemWithSchema(req),
          messages: req.messages,
          // No temperature: current Claude models reject sampling parameters.
          output_config: {
            // Thinking tokens count against max_tokens, and json cut off by the limit is just
            // bad_output. Copying facts out of a chunk doesn't need deep reasoning anyway.
            effort: "low",
          },
        },
        { timeout: req.timeoutMs },
      );
    } catch (err) {
      if (!(err instanceof APIError)) throw err;
      const kind = toKind(err);
      const message =
        kind === "timeout"
          ? `Anthropic did not answer within ${req.timeoutMs}ms`
          : `Anthropic request failed: ${err.message}`;
      throw new LlmError(kind, message, undefined, { cause: err });
    }
  }

  return {
    name: "anthropic",
    model,
    async complete(req: LlmRequest): Promise<LlmResponse> {
      const started = performance.now();
      const res = await send(req);
      const latencyMs = Math.round(performance.now() - started);

      // Thinking blocks can come first; only the text blocks carry the json.
      const rawText = res.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("");

      if (res.stop_reason === "refusal") {
        // Even parseable text isn't the extraction when the model refused.
        const category = res.stop_details?.category ?? "unspecified";
        throw new LlmError("bad_output", `model refused (category: ${category})`, rawText);
      }
      if (rawText === "") {
        throw new LlmError("bad_output", "reply has no text block", rawText);
      }

      // rawText stays as the model wrote it, fence included, so the repair call shows its real reply.
      const parsed = parseJson(stripFence(rawText));
      if (!parsed.ok) {
        const reason =
          res.stop_reason === "max_tokens"
            ? `output stopped at max_tokens (${req.maxOutputTokens}) before the json was complete`
            : "model output is not valid json";
        throw new LlmError("bad_output", reason, rawText, { cause: parsed.error });
      }

      return {
        json: parsed.value,
        rawText,
        usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
        model: res.model,
        latencyMs,
      };
    },
  };
}
