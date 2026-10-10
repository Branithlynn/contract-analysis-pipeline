import { ErrorCode } from "@nexus/shared";

// Fails the same way on every attempt (broken pdf, no text layer), so the job runner turns it into
// bullmq's UnrecoverableError and skips the remaining attempts.
export class PermanentError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    opts?: ErrorOptions,
  ) {
    super(message, opts);
    this.name = "PermanentError";
  }
}

// Might succeed next time. bullmq is the only layer that retries; the sdks run with maxRetries: 0,
// otherwise retries multiply (2 sdk x 3 bullmq = 9 calls for one bad minute at the provider).
export class TransientError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    opts?: ErrorOptions,
  ) {
    super(message, opts);
    this.name = "TransientError";
  }
}

export type ClassifiedError = PermanentError | TransientError;

const NETWORK_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"]);
const ABORT_NAMES = new Set(["AbortError", "TimeoutError"]);

// fetch wraps socket errors as TypeError("fetch failed") with the real code on .cause, so the whole
// chain has to be checked. The seen set guards against cause cycles.
function isUnavailable(err: unknown): boolean {
  const seen = new Set<unknown>();
  let current = err;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const { code, name } = current as { code?: unknown; name?: unknown };
    if (typeof code === "string" && NETWORK_CODES.has(code)) return true;
    if (typeof name === "string" && ABORT_NAMES.has(name)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

// Unknown failures default to transient: retrying a real bug costs a few attempts, while marking a
// flaky failure permanent loses the document.
export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof PermanentError || err instanceof TransientError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const code = isUnavailable(err) ? ErrorCode.LLM_UNAVAILABLE : ErrorCode.INTERNAL;
  return new TransientError(code, message, { cause: err });
}
