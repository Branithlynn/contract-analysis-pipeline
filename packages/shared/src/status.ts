export const DocumentStatus = {
  queued: "queued",
  processing: "processing",
  completed: "completed",
  failed: "failed",
} as const;
export type DocumentStatus = (typeof DocumentStatus)[keyof typeof DocumentStatus];

export const Stage = {
  parsing: "parsing",
  extracting: "extracting",
  validating: "validating",
} as const;
export type Stage = (typeof Stage)[keyof typeof Stage];

export const ErrorCode = {
  UNSUPPORTED_TYPE: "UNSUPPORTED_TYPE",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  NO_TEXT_LAYER: "NO_TEXT_LAYER",
  EMPTY_DOCUMENT: "EMPTY_DOCUMENT",
  TEXT_TOO_LONG: "TEXT_TOO_LONG",
  PARSE_ERROR: "PARSE_ERROR",
  EXTRACTION_INVALID: "EXTRACTION_INVALID",
  LLM_UNAVAILABLE: "LLM_UNAVAILABLE",
  LLM_AUTH: "LLM_AUTH",
  INTERNAL: "INTERNAL",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const TERMINAL_STATUSES: readonly DocumentStatus[] = [
  DocumentStatus.completed,
  DocumentStatus.failed,
];

export const ALLOWED_TRANSITIONS = {
  queued: [DocumentStatus.processing, DocumentStatus.failed],
  // bullmq can redeliver a stalled job, so a document that is already processing gets picked up again.
  processing: [DocumentStatus.processing, DocumentStatus.completed, DocumentStatus.failed],
  // Terminal states only go back to queued, which is the retry path.
  completed: [DocumentStatus.queued],
  failed: [DocumentStatus.queued],
} as const satisfies Record<DocumentStatus, readonly DocumentStatus[]>;
