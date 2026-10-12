import {
  assertMigrated,
  createLogger,
  createShutdown,
  loadConfig,
  openDb,
  QUEUE_NAME,
} from "@nexus/shared/node";
import type { WorkerDeps } from "./deps.js";
import { createProvider } from "./llm/factory.js";
import { undiciVersions } from "./llm/ollama.js";
import { createWorker } from "./worker.js";

const config = loadConfig();
const logger = createLogger("worker", config.LOG_LEVEL);

try {
  const db = openDb(config.DATABASE_PATH);
  // Only the api migrates. Starting on an old schema would fail later on some query, so fail here.
  assertMigrated(db);

  const provider = createProvider(config);
  const deps: WorkerDeps = { db, config, logger, provider, clock: () => new Date() };
  // close() lets active jobs finish, which can take as long as one llm call.
  // docker compose stop_grace_period has to be longer than this (6m with the defaults), or SIGKILL
  // arrives before active jobs finish.
  const shutdownTimeoutMs = config.LLM_TIMEOUT_MS + 30_000;

  const worker = createWorker(config, deps);
  logger.info(
    {
      queue: QUEUE_NAME,
      concurrency: worker.opts.concurrency,
      provider: provider.name,
      model: provider.model,
      // The three timeouts depend on each other, so a wrong setting should show up here at startup.
      llmTimeoutMs: config.LLM_TIMEOUT_MS,
      lockDurationMs: worker.opts.lockDuration,
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
