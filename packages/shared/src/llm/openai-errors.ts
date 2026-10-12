import {
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
  type APIError,
} from "openai";
import type { LlmErrorKind } from "./errors.js";

// Same mapping as the anthropic provider. Subclasses before the classes they extend.
// Used by the chat provider in the worker and by the embedder.
export function openAIErrorKind(err: APIError): LlmErrorKind {
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
