// A saved eval run (the raw json next to each report) and scoring it again. Pure: the script in
// rescore.ts does the file work.
import { deriveDates, ExtractionResultSchema } from "@nexus/shared";
import { z } from "zod";
import type { CaseRun, ReportHeader } from "./report.js";
import { scoreCase, type ExpectedCase } from "./score.js";

const CallSchema = z.object({
  kind: z.enum(["extract", "repair", "retry", "summary"]),
  chunkIndex: z.number().nullable(),
  ok: z.boolean(),
  durationMs: z.number(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
  numCtx: z.number().nullable(),
});

const HeaderSchema: z.ZodType<ReportHeader> = z.object({
  provider: z.string(),
  model: z.string(),
  prompt_version: z.string(),
  date: z.string(),
  clock: z.iso.date(),
  cpu: z.string(),
  repeat: z.number(),
});

// The old score is not read back apart from needs_review: that was the pipeline's decision at the
// time, and nothing in the file lets it be worked out again.
const SavedRunSchema = z.object({
  label: z.string(),
  status: z.string(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  latency_ms: z.number(),
  meta: z
    .object({
      chunks: z.number(),
      inputTokens: z.number(),
      outputTokens: z.number(),
      calls: z.array(CallSchema).optional(),
    })
    .nullable(),
  score: z.object({ needs_review: z.boolean() }),
  // The stored schema, so a result saved before a field existed gets that field's default.
  result: ExtractionResultSchema.nullable(),
});
export type SavedRun = z.infer<typeof SavedRunSchema>;

export const SavedFileSchema = z.object({ header: HeaderSchema, runs: z.array(SavedRunSchema) });
export type SavedFile = z.infer<typeof SavedFileSchema>;

// "saas-subscription-pdf #2" was the second repeat of the case saas-subscription-pdf.
export function caseName(label: string): string {
  return label.replace(/ #\d+$/, "");
}

// Scores the saved extraction with the scorer as it is now. The derived block is rebuilt first with
// the deriveDates as it is now and the clock the run used, like the api does on every read.
export function rescoreRun(
  run: SavedRun,
  expected: ExpectedCase,
  clock: string,
  groundingThreshold: number,
): CaseRun {
  const result =
    run.result === null
      ? null
      : {
          ...run.result,
          derived: deriveDates(
            run.result,
            run.result.risk_clauses,
            run.result.grounding_score,
            groundingThreshold,
            run.result.suspected_injections,
            clock,
          ),
        };
  return {
    label: run.label,
    status: run.status,
    error_code: run.error_code,
    error_message: run.error_message,
    latency_ms: run.latency_ms,
    meta: run.meta,
    score: scoreCase(expected, {
      status: run.status,
      error_code: run.error_code,
      needs_review: run.score.needs_review,
      result,
    }),
  };
}
