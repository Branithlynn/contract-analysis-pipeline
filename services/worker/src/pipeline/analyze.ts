import { resolve } from "node:path";
import {
  deriveDates,
  ErrorCode,
  expirationBasis,
  ExtractionResultSchema,
  type ExtractionResult,
  type Stage,
} from "@nexus/shared";
import { z } from "zod";
import type { WorkerDeps } from "../deps.js";
import { chunkText } from "../extraction/chunk.js";
import { extractChunk, type ChunkExtraction } from "../extraction/extract.js";
import { buildGroundingIndex, groundExtraction, groundingScore } from "../extraction/grounding.js";
import { buildInjectionGuard, dropInjected } from "../extraction/injection.js";
import { mapLimit } from "../extraction/limit.js";
import { mergeExtractions } from "../extraction/merge.js";
import { normalizeExtraction } from "../extraction/normalize.js";
import { decideNeedsReview } from "../extraction/review.js";
import { summarizeExtraction } from "../extraction/summarize.js";
import { concurrencyFor } from "../llm/concurrency.js";
import { extractPrompt } from "../llm/prompts/extract.js";
import type { LlmCallInfo, LlmUsage } from "../llm/types.js";
import { parseDocument, type ParsedDocument } from "../parse/index.js";
import { PermanentError } from "./errors.js";

export interface AnalyzeInput {
  // As stored on the document row: relative to UPLOAD_DIR.
  path: string;
  mime: string;
  filename: string;
}

// No db or queue: processJob owns those, and the eval script calls this directly without either.
export type AnalyzeDeps = Pick<WorkerDeps, "config" | "logger" | "provider" | "clock">;

export type StageRunner = <T>(stage: Stage, fn: () => Promise<T>) => Promise<T>;

export interface AnalyzeHooks {
  // processJob wraps runStage here to get stage tracking and events; the eval script needs neither.
  onStage?: StageRunner;
}

export interface AnalysisMeta {
  provider: string;
  model: string;
  promptVersion: string;
  chunkCount: number;
  // Every call, including failed repairs and the summary.
  tokens: LlmUsage;
  // The same calls one by one, chunks in order and the summary last.
  calls: LlmCallInfo[];
  durationMs: number;
}

export interface AnalysisResult {
  parsed: ParsedDocument;
  result: ExtractionResult;
  needsReview: boolean;
  meta: AnalysisMeta;
}

const runDirectly: StageRunner = (_stage, fn) => fn();

function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}

async function extractAll(
  parsed: ParsedDocument,
  input: AnalyzeInput,
  deps: AnalyzeDeps,
): Promise<ChunkExtraction[]> {
  const { config, logger, provider } = deps;
  const chunks = chunkText(parsed.text, config.LLM_MAX_INPUT_CHARS);
  const opts = {
    filename: input.filename,
    chunkCount: chunks.length,
    timeoutMs: config.LLM_TIMEOUT_MS,
    prompt: extractPrompt(config.PROMPT_VERSION),
  };
  const limit = concurrencyFor(
    provider,
    config.LLM_CHUNK_CONCURRENCY,
    "LLM_CHUNK_CONCURRENCY",
    logger,
  );
  return mapLimit(chunks, limit, async (chunk) => {
    const extraction = await extractChunk(provider, chunk, opts);
    logger.info(
      {
        chunk: chunk.index + 1,
        of: chunks.length,
        chars: chunk.text.length,
        repaired: extraction.repaired,
        latencyMs: extraction.latencyMs,
        ...extraction.usage,
      },
      "chunk extracted",
    );
    return extraction;
  });
}

