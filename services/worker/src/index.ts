import { Worker } from "bullmq";
import {
  assertMigrated,
  createLogger,
  createShutdown,
  ExtractJobPayload,
  loadConfig,
  openDb,
  QUEUE_NAME,
} from "@nexus/shared/node";
import type { WorkerDeps } from "./deps.js";
import { concurrencyFor } from "./llm/concurrency.js";
import { createProvider } from "./llm/factory.js";
import { undiciVersions } from "./llm/ollama.js";
import { handleFinalFailure, processJob } from "./pipeline/run.js";

const config = loadConfig();
const logger = createLogger("worker", config.LOG_LEVEL);

function documentIdOf(data: unknown): string | undefined {
  return ExtractJobPayload.safeParse(data).data?.documentId;
}

try {
  const db = openDb(config.DATABASE_PATH);
  // Only the api migrates. Starting on an old schema would fail later on some query, so fail here.
  assertMigrated(db);

  const provider = createProvider(config);
  const deps: WorkerDeps = { db, config, logger, provider, clock: () => new Date() };
  const concurrency = concurrencyFor(
    provider,
    config.WORKER_CONCURRENCY,
    "WORKER_CONCURRENCY",
    logger,
  );

  // Longer than the slowest llm call, so a long job can't look stalled and run twice in parallel.
  const lockDurationMs = config.LLM_TIMEOUT_MS + 60_000;
  // close() lets active jobs finish, which can take as long as one llm call.
  // docker compose stop_grace_period has to be longer than this (6m with the defaults), or SIGKILL
  // arrives before active jobs finish.
  const shutdownTimeoutMs = config.LLM_TIMEOUT_MS + 30_000;

  const worker = new Worker(QUEUE_NAME, (job) => processJob(job, deps), {
    connection: { url: config.REDIS_URL, maxRetriesPerRequest: null },
    concurrency,
    lockDuration: lockDurationMs,
    // A job that crashes a worker twice is failed instead of taking down the next one too.
    maxStalledCount: 1,
  });

  worker.on("failed", (job, err) => {
    logger.warn(
      { jobId: job?.id, documentId: documentIdOf(job?.data), attemptsMade: job?.attemptsMade, err },
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
  logger.info(
    {
      queue: QUEUE_NAME,
      concurrency,
      provider: provider.name,
      model: provider.model,
      // The three timeouts depend on each other, so a wrong setting should show up here at startup.
      llmTimeoutMs: config.LLM_TIMEOUT_MS,
      lockDurationMs,
      shutdownTimeoutMs,
      undici: undiciVersions(),
    },
    "worker started",
  );

  const shutdown = createShutdown({
    logger,
    exit: (code) => process.exit(code),
    forceAfterMs: shutdownTimeoutMs,
    steps: [
      ["worker", () => worker.close()],
      // After the worker, so no call is still using the connection pool.
      ["llm", async () => provider.close?.()],
      [
        "db",
        () => {
          db.close();
        },
      ],
    ],
  });
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
} catch (err) {
  logger.fatal({ err }, "worker failed to start");
  process.exit(1);
}
