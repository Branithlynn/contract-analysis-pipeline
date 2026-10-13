// A saved ask eval run (the raw json next to each report) and scoring it again. Pure: the script
// in rescore.ts does the file work.
import { AskCitationSchema, AskStepSchema } from "@nexus/shared";
import { z } from "zod";
import type { AskHeader, AskRun } from "./ask-report.js";
import { scoreAsk, type AskCase, type NamedContract } from "./ask-score.js";

const HeaderSchema: z.ZodType<AskHeader> = z.object({
  provider: z.string(),
  model: z.string(),
  prompt_version: z.string(),
  embed_provider: z.string(),
  embed_model: z.string(),
  date: z.string(),
  clock: z.iso.date(),
  cpu: z.string(),
  repeat: z.number(),
  max_steps: z.number(),
  timeout_ms: z.number(),
});

// The old score is not read back. Everything in it was worked out from the answer, the citations
// and the steps, and those are all here.
const SavedAskRunSchema = z.object({
  label: z.string(),
  kind: z.string(),
  question: z.string(),
  status: z.enum(["done", "step_limit", "timeout", "error"]),
  error_message: z.string().nullable(),
  answer: z.string().nullable(),
  citations: z.array(AskCitationSchema),
  steps: z.array(AskStepSchema),
  model_calls: z.number(),
  latency_ms: z.number(),
  tokens: z.object({ input: z.number(), output: z.number() }).nullable(),
});
export type SavedAskRun = z.infer<typeof SavedAskRunSchema>;

export const SavedAskFileSchema = z.object({
  header: HeaderSchema,
  runs: z.array(SavedAskRunSchema),
});
export type SavedAskFile = z.infer<typeof SavedAskFileSchema>;

// Scores the saved answer with the scorer and the case as they are now. The citations keep the
// status they got in the run: checking them again would need that run's index.
export function rescoreAskRun(
  run: SavedAskRun,
  test: AskCase,
  corpus: readonly NamedContract[],
): AskRun {
  return { ...run, score: scoreAsk(test, corpus, run) };
}
