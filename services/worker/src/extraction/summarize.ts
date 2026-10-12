import type { Logger } from "@nexus/shared/node";
import { LlmError } from "../llm/errors.js";
import {
  LlmSummarySchema,
  MAX_OUTPUT_TOKENS,
  SCHEMA_NAME,
  buildSystemPrompt,
  buildUserMessage,
  summaryJsonSchema,
} from "../llm/prompts/summary.v1.js";
import type { LlmCallInfo, LlmProvider, LlmRequest, LlmUsage } from "../llm/types.js";
import type { GroundedExtraction } from "./grounding.js";

export interface SummarizeOptions {
  timeoutMs: number;
  logger: Logger;
  // The document has a passage addressed to an ai. See summarizeExtraction.
  injectionSuspected: boolean;
}

export interface SummaryResult {
  summary: string;
  usage: LlmUsage;
  warnings: string[];
  // Null when no call was made.
  call: LlmCallInfo | null;
}

export const SUMMARY_FALLBACK_WARNING = "summary: fell back to first chunk";
export const SUMMARY_WITHHELD_WARNING =
  "summary: left empty, the summary call failed and the document has a suspected prompt injection";

const ZERO: LlmUsage = { inputTokens: 0, outputTokens: 0 };

// One chunk already summarized the whole document. With more, each chunk's summary covers only its
// part, so one more call writes the summary from the merged data.
//
// A chunk summary is written by the extract call, which read the raw text. On a document with a
// suspected injection that text includes the injected passage: the 7b put the injected USD 5,000,000
// into its summary of the nda. So such a document always gets the call, also with one chunk, from
// the data the injection filter already cleaned, and a chunk summary is never used, not even when
// the call fails.
export async function summarizeExtraction(
  provider: LlmProvider,
  merged: GroundedExtraction,
  chunkSummaries: readonly string[],
  { timeoutMs, logger, injectionSuspected }: SummarizeOptions,
): Promise<SummaryResult> {
  const first = chunkSummaries[0] ?? "";
  if (chunkSummaries.length <= 1 && !injectionSuspected) {
    return { summary: first, usage: ZERO, warnings: [], call: null };
  }
  const fallback = injectionSuspected
    ? { summary: "", warnings: [SUMMARY_WITHHELD_WARNING] }
    : { summary: first, warnings: [SUMMARY_FALLBACK_WARNING] };
  // With one chunk the merged data still carries that chunk's summary.
  const data = injectionSuspected ? { ...merged, summary: "" } : merged;

  const req: LlmRequest = {
    system: buildSystemPrompt(),
    messages: [{ role: "user", content: buildUserMessage(data) }],
    schema: summaryJsonSchema(),
    schemaName: SCHEMA_NAME,
    timeoutMs,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  };
  const numCtx = provider.numCtx?.(req) ?? null;
  const started = performance.now();
  const call = (
    ok: boolean,
    usage: LlmUsage,
    rawText: string | null,
    loadMs: number | null,
  ): LlmCallInfo => ({
    kind: "summary",
    chunkIndex: null,
    ok,
    durationMs: Math.round(performance.now() - started),
    usage,
    numCtx,
    loadMs,
    rawText,
  });

  try {
    const res = await provider.complete(req);
    const parsed = LlmSummarySchema.safeParse(res.json);
    const summary = parsed.success ? parsed.data.summary.trim() : "";
    if (summary !== "") {
      return {
        summary,
        usage: res.usage,
        warnings: [],
        call: call(true, res.usage, res.rawText, res.loadMs ?? null),
      };
    }
    logger.warn(
      { rawText: res.rawText.slice(0, 500), injectionSuspected },
      "summary reply unusable",
    );
    return {
      ...fallback,
      usage: res.usage,
      call: call(false, res.usage, res.rawText, res.loadMs ?? null),
    };
  } catch (err) {
    // The extraction already succeeded; a failed summary shouldn't fail the document, and it isn't
    // worth a bullmq retry of every chunk either.
    logger.warn({ err, injectionSuspected }, "summary call failed");
    const usage = err instanceof LlmError ? (err.usage ?? ZERO) : ZERO;
    const rawText = err instanceof LlmError ? (err.rawText ?? null) : null;
    const loadMs = err instanceof LlmError ? (err.loadMs ?? null) : null;
    return { ...fallback, usage, call: call(false, usage, rawText, loadMs) };
  }
}
