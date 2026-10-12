import { Worker } from "bullmq";
import { ExtractJobPayload, QUEUE_NAME, type Config } from "@nexus/shared/node";
import type { WorkerDeps } from "./deps.js";
import { concurrencyFor } from "./llm/concurrency.js";
import { handleFinalFailure, processJob } from "./pipeline/run.js";

function documentIdOf(data: unknown): string | undefined {
  return ExtractJobPayload.safeParse(data).data?.documentId;
}

// Separate from index.ts so the e2e test runs the same bullmq options and handlers as production.
export function createWorker(
  config: Pick<Config, "REDIS_URL" | "LLM_TIMEOUT_MS" | "WORKER_CONCURRENCY">,
  deps: WorkerDeps,
  // bullmq's key prefix. Only the e2e test sets it, so its jobs never mix with a dev queue on the same redis.
  prefix?: string,
): Worker {
  const { logger } = deps;
  const concurrency = concurrencyFor(
    deps.provider,
    config.WORKER_CONCURRENCY,
    "WORKER_CONCURRENCY",
    logger,
  );

  const worker = new Worker(QUEUE_NAME, (job) => processJob(job, deps), {
    connection: { url: config.REDIS_URL, maxRetriesPerRequest: null },
    concurrency,
    // Longer than the slowest llm call, so a long job can't look stalled and run twice in parallel.
    lockDuration: config.LLM_TIMEOUT_MS + 60_000,
    // A job that crashes a worker twice is failed instead of taking down the next one too.
    maxStalledCount: 1,
    ...(prefix === undefined ? {} : { prefix }),
  });

  worker.on("failed", (job, err) => {
    // Debug: processJob and handleFinalFailure already log every failure with its stack.
    logger.debug(
      {
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
    logger.error({ err }, "worker error");
  });

  return worker;
}
