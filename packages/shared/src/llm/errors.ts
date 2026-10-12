export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export type LlmErrorKind =
  "timeout" | "rate_limited" | "unavailable" | "auth" | "invalid_request" | "bad_output";

const RETRYABLE: ReadonlySet<LlmErrorKind> = new Set(["timeout", "rate_limited", "unavailable"]);

export interface LlmErrorOptions extends ErrorOptions {
  // The reply stopped at the output token limit. The repair step must not send that reply back: it is
  // up to maxOutputTokens of junk that would also force ollama into a bigger num_ctx and a reload.
  truncated?: boolean;
  // Tokens of a call that came back but couldn't be used. It still cost tokens (and money), and the
  // evals compare tokens per provider, so a provider that needs repairs must not look cheaper.
  usage?: LlmUsage;
  // Model load time of a call that came back but could not be used, when the provider reports it.
  loadMs?: number;
}

// Providers translate their sdk/http failures into this one shape so classifyError doesn't need to
// know about anthropic, openai or ollama error classes. It lives in shared because the embedders
// throw it too, and the api runs one for search queries.
export class LlmError extends Error {
  readonly truncated: boolean;
  readonly usage: LlmUsage | undefined;
  readonly loadMs: number | undefined;

  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    // Kept for bad_output so the repair step and the logs can see what the model actually returned.
    readonly rawText?: string,
    opts?: LlmErrorOptions,
  ) {
    super(message, opts);
    this.name = "LlmError";
    this.truncated = opts?.truncated ?? false;
    this.usage = opts?.usage;
    this.loadMs = opts?.loadMs;
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.kind);
  }
}
