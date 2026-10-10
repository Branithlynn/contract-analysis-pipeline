export type LlmErrorKind =
  "timeout" | "rate_limited" | "unavailable" | "auth" | "invalid_request" | "bad_output";

const RETRYABLE: ReadonlySet<LlmErrorKind> = new Set(["timeout", "rate_limited", "unavailable"]);

// Providers translate their sdk/http failures into this one shape so classifyError doesn't need to
// know about anthropic, openai or ollama error classes.
export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    // Kept for bad_output so the repair step and the logs can see what the model actually returned.
    readonly rawText?: string,
    opts?: ErrorOptions,
  ) {
    super(message, opts);
    this.name = "LlmError";
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.kind);
  }
}
