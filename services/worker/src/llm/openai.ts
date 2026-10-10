import OpenAI, {
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
import type {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseUsage,
} from "openai/resources/responses/responses";
import { LlmError, type LlmErrorKind } from "./errors.js";
import { parseJson } from "./json.js";
import type { LlmProvider, LlmRequest, LlmResponse } from "./types.js";

// Only the fields we read, so tests can build a reply without the full Response shape.
export type OpenAIReply = Pick<
  Response,
  "output_text" | "status" | "incomplete_details" | "model"
> & {
  output: readonly { type: string; content?: readonly { type: string; refusal?: string }[] }[];
  usage?: Pick<ResponseUsage, "input_tokens" | "output_tokens">;
};

export interface OpenAIClient {
  responses: {
    create(
      body: ResponseCreateParamsNonStreaming,
      options?: { timeout?: number },
    ): Promise<OpenAIReply>;
  };
}

export interface OpenAIOptions {
  apiKey: string;
  model: string;
  client?: OpenAIClient;
}

// Same mapping as the anthropic provider. Subclasses before the classes they extend.
function toKind(err: APIError): LlmErrorKind {
  if (err instanceof APIConnectionTimeoutError) return "timeout";
  if (err instanceof APIConnectionError) return "unavailable";
  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) return "auth";
  if (err instanceof RateLimitError || err instanceof ConflictError) return "rate_limited";
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

function refusalOf(res: OpenAIReply): string | undefined {
  for (const item of res.output) {
    for (const part of item.content ?? []) {
      if (part.type === "refusal") return part.refusal ?? "";
    }
  }
  return undefined;
}

export function createOpenAIProvider(opts: OpenAIOptions): LlmProvider {
  const { model } = opts;
  // bullmq is the only retry layer; sdk retries would multiply with its attempts.
  const client: OpenAIClient = opts.client ?? new OpenAI({ apiKey: opts.apiKey, maxRetries: 0 });

  async function send(req: LlmRequest): Promise<OpenAIReply> {
    try {
      return await client.responses.create(
        {
          model,
          instructions: req.system,
          input: req.messages,
          max_output_tokens: req.maxOutputTokens,
          // Responses are kept on OpenAI's side by default; confidential contracts shouldn't be.
          store: false,
          // Reasoning tokens come out of max_output_tokens, and json cut off by the limit is just
          // bad_output. No temperature: reasoning models reject it, and the schema keeps output consistent.
          reasoning: { effort: "low" },
          // strict makes the api enforce the schema while decoding instead of treating it as a hint.
          text: {
            format: { type: "json_schema", name: req.schemaName, schema: req.schema, strict: true },
          },
        },
        { timeout: req.timeoutMs },
      );
    } catch (err) {
      if (!(err instanceof APIError)) throw err;
      const kind = toKind(err);
      const message =
        kind === "timeout"
          ? `OpenAI did not answer within ${req.timeoutMs}ms`
          : `OpenAI request failed: ${err.message}`;
      throw new LlmError(kind, message, undefined, { cause: err });
    }
  }

  return {
    name: "openai",
    model,
    async complete(req: LlmRequest): Promise<LlmResponse> {
      const started = performance.now();
      const res = await send(req);
      const latencyMs = Math.round(performance.now() - started);

      const refusal = refusalOf(res);
      if (refusal !== undefined) {
        throw new LlmError("bad_output", "model refused", refusal);
      }

      const rawText = res.output_text;
      const reason = res.incomplete_details?.reason;
      if (reason === "content_filter") {
        throw new LlmError("bad_output", "output stopped by the content filter", rawText);
      }
      if (rawText === "") {
        throw new LlmError("bad_output", "reply has no output text", rawText);
      }

      const parsed = parseJson(rawText);
      if (!parsed.ok) {
        const message =
          reason === "max_output_tokens"
            ? `output stopped at max_output_tokens (${req.maxOutputTokens}) before the json was complete`
            : "model output is not valid json";
        throw new LlmError("bad_output", message, rawText, { cause: parsed.error });
      }

      return {
        json: parsed.value,
        rawText,
        usage: {
          inputTokens: res.usage?.input_tokens ?? 0,
          outputTokens: res.usage?.output_tokens ?? 0,
        },
        model: res.model,
        latencyMs,
      };
    },
  };
}
