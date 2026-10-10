import { resolve } from "node:path";
import type { Stage } from "@nexus/shared";
import type { WorkerDeps } from "../deps.js";
import { parseDocument, type ParsedDocument } from "../parse/index.js";

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

export interface AnalysisResult {
  parsed: ParsedDocument;
  extraction: null;
  needsReview: boolean;
}

const runDirectly: StageRunner = (_stage, fn) => fn();

export async function analyzeDocument(
  input: AnalyzeInput,
  deps: AnalyzeDeps,
  hooks: AnalyzeHooks = {},
): Promise<AnalysisResult> {
  const onStage = hooks.onStage ?? runDirectly;
  const path = resolve(deps.config.UPLOAD_DIR, input.path);

  const parsed = await onStage("parsing", () => parseDocument(path, input.mime, deps.logger));

  // Extraction is not built yet, and with nothing extracted there is nothing to trust unreviewed.
  return { parsed, extraction: null, needsReview: true };
}
