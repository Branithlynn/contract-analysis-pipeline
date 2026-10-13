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
  // Not shown in the list, the search field on it looks in them.
  customer_name: z.string().nullable(),
  governing_law: z.string().nullable(),
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
  // What a chat answer cites the chunk by, as [chunk:<id>].
  chunk_id: z.int(),
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

// POST /api/ask. The model is the one picked in the ui, both parts or neither: without one the
// LLM_PROVIDER / LLM_MODEL from the environment answer.
export const AskRequestSchema = z
  .object({
    question: z.string().trim().min(1).max(2000),
    // Continues a conversation. Left out on the first question, the answer carries a new one.
    thread_id: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
    provider: LlmProviderName.optional(),
    model: z.string().trim().min(1).max(200).optional(),
    // The question is about this one contract: every search is limited to it.
    document_id: z.uuid().optional(),
  })
  .refine((body) => (body.provider === undefined) === (body.model === undefined), {
    message: "provider and model have to be given together",
  });
export type AskRequest = z.infer<typeof AskRequestSchema>;

// One tool call of the agent, for showing how an answer came about.
export const AskStepSchema = z.object({
  tool: z.string(),
  input: z.record(z.string(), z.unknown()),
  // One line about what came back, not the result itself.
  result: z.string(),
});
export type AskStep = z.infer<typeof AskStepSchema>;

// verified: the cited chunk or contract exists and every quote next to the citation is in it.
// not_found: there is no such chunk or contract. quote_not_found: it exists, but the answer
// quotes words that are not in it.
export const CitationStatus = z.enum(["verified", "not_found", "quote_not_found"]);
export type CitationStatus = z.infer<typeof CitationStatus>;

// One [chunk:<id>] or [contract:<id>] in an answer, checked in code after the model wrote it.
export const AskCitationSchema = z.object({
  // As written in the answer, and where: the same source can be cited more than once.
  marker: z.string(),
  start: z.int().nonnegative(),
  kind: z.enum(["chunk", "contract"]),
  id: z.string(),
  status: CitationStatus,
  // Null when the source was not found.
  document_id: z.string().nullable(),
  file_name: z.string().nullable(),
  // For a chunk: the page of the first quote found in it, or the chunk's pages without a quote.
  // Null for a contract citation and for docx, which has no fixed pages.
  page_start: z.int().nullable(),
  page_end: z.int().nullable(),
  // The quoted text in front of the citation.
  quotes: z.array(
    z.object({
      text: z.string(),
      found: z.boolean(),
      page_start: z.int().nullable(),
      page_end: z.int().nullable(),
    }),
  ),
});
export type AskCitation = z.infer<typeof AskCitationSchema>;

export const AskResponseSchema = z.object({
  thread_id: z.string(),
  // The model that answered.
  model: ModelSelectionSchema,
  // step_limit: the model kept asking for tools until ASK_MAX_STEPS ran out. There is no answer
  // then, only the steps it took, and the thread does not remember the question.
  stopped: z.enum(["done", "step_limit"]),
  answer: z.string().nullable(),
  citations: z.array(AskCitationSchema),
  steps: z.array(AskStepSchema),
});
export type AskResponse = z.infer<typeof AskResponseSchema>;

// The details of an ASK_TIMEOUT error: what the agent had done when the time ran out.
export const AskTimeoutDetailsSchema = z.object({
  thread_id: z.string(),
  steps: z.array(AskStepSchema),
});

// POST /api/ask/stream sends these as server-sent events while the agent works, the event name
// being the event field here. started comes first, then a step for every tool the model asks
// for and one for its result, and at the end either done with the same body POST /api/ask
// returns, or error with what an error response would have carried.
export const AskProgressSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("tool_call"),
    tool: z.string(),
    input: z.record(z.string(), z.unknown()),
  }),
  // result: the same one line a step of the finished answer has.
  z.object({ type: z.literal("tool_result"), tool: z.string(), result: z.string() }),
]);
export type AskProgress = z.infer<typeof AskProgressSchema>;

export const AskStreamEventSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("started"),
    data: z.object({ thread_id: z.string(), model: ModelSelectionSchema }),
  }),
  z.object({ event: z.literal("step"), data: AskProgressSchema }),
  z.object({ event: z.literal("done"), data: AskResponseSchema }),
  z.object({
    event: z.literal("error"),
    // status: the http status the same failure has on POST /api/ask.
    data: ErrorBodySchema.extend({ status: z.int() }),
  }),
]);
export type AskStreamEvent = z.infer<typeof AskStreamEventSchema>;

// A chat thread in the list. The title is its first question.
export const ThreadSummarySchema = z.object({
  thread_id: z.string(),
  title: z.string(),
  // The contract the thread is about, when it was started from one.
  document_id: z.string().nullable(),
  updated_at: Timestamp,
  // Only in the answer to a search (?q=): the text around the first match in what was asked and
  // answered, in pieces, so the page can mark the matches without parsing markup. Null when
  // only the title matches.
  snippet: z
    .array(z.object({ text: z.string(), match: z.boolean() }))
    .nullable()
    .optional(),
});
export type ThreadSummary = z.infer<typeof ThreadSummarySchema>;

export const ThreadMessageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), text: z.string() }),
  z.object({
    role: z.literal("assistant"),
    text: z.string(),
    // Checked again when the thread is read: a document that was indexed again since has new
    // chunk ids, and a citation of an old one then reads not_found.
    citations: z.array(AskCitationSchema),
    steps: z.array(AskStepSchema),
    // Null for an answer stored before the model was recorded.
    model: ModelSelectionSchema.nullable(),
  }),
]);
export type ThreadMessage = z.infer<typeof ThreadMessageSchema>;

export const ThreadDetailSchema = ThreadSummarySchema.extend({
  messages: z.array(ThreadMessageSchema),
});
export type ThreadDetail = z.infer<typeof ThreadDetailSchema>;

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
