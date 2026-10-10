import { ErrorCode } from "@nexus/shared";
import { LlmError } from "../llm/errors.js";

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

// fetch wraps socket errors as TypeError("fetch failed") with the real code on .cause, and a stage
// may wrap an LlmError the same way, so the whole chain has to be checked. The seen set guards
// against cause cycles.
function causeChain(err: unknown): object[] {
  const chain: object[] = [];
  const seen = new Set<unknown>();
  let current = err;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

function isUnavailable(link: object): boolean {
  const { code, name } = link as { code?: unknown; name?: unknown };
  return (
    (typeof code === "string" && NETWORK_CODES.has(code)) ||
    (typeof name === "string" && ABORT_NAMES.has(name))
  );
}

function fromLlmError(llm: LlmError, cause: unknown): ClassifiedError {
  const opts = { cause };
  if (llm.retryable) return new TransientError(ErrorCode.LLM_UNAVAILABLE, llm.message, opts);
  switch (llm.kind) {
    case "auth":
      return new PermanentError(ErrorCode.LLM_AUTH, llm.message, opts);
    case "bad_output":
      // Only reaches here after the repair attempt also failed; the same prompt won't fix itself.
      return new PermanentError(ErrorCode.EXTRACTION_INVALID, llm.message, opts);
    default:
      // invalid_request means our request body is wrong, a code bug that retrying can't fix.
      return new PermanentError(ErrorCode.INTERNAL, llm.message, opts);
  }
}

// Unknown failures default to transient: retrying a real bug costs a few attempts, while marking a
// flaky failure permanent loses the document.
export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof PermanentError || err instanceof TransientError) return err;
  const chain = causeChain(err);
  // The provider already decided what its failure means, so that beats a socket code below it.
  const llm = chain.find((link): link is LlmError => link instanceof LlmError);
  if (llm) return fromLlmError(llm, err);
  const message = err instanceof Error ? err.message : String(err);
  const code = chain.some(isUnavailable) ? ErrorCode.LLM_UNAVAILABLE : ErrorCode.INTERNAL;
  return new TransientError(code, message, { cause: err });
}