async function validate(
  parsed: ParsedDocument,
  extractions: readonly ChunkExtraction[],
  deps: AnalyzeDeps,
): Promise<{
  result: ExtractionResult;
  needsReview: boolean;
  summaryUsage: LlmUsage;
  summaryCall: LlmCallInfo | null;
}> {
  const { config, logger, provider } = deps;
  const threshold = config.GROUNDING_REVIEW_THRESHOLD;
  const index = buildGroundingIndex(parsed.text);
  const guard = buildInjectionGuard(index, parsed.text);
  const warnings: string[] = [];
  if (guard.passages.length > 0) {
    logger.warn(
      { passages: guard.passages },
      "document has text addressed to an ai, values quoted from it are dropped",
    );
  }

  const grounded = extractions.map((e) => {
    const normalized = normalizeExtraction(e.data);
    warnings.push(...normalized.warnings);
    // Per chunk and before the merge: an injected value must not win it, become a conflict
    // candidate or reach the summary call.
    const clean = dropInjected(index, guard, groundExtraction(index, normalized.data).data);
    warnings.push(...clean.warnings);
    return { chunkIndex: e.chunkIndex, data: clean.data };
  });
  const merged = mergeExtractions(grounded);
  const summary = await summarizeExtraction(
    provider,
    merged.data,
    grounded.map((g) => g.data.summary),
    { timeoutMs: config.LLM_TIMEOUT_MS, logger, injectionSuspected: guard.passages.length > 0 },
  );
  warnings.push(...summary.warnings);

  const score = groundingScore(merged.data);
  const today = deps.clock().toISOString().slice(0, 10);
  const derived = deriveDates(
    merged.data,
    merged.data.risk_clauses,
    score,
    threshold,
    guard.passages,
    today,
  );
  // deriveDates replaced such a date with its own, here and on every read. Not a review reason:
  // nothing was stated, so there is nothing for a person to compare. The warning says where the
  // date went. When deriveDates had to keep it (source "model"), review flags that instead.
  const modelExpiration = merged.data.expiration_date;
  if (
    expirationBasis(modelExpiration) === "model_computed" &&
    derived.expiration_source !== "model"
  ) {
    warnings.push(
      `expiration_date: ignored ${JSON.stringify(modelExpiration.value)}, the date is not in its quote, so the model computed it`,
    );
  }
  const review = decideNeedsReview({
    data: merged.data,
    conflicts: merged.conflicts,
    warnings,
    groundingScore: score,
    threshold,
    alerts: derived.alerts,
    injections: guard.passages,
    expirationSource: derived.expiration_source,
  });

  // Every step above builds the strict shape by construction, so a failure here is our bug, not
  // the model's, and retrying won't fix it.
  const parsedResult = ExtractionResultSchema.safeParse({
    ...merged.data,
    summary: summary.summary,
    derived,
    conflicts: merged.conflicts,
    // The same normalize warning can come from several chunks.
    warnings: [...new Set([...warnings, ...review.reasons])],
    grounding_score: score,
    suspected_injections: guard.passages,
  });
  if (!parsedResult.success) {
    throw new PermanentError(
      ErrorCode.INTERNAL,
      `extraction result failed the stored schema: ${z.prettifyError(parsedResult.error)}`,
    );
  }
  return {
    result: parsedResult.data,
    needsReview: review.needsReview,
    summaryUsage: summary.usage,
    summaryCall: summary.call,
  };
}

export async function analyzeDocument(
  input: AnalyzeInput,
  deps: AnalyzeDeps,
  hooks: AnalyzeHooks = {},
): Promise<AnalysisResult> {
  const started = performance.now();
  const onStage = hooks.onStage ?? runDirectly;
  const path = resolve(deps.config.UPLOAD_DIR, input.path);

  const parsed = await onStage("parsing", () => parseDocument(path, input.mime, deps.logger));
  const extractions = await onStage("extracting", () => extractAll(parsed, input, deps));
  const { result, needsReview, summaryUsage, summaryCall } = await onStage("validating", () =>
    validate(parsed, extractions, deps),
  );

  const tokens = extractions.reduce((sum, e) => addUsage(sum, e.usage), summaryUsage);
  return {
    parsed,
    result,
    needsReview,
    meta: {
      provider: deps.provider.name,
      model: deps.provider.model,
      promptVersion: deps.config.PROMPT_VERSION,
      chunkCount: extractions.length,
      tokens,
      calls: [...extractions.flatMap((e) => e.calls), ...(summaryCall ? [summaryCall] : [])],
      durationMs: Math.round(performance.now() - started),
    },
  };
}
