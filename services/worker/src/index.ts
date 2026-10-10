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
import { processJob } from "./pipeline/run.js";

const config = loadConfig();
const logger = createLogger("worker", config.LOG_LEVEL);

function documentIdOf(data: unknown): string | undefined {
  return ExtractJobPayload.safeParse(data).data?.documentId;
}

try {
  const db = openDb(config.DATABASE_PATH);
  // Only the api migrates. Starting on an old schema would fail later on some query, so fail here.
  assertMigrated(db);

  const deps: WorkerDeps = { db, config, logger, provider: null, clock: () => new Date() };

  const worker = new Worker(QUEUE_NAME, (job) => processJob(job, deps), {
    connection: { url: config.REDIS_URL, maxRetriesPerRequest: null },
    concurrency: config.WORKER_CONCURRENCY,
    // Longer than the slowest llm call, so a long job can't look stalled and run twice in parallel.
    lockDuration: config.LLM_TIMEOUT_MS + 60_000,
    // A job that crashes a worker twice is failed instead of taking down the next one too.
    maxStalledCount: 1,
  });

  worker.on("failed", (job, err) => {
    logger.warn(
      { jobId: job?.id, documentId: documentIdOf(job?.data), attemptsMade: job?.attemptsMade, err },
      "job failed",
    );
  });
  // Without a listener bullmq prints connection errors to the console.
  worker.on("error", (err) => {
    logger.error({ err }, "worker error");
  });
  logger.info({ queue: QUEUE_NAME, concurrency: config.WORKER_CONCURRENCY }, "worker started");

  const shutdown = createShutdown({
    logger,
    exit: (code) => process.exit(code),
    // close() lets active jobs finish, which can take as long as one llm call.
    // docker compose stop_grace_period has to be longer than this (4m with the defaults), or SIGKILL
    // arrives before active jobs finish.
    forceAfterMs: config.LLM_TIMEOUT_MS + 30_000,
    steps: [
      ["worker", () => worker.close()],
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
