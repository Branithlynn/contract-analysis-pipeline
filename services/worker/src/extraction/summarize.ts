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
import type { LlmProvider, LlmUsage } from "../llm/types.js";
import type { GroundedExtraction } from "./grounding.js";

export interface SummarizeOptions {
  timeoutMs: number;
  logger: Logger;
}

export interface SummaryResult {
  summary: string;
  usage: LlmUsage;
  warnings: string[];
}

export const SUMMARY_FALLBACK_WARNING = "summary: fell back to first chunk";

const ZERO: LlmUsage = { inputTokens: 0, outputTokens: 0 };

// One chunk already summarized the whole document. With more, each chunk's summary covers only its
// part, so one more call writes the summary from the merged data.
export async function summarizeExtraction(
  provider: LlmProvider,
  merged: GroundedExtraction,
  chunkSummaries: readonly string[],
  { timeoutMs, logger }: SummarizeOptions,
): Promise<SummaryResult> {
  const first = chunkSummaries[0] ?? "";
  if (chunkSummaries.length <= 1) return { summary: first, usage: ZERO, warnings: [] };

  try {
    const res = await provider.complete({
      system: buildSystemPrompt(),
      messages: [{ role: "user", content: buildUserMessage(merged) }],
      schema: summaryJsonSchema(),
      schemaName: SCHEMA_NAME,
      timeoutMs,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    const parsed = LlmSummarySchema.safeParse(res.json);
    const summary = parsed.success ? parsed.data.summary.trim() : "";
    if (summary !== "") return { summary, usage: res.usage, warnings: [] };
    logger.warn(
      { rawText: res.rawText.slice(0, 500) },
      "summary reply unusable, using first chunk",
    );
    return { summary: first, usage: res.usage, warnings: [SUMMARY_FALLBACK_WARNING] };
  } catch (err) {
    // The extraction already succeeded; a failed summary shouldn't fail the document, and it isn't
    // worth a bullmq retry of every chunk either.
    logger.warn({ err }, "summary call failed, using first chunk");
    const usage = err instanceof LlmError ? (err.usage ?? ZERO) : ZERO;
    return { summary: first, usage, warnings: [SUMMARY_FALLBACK_WARNING] };
  }
}
