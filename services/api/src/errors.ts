import { STATUS_CODES } from "node:http";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ErrorBody } from "@nexus/shared";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

interface Mapped {
  status: number;
  code: string;
  message: string;
}

// Client errors fastify and @fastify/multipart throw that deserve a more specific answer than their status.
const KNOWN_CLIENT_ERRORS: Record<string, Mapped> = {
  FST_FILES_LIMIT: {
    status: 413,
    code: "TOO_MANY_FILES",
    message: "Too many files in one request",
  },
  FST_REQ_FILE_TOO_LARGE: {
    status: 413,
    code: "FILE_TOO_LARGE",
    message: "File is larger than the upload limit",
  },
  FST_PARTS_LIMIT: {
    status: 413,
    code: "TOO_MANY_PARTS",
    message: "Too many parts in one request",
  },
  // fields is 0, so hitting this means the client sent a text field. That's a malformed request, not a big one.
  FST_FIELDS_LIMIT: {
    status: 400,
    code: "UNEXPECTED_FIELD",
    message: "Only file parts are accepted",
  },
  FST_PROTO_VIOLATION: { status: 400, code: "BAD_REQUEST", message: "Invalid field name" },
  // multipart answers 406, but the problem is the request's content type, which is what 415 means.
  FST_INVALID_MULTIPART_CONTENT_TYPE: {
    status: 415,
    code: "UNSUPPORTED_MEDIA_TYPE",
    message: "Expected multipart/form-data",
  },
};

interface ClientError {
  statusCode: number;
  code?: unknown;
  message: string;
}

function isClientError(error: unknown): error is ClientError {
  if (!(error instanceof Error) || !("statusCode" in error)) return false;
  const { statusCode } = error;
  return typeof statusCode === "number" && statusCode >= 400 && statusCode < 500;
}

// Busboy raises these only once it reaches the offending part, after earlier files were already stored and
// enqueued. The upload route reports them next to those files instead of failing the whole request.
const BATCH_LIMIT_CODES: ReadonlySet<string> = new Set(["FST_FILES_LIMIT", "FST_FIELDS_LIMIT"]);

export function batchLimitError(error: unknown): { code: string; message: string } | undefined {
  if (!isClientError(error) || typeof error.code !== "string") return undefined;
  if (!BATCH_LIMIT_CODES.has(error.code)) return undefined;
  const known = KNOWN_CLIENT_ERRORS[error.code];
  return known && { code: known.code, message: known.message };
}

// "Payload Too Large" -> "PAYLOAD_TOO_LARGE", so unmapped 4xx still get a stable code.
function codeForStatus(status: number): string {
  return (STATUS_CODES[status] ?? "Bad Request").toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function toResponse(error: unknown): { status: number; body: ErrorBody } {
  if (error instanceof HttpError) {
    const body: ErrorBody = { error: { code: error.code, message: error.message } };
    if (error.details !== undefined) body.error.details = error.details;
    return { status: error.status, body };
  }
  if (error instanceof z.ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request",
          details: z.flattenError(error),
        },
      },
    };
  }
  if (isClientError(error)) {
    const known = typeof error.code === "string" ? KNOWN_CLIENT_ERRORS[error.code] : undefined;
    if (known) {
      return {
        status: known.status,
        body: { error: { code: known.code, message: known.message } },
      };
    }
    return {
      status: error.statusCode,
      body: { error: { code: codeForStatus(error.statusCode), message: error.message } },
    };
  }
  return { status: 500, body: { error: { code: "INTERNAL", message: "Internal error" } } };
}

export function errorHandler(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  const { status, body } = toResponse(error);
  // request.log already carries reqId.
  if (status >= 500) {
    request.log.error({ err: error }, "request failed");
  } else {
    request.log.info({ code: body.error.code, status }, "request rejected");
  }
  return reply.status(status).send(body);
}
