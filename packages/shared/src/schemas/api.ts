import { z } from "zod";
import { DocumentStatus, ErrorCode, Stage } from "../status.js";
import { ExtractionResultSchema, Severity, StrictMoney } from "./extraction.js";

// Response objects are not strict: the web client parses them, and an extra field from a newer api
// should not break an older client.

const StatusSchema = z.enum(DocumentStatus);
const StageSchema = z.enum(Stage);
const ErrorCodeSchema = z.enum(ErrorCode);
const Timestamp = z.iso.datetime();
const NonNegInt = z.int().nonnegative();

export const DocumentSummarySchema = z.object({
  id: z.string(),
  original_name: z.string(),
  status: StatusSchema,
  // Null while queued and once the document reaches a terminal status.
  stage: StageSchema.nullable(),
  needs_review: z.boolean(),
  error_code: ErrorCodeSchema.nullable(),
  error_message: z.string().nullable(),
  duplicate_of: z.string().nullable(),
  created_at: Timestamp,
  updated_at: Timestamp,
  // Everything below comes from the extraction, so it is null until one exists.
  vendor_name: z.string().nullable(),
  total_contract_value: StrictMoney.nullable(),
  expiration_date: z.iso.date().nullable(),
  notice_deadline: z.iso.date().nullable(),
  days_until_notice_deadline: z.int().nullable(),
  max_risk_severity: Severity.nullable(),
  risk_count: NonNegInt.nullable(),
  grounding_score: z.number().min(0).max(1).nullable(),
});
export type DocumentSummary = z.infer<typeof DocumentSummarySchema>;

export const EventOutcome = z.enum(["ok", "error", "retry", "info"]);
export type EventOutcome = z.infer<typeof EventOutcome>;

export const DocumentEventSchema = z.object({
  // Plain string, not Stage: info and retry events use labels outside the processing stages.
  stage: z.string(),
  outcome: EventOutcome,
  message: z.string(),
  duration_ms: NonNegInt.nullable(),
  created_at: Timestamp,
});
export type DocumentEvent = z.infer<typeof DocumentEventSchema>;

export const ExtractionRecordSchema = z.object({
  result: ExtractionResultSchema,
  provider: z.string(),
  model: z.string(),
  prompt_version: z.string(),
  // Providers that do not report usage store 0.
  input_tokens: NonNegInt,
  output_tokens: NonNegInt,
  duration_ms: NonNegInt,
  chunk_count: z.int().min(1),
});
export type ExtractionRecord = z.infer<typeof ExtractionRecordSchema>;

export const DocumentDetailSchema = DocumentSummarySchema.extend({
  mime: z.string(),
  size_bytes: NonNegInt,
  attempts: NonNegInt,
  // Starts at 1 and each retry bumps it. Job ids are "<docId>:<run>", so the worker can drop stale jobs.
  run: z.int().min(1),
  extraction: ExtractionRecordSchema.nullable(),
  events: z.array(DocumentEventSchema),
});
export type DocumentDetail = z.infer<typeof DocumentDetailSchema>;

export const UploadResponseSchema = z.object({
  accepted: z.array(
    z.object({
      id: z.string(),
      original_name: z.string(),
      status: StatusSchema,
      duplicate_of: z.string().nullable(),
    }),
  ),
  rejected: z.array(
    z.object({
      original_name: z.string(),
      code: ErrorCodeSchema,
      message: z.string(),
    }),
  ),
});
export type UploadResponse = z.infer<typeof UploadResponseSchema>;

export const ErrorBodySchema = z.object({
  error: z.object({
    // Plain string, not ErrorCode: http errors like NOT_FOUND or VALIDATION_ERROR are not document error codes.
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;
