import { UnrecoverableError, type Job } from "bullmq";
import { z } from "zod";
import { ErrorCode, type IndexStatus } from "@nexus/shared";
import {
  defaultModelSelection,
  ExtractJobPayload,
  failRun,
  getDocument,
  insertEvent,
  insertExtraction,
  queueKindFor,
  selectionOr,
  setIndexStatus,
  transitionStatus,
  type Logger,
  type ModelSelection,
  type QueueKind,
} from "@nexus/shared/node";
import type { WorkerDeps } from "../deps.js";
import { indexDocument } from "../retrieval/index-document.js";
import { analyzeDocument, type AnalysisResult } from "./analyze.js";
import { PermanentError, classifyError, type ClassifiedError } from "./errors.js";
import { eventMessage, runStage, type StageContext } from "./stage.js";

// Only what processJob reads, so tests can pass a plain object instead of a redis backed Job.
export type ExtractJob = Pick<Job, "id" | "data" | "attemptsMade" | "opts">;

// What bullmq hands the worker's failed listener. finishedOn is only set once the job has failed
// for good; a failure that will be retried doesn't have it.
export type FailedJob = Pick<Job, "id" | "data" | "finishedOn">;

const STALLED_REASON = "job stalled more than allowable limit";

// The worker writes status itself instead of the api listening to queue events: it knows the stage
// and the error code, and the db stays the one source of truth.
export async function processJob(
  job: ExtractJob,
  deps: WorkerDeps,
  // The queue the job came from. Left out by callers that have no queue (tests of the pipeline).
  queue?: QueueKind,
): Promise<void> {
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

  // The job says which model. A job from before models could be chosen says nothing, then the
  // document row does, and for rows from back then the default from the environment applies.
  const selection = selectionOr(
    parsed.data,
    selectionOr(
      { provider: doc.llm_provider, model: doc.llm_model },
      defaultModelSelection(deps.config),
    ),
  );
  log.info({ provider: selection.provider, model: selection.model, queue }, "job started");

  const ctx: StageContext = { deps, documentId, run };
  let result: AnalysisResult;
  try {
    // The api routes by provider, so this never happens with our own jobs. Checked anyway: an
    // ollama job on the hosted queue would run next to another one, which is the one thing the
    // two queues exist to prevent.
    if (queue !== undefined && queueKindFor(selection.provider) !== queue) {
      throw new PermanentError(
        ErrorCode.INTERNAL,
        `A ${selection.provider} job arrived on the ${queue} queue`,
      );
    }
    // Inside the try: a selection this worker cannot serve (no key, model not allowed) fails the
    // document with its reason instead of crashing the job.
    const provider = deps.providers.get(selection);
    result = await analyzeDocument(
      { path: doc.storage_path, mime: doc.mime, filename: doc.original_name },
      // The child logger, so parser debug lines carry documentId.
      { config: deps.config, clock: deps.clock, logger: log, provider },
      { onStage: (stage, fn) => runStage(ctx, stage, fn) },
    );
  } catch (err) {
    throw handleFailure(job, ctx, log, err, selection);
  }

  const index = await buildIndex(ctx, log, result.parsed.text);

  const { needsReview, meta } = result;
  const groundingScore = result.result.grounding_score;
  // One transaction: a completed document always has its extraction, and a document that left
  // processing in the meantime (a retry bumped its run) doesn't get this run's result attached.
  const completed = deps.db.transaction(() => {
    const moved = transitionStatus(deps.db, documentId, "completed", {
      from: "processing",
      needs_review: needsReview,
    });
    if (!moved) return false;
    setIndexStatus(deps.db, documentId, index.status, index.error);
    insertExtraction(deps.db, {
      document_id: documentId,
      run,
      provider: meta.provider,
      model: meta.model,
      prompt_version: meta.promptVersion,
      result: result.result,
      grounding_score: groundingScore,
      chunk_count: meta.chunkCount,
      input_tokens: meta.tokens.inputTokens,
      output_tokens: meta.tokens.outputTokens,
      duration_ms: meta.durationMs,
    });
    insertEvent(deps.db, {
      document_id: documentId,
      run,
      stage: "job",
      outcome: "info",
      message: `chunks=${String(meta.chunkCount)} grounding=${groundingScore === null ? "n/a" : groundingScore.toFixed(2)} needs_review=${String(needsReview)}`,
    });
    return true;
  })();
  if (!completed) {
    log.warn("document left processing before it could be completed");
    return;
  }
  // The raw replies are document content and can be long. They are for the eval json, not the log.
  const calls = meta.calls.map((call) => ({ ...call, rawText: undefined }));
  log.info(
    { needsReview, groundingScore, indexStatus: index.status, ...meta, calls },
    "document completed",
  );
}

