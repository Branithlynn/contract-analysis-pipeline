import { Worker } from "bullmq";
import { ExtractJobPayload, QUEUE_NAMES, type Config, type QueueKind } from "@nexus/shared/node";
import type { WorkerDeps } from "./deps.js";
import { handleFinalFailure, processJob } from "./pipeline/run.js";

function documentIdOf(data: unknown): string | undefined {
  return ExtractJobPayload.safeParse(data).data?.documentId;
}

export type WorkerConfig = Pick<Config, "REDIS_URL" | "LLM_TIMEOUT_MS" | "WORKER_CONCURRENCY">;

// One local gpu: a second ollama job would wait in ollama's queue with its timeout running, or
// ollama runs both and the kv cache spills onto the cpu. So the local queue never runs two jobs at
// once, whatever WORKER_CONCURRENCY says. That setting is for the hosted queue.
export function concurrencyOf(kind: QueueKind, config: WorkerConfig): number {
  return kind === "local" ? 1 : config.WORKER_CONCURRENCY;
}

// Separate from index.ts so the e2e test runs the same bullmq options and handlers as production.
export function createWorker(
  config: WorkerConfig,
  deps: WorkerDeps,
  kind: QueueKind,
  // bullmq's key prefix. Only the e2e test sets it, so its jobs never mix with a dev queue on the same redis.
  prefix?: string,
): Worker {
  const { logger } = deps;

  const worker = new Worker(QUEUE_NAMES[kind], (job) => processJob(job, deps, kind), {
    connection: { url: config.REDIS_URL, maxRetriesPerRequest: null },
    concurrency: concurrencyOf(kind, config),
    // Longer than the slowest llm call, so a long job can't look stalled and run twice in parallel.
    // The same for both queues: the timeout is per call, whichever provider answers it.
    lockDuration: config.LLM_TIMEOUT_MS + 60_000,
    // A job that crashes a worker twice is failed instead of taking down the next one too.
    maxStalledCount: 1,
    ...(prefix === undefined ? {} : { prefix }),
  });

  worker.on("failed", (job, err) => {
    // Debug: processJob and handleFinalFailure already log every failure with its stack.
    logger.debug(
      {
        queue: kind,
        jobId: job?.id,
        documentId: documentIdOf(job?.data),
        attemptsMade: job?.attemptsMade,
        reason: err.message,
      },
      "job failed",
    );
    try {
      handleFinalFailure(job, err, deps);
    } catch (handlerErr) {
      // A throw inside an event listener would surface as an uncaught exception.
      logger.error({ jobId: job?.id, err: handlerErr }, "could not mark the document failed");
    }
  });
  // Without a listener bullmq prints connection errors to the console.
  worker.on("error", (err) => {
    logger.error({ queue: kind, err }, "worker error");
  });

  return worker;
}

// The two consumers of one worker process: local jobs strictly one at a time, hosted jobs in parallel.
export function createWorkers(
  config: WorkerConfig,
  deps: WorkerDeps,
  prefix?: string,
): Record<QueueKind, Worker> {
  return {
    local: createWorker(config, deps, "local", prefix),
    hosted: createWorker(config, deps, "hosted", prefix),
  };
}
