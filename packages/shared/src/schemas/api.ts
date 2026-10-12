import { z } from "zod";
import { LlmProviderName, ModelSelectionSchema } from "../providers.js";
import { DocumentStatus, ErrorCode, IndexStatus, Stage } from "../status.js";
import {
  AlertCode,
  AlertLevel,
  ExtractionResultSchema,
  Severity,
  StrictMoney,
} from "./extraction.js";

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
  // The model the document's newest run was asked to use, whether that run worked or not.
  // Null on documents from before a model could be chosen, which ran with the default.
  requested_provider: LlmProviderName.nullable(),
  requested_model: z.string().nullable(),
  // The model and prompt that produced the values below. Not always the requested one: after
  // a run that failed, a completed document still shows the result of the run before it.
  // Null when there are no values.
  result_provider: z.string().nullable(),
  result_model: z.string().nullable(),
  result_prompt_version: z.string().nullable(),
  // Everything below comes from the extraction, so it is null until one exists.
  vendor_name: z.string().nullable(),
  total_contract_value: StrictMoney.nullable(),
  expiration_date: z.iso.date().nullable(),
  // End of the term the contract is in today. Later than expiration_date once an auto-renewing
  // contract has rolled over, so the list shows this one for contracts that renew.
  current_term_end: z.iso.date().nullable(),
  auto_renewal: z.boolean().nullable(),
  notice_deadline: z.iso.date().nullable(),
  days_until_notice_deadline: z.int().nullable(),
  max_risk_severity: Severity.nullable(),
  risk_count: NonNegInt.nullable(),
  // What needs attention, as code and level only: the list shows them as small badges, the
  // detail has the full message. Empty without an extraction.
  alerts: z.array(z.object({ code: AlertCode, level: AlertLevel })),
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

// One finished run of a document: which model and prompt it used, and how it ended.
export const RunSummarySchema = z.object({
  run: z.int().min(1),
  // completed: the run produced an extraction. failed: it ended without one.
  status: z.enum(["completed", "failed"]),
  // Why a failed run failed. Null for a completed one.
  error_code: ErrorCodeSchema.nullable(),
  error_message: z.string().nullable(),
  provider: z.string(),
  model: z.string(),
  prompt_version: z.string(),
  // The numbers of the extraction, all null for a failed run.
  grounding_score: z.number().min(0).max(1).nullable(),
  chunk_count: z.int().min(1).nullable(),
  input_tokens: NonNegInt.nullable(),
  output_tokens: NonNegInt.nullable(),
  duration_ms: NonNegInt.nullable(),
  created_at: Timestamp,
  // The run the document's own values come from.
  latest: z.boolean(),
});
export type RunSummary = z.infer<typeof RunSummarySchema>;

export const DocumentDetailSchema = DocumentSummarySchema.extend({
  mime: z.string(),
  size_bytes: NonNegInt,
  attempts: NonNegInt,
  // Starts at 1 and each retry bumps it. Job ids are "<docId>_<run>", so the worker can drop stale jobs.
  run: z.int().min(1),
  extraction: ExtractionRecordSchema.nullable(),
  // Every finished run, newest first, so results of different models can be compared. A failed
  // run is listed with its error. After a failed retry or reanalysis a completed document is
  // still completed and its values are from the newest completed run, the one marked latest.
  runs: z.array(RunSummarySchema),
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

// One provider in GET /api/models. Never carries a key or a part of one.
export const ProviderAvailabilitySchema = z.object({
  provider: LlmProviderName,
  available: z.boolean(),
  // Why it cannot be used, e.g. "OPENAI_API_KEY is not set". Null when available.
  reason: z.string().nullable(),
  // What can be selected: installed chat models for ollama, the allowlist for hosted providers.
  models: z.array(z.string()),
});
export type ProviderAvailability = z.infer<typeof ProviderAvailabilitySchema>;

export const ModelsResponseSchema = z.object({
  // What a request without provider and model gets.
  default: ModelSelectionSchema,
  providers: z.array(ProviderAvailabilitySchema),
});
export type ModelsResponse = z.infer<typeof ModelsResponseSchema>;

export const ErrorBodySchema = z.object({
  error: z.object({
    // Plain string, not ErrorCode: http errors like NOT_FOUND or VALIDATION_ERROR are not document error codes.
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;
