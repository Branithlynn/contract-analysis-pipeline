import type { Stage } from "@nexus/shared";
import { insertEvent, setStage } from "@nexus/shared/node";
import type { WorkerDeps } from "../deps.js";
import { classifyError } from "./errors.js";

export interface StageContext {
  deps: WorkerDeps;
  documentId: string;
  run: number;
}

// Events are shown on the dashboard timeline; a full stack or a huge provider error body does not
// belong there, the log has the details.
const MAX_EVENT_MESSAGE = 500;

export function eventMessage(text: string): string {
  return text.length > MAX_EVENT_MESSAGE ? text.slice(0, MAX_EVENT_MESSAGE) : text;
}

export async function runStage<T>(
  ctx: StageContext,
  stage: Stage,
  fn: () => Promise<T>,
): Promise<T> {
  const { deps, documentId, run } = ctx;
  setStage(deps.db, documentId, stage);
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);

  try {
    const result = await fn();
    const durationMs = elapsed();
    insertEvent(deps.db, {
      document_id: documentId,
      run,
      stage,
      outcome: "ok",
      message: "ok",
      duration_ms: durationMs,
    });
    deps.logger.info({ documentId, run, stage, durationMs }, "stage ok");
    return result;
  } catch (err) {
    const durationMs = elapsed();
    // Classified only to label the event. The caller decides retry vs fail, so the original goes up.
    const { code, message } = classifyError(err);
    insertEvent(deps.db, {
      document_id: documentId,
      run,
      stage,
      outcome: "error",
      message: eventMessage(`${code}: ${message}`),
      duration_ms: durationMs,
    });
    deps.logger.warn({ documentId, run, stage, durationMs, code, err }, "stage failed");
    throw err;
  }
}
