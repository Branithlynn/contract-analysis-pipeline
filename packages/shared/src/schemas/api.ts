import { z } from "zod";
import { DocumentStatus, ErrorCode, IndexStatus, Stage } from "../status.js";
import { ExtractionResultSchema, Severity, StrictMoney } from "./extraction.js";

// Response objects are not strict: the web client parses them, and an extra field from a newer api
// should not break an older client.

const StatusSchema = z.enum(DocumentStatus);
const StageSchema = z.enum(Stage);
const ErrorCodeSchema = z.enum(ErrorCode);
const IndexStatusSchema = z.enum(IndexStatus);
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
  // Whether search can find this document. failed: the extraction is fine, the index is not, so
  // the document is not searchable until a backfill. Null: never indexed (not completed yet,
  // processed before the index existed, or a duplicate, which is found through its original).
  index_status: IndexStatusSchema.nullable(),
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
  // When the worker stored this result. For a duplicate it is the original's, since the result is reused.
  created_at: Timestamp,
});
export type ExtractionRecord = z.infer<typeof ExtractionRecordSchema>;

export const DocumentDetailSchema = DocumentSummarySchema.extend({
  mime: z.string(),
  size_bytes: NonNegInt,
  attempts: NonNegInt,
  // Starts at 1 and each retry bumps it. Job ids are "<docId>_<run>", so the worker can drop stale jobs.
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
  // Request level problem, e.g. too many files or no files at all. Files handled before it stay in accepted/rejected.
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
export type UploadResponse = z.infer<typeof UploadResponseSchema>;

// vector: by meaning, through the embeddings. keyword: by the words, full text with bm25.
// hybrid: both, with the two rankings fused.
export const SearchMode = z.enum(["vector", "keyword", "hybrid"]);
export type SearchMode = z.infer<typeof SearchMode>;

// A later page starting inside a chunk, at this character offset of its text.
export const PageBreakSchema = z.object({
  page: z.int().positive(),
  offset: z.int().nonnegative(),
});

// One retrieval chunk from GET /api/search.
export const SearchHitSchema = z.object({
  document_id: z.string(),
  file_name: z.string(),
  // The pages the chunk's text is on. Both null for docx, which has no fixed pages.
  page_start: z.int().nullable(),
  page_end: z.int().nullable(),
  // For pagesOfQuote, which gives the exact page of a quote from the text.
  page_breaks: z.array(PageBreakSchema),
  text: z.string(),
  // Higher is closer. Cosine similarity in vector mode, negated bm25 in keyword mode, the fused
  // rank score in hybrid mode, so only comparable within one response.
  score: z.number(),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;

export const SearchResponseSchema = z.array(SearchHitSchema);
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export const ErrorBodySchema = z.object({
  error: z.object({
    // Plain string, not ErrorCode: http errors like NOT_FOUND or VALIDATION_ERROR are not document error codes.
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;