// The extraction is the result people wait for and it is done at this point, so a failed index does
// not fail the document, and it is not retried through bullmq either: that would run the whole
// extraction again. The document completes with index_status failed, runStage has put the error
// on its timeline, and `npm run index:backfill` builds the index later.
async function buildIndex(
  ctx: StageContext,
  log: Logger,
  text: string,
): Promise<{ status: IndexStatus; error: string | null }> {
  try {
    const summary = await runStage(ctx, "indexing", () =>
      indexDocument({ ...ctx.deps, logger: log }, ctx.documentId, text),
    );
    log.info({ ...summary }, "document indexed");
    return { status: "indexed", error: null };
  } catch (err) {
    const { code, message } = classifyError(err);
    log.warn({ code, err }, "indexing failed, the document completes without a search index");
    return { status: "failed", error: eventMessage(`${code}: ${message}`) };
  }
}

// Covers the failures processJob never sees. When a worker dies twice while holding a job, bullmq
// fails the job itself before calling the processor, so nothing marks the row and it would stay
// "processing" forever: the reconciler only sweeps queued rows.
// A no-op unless the row is still processing for this job's run, so it never overrides what
// processJob wrote and never touches a document that has been retried since.
// Returns true when it ended the run: the document is failed, or, when it was completed before
// this run, completed again with its previous result.
export function handleFinalFailure(
  job: FailedJob | undefined,
  err: Error,
  deps: Pick<WorkerDeps, "db" | "logger" | "config">,
): boolean {
  if (job?.finishedOn === undefined) return false;
  const payload = ExtractJobPayload.safeParse(job.data);
  if (!payload.success) return false;
  const { documentId, run } = payload.data;

  const stalled = err.message.includes(STALLED_REASON);
  const code = stalled ? ErrorCode.WORKER_STOPPED : ErrorCode.INTERNAL;
  const message = stalled
    ? "worker stopped while processing this document twice"
    : eventMessage(`job failed outside the pipeline: ${err.message}`);

  // Status and run are checked in the same transaction as the write, like the success path.
  const outcome = deps.db.transaction(() => {
    const doc = getDocument(deps.db, documentId);
    if (!doc) return "skipped" as const;
    const result = failRun(deps.db, {
      documentId,
      run,
      model: selectionOr(
        payload.data,
        selectionOr(
          { provider: doc.llm_provider, model: doc.llm_model },
          defaultModelSelection(deps.config),
        ),
      ),
      promptVersion: deps.config.PROMPT_VERSION,
      code,
      message,
    });
    // A kept document got its own event from failRun.
    if (result === "failed") {
      insertEvent(deps.db, {
        document_id: documentId,
        run,
        stage: "job",
        outcome: "error",
        message: `${code}: ${message}`,
      });
    }
    return result;
  })();
  if (outcome === "failed") {
    deps.logger.error({ documentId, run, jobId: job.id, code, err }, "document failed");
  }
  if (outcome === "kept_completed") {
    deps.logger.error(
      { documentId, run, jobId: job.id, code, err },
      "run failed, the document keeps its previous result",
    );
  }
  return outcome !== "skipped";
}

// Returns what processJob should throw: UnrecoverableError stops bullmq retrying, anything else
// lets it schedule the next attempt.
function handleFailure(
  job: ExtractJob,
  ctx: StageContext,
  log: Logger,
  err: unknown,
  selection: ModelSelection,
): unknown {
  const classified = classifyError(err);
  // bullmq increments attemptsMade only after an attempt fails, so it is 0 during the first one.
  const attempt = job.attemptsMade + 1;
  const attempts = job.opts.attempts ?? 1;

  if (classified instanceof PermanentError) {
    markFailed(ctx, log, classified, selection);
    return new UnrecoverableError(`${classified.code}: ${classified.message}`);
  }
  if (attempt >= attempts) {
    markFailed(ctx, log, classified, selection);
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
  // The one line with the stack for an attempt that will be retried.
  log.warn({ code: classified.code, attempt, attempts, err }, "attempt failed, will retry");
  return err;
}

// The run is over without a result. What that means for the document is failRun's decision: a
// document that was completed before this run stays completed, one that never completed fails.
function markFailed(
  ctx: StageContext,
  log: Logger,
  err: ClassifiedError,
  selection: ModelSelection,
): void {
  const outcome = failRun(ctx.deps.db, {
    documentId: ctx.documentId,
    run: ctx.run,
    model: selection,
    promptVersion: ctx.deps.config.PROMPT_VERSION,
    code: err.code,
    message: err.message,
  });
  if (outcome === "skipped") {
    log.warn("document left processing before it could be marked failed");
  }
  if (outcome === "kept_completed") {
    log.error({ code: err.code, err }, "run failed, the document keeps its previous result");
  } else {
    log.error({ code: err.code, err }, "document failed");
  }
}
