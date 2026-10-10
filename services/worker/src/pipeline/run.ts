import { UnrecoverableError, type Job } from "bullmq";
import { z } from "zod";
import {
  ExtractJobPayload,
  getDocument,
  insertEvent,
  transitionStatus,
  type Logger,
} from "@nexus/shared/node";
import type { WorkerDeps } from "../deps.js";
import { analyzeDocument, type AnalysisResult } from "./analyze.js";
import { PermanentError, classifyError, type ClassifiedError } from "./errors.js";
import { eventMessage, runStage, type StageContext } from "./stage.js";

// Only what processJob reads, so tests can pass a plain object instead of a redis backed Job.
export type ExtractJob = Pick<Job, "id" | "data" | "attemptsMade" | "opts">;

// The worker writes status itself instead of the api listening to queue events: it knows the stage
// and the error code, and the db stays the one source of truth.
export async function processJob(job: ExtractJob, deps: WorkerDeps): Promise<void> {
  const parsed = ExtractJobPayload.safeParse(job.data);
  if (!parsed.success) {
    deps.logger.error(
      { jobId: job.id, issues: z.flattenError(parsed.error) },
      "invalid job payload",
    );
    // Retrying cannot fix a malformed payload.
    throw new UnrecoverableError(`invalid job payload: ${z.prettifyError(parsed.error)}`);
  }

  const { documentId, run } = parsed.data;
  const log = deps.logger.child({ documentId, run, jobId: job.id });

  const doc = getDocument(deps.db, documentId);
  if (!doc) {
    log.warn("document not found, dropping job");
    return;
  }
  // A retry bumps run and enqueues a new job, so an older job for the same document is obsolete.
  if (doc.run !== run) {
    log.info({ currentRun: doc.run }, "stale job, dropping");
    return;
  }
  // processing is included because bullmq redelivers stalled jobs.
  const claimed = transitionStatus(deps.db, documentId, "processing", {
    from: ["queued", "processing"],
    bumpAttempts: true,
  });
  if (!claimed) {
    log.info({ status: doc.status }, "document already done, dropping job");
    return;
  }

  const ctx: StageContext = { deps, documentId, run };
  let result: AnalysisResult;
  try {
    result = await analyzeDocument(
      { path: doc.storage_path, mime: doc.mime, filename: doc.original_name },
      // The child logger, so parser debug lines carry documentId.
      { ...deps, logger: log },
      { onStage: (stage, fn) => runStage(ctx, stage, fn) },
    );
  } catch (err) {
    throw handleFailure(job, ctx, log, err);
  }

  if (result.extraction === null) {
    insertEvent(deps.db, {
      document_id: documentId,
      run,
      stage: "extracting",
      outcome: "info",
      message: "extraction not implemented yet",
    });
  }
  const { needsReview } = result;

  if (
    !transitionStatus(deps.db, documentId, "completed", {
      from: "processing",
      needs_review: needsReview,
    })
  ) {
    log.warn("document left processing before it could be completed");
    return;
  }
  log.info({ needsReview }, "document completed");
}

// Returns what processJob should throw: UnrecoverableError stops bullmq retrying, anything else
// lets it schedule the next attempt.
function handleFailure(job: ExtractJob, ctx: StageContext, log: Logger, err: unknown): unknown {
  const classified = classifyError(err);
  // bullmq increments attemptsMade only after an attempt fails, so it is 0 during the first one.
  const attempt = job.attemptsMade + 1;
  const attempts = job.opts.attempts ?? 1;

  if (classified instanceof PermanentError) {
    markFailed(ctx, log, classified);
    return new UnrecoverableError(`${classified.code}: ${classified.message}`);
  }
  if (attempt >= attempts) {
    markFailed(ctx, log, classified);
    return err;
  }

  insertEvent(ctx.deps.db, {
    document_id: ctx.documentId,
    run: ctx.run,
    stage: "job",
    outcome: "retry",
    message: eventMessage(
      `${classified.code}: ${classified.message}, retrying as attempt ${attempt + 1} of ${attempts}`,
    ),
  });
  log.warn({ code: classified.code, attempt, attempts }, "attempt failed, will retry");
  return err;
}

function markFailed(ctx: StageContext, log: Logger, err: ClassifiedError): void {
  const updated = transitionStatus(ctx.deps.db, ctx.documentId, "failed", {
    from: "processing",
    error_code: err.code,
    error_message: err.message,
  });
  if (!updated) log.warn("document left processing before it could be marked failed");
  log.error({ code: err.code, err }, "document failed");
}
