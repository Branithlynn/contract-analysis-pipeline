import {
  assertMigrated,
  createEmbedder,
  createLogger,
  createShutdown,
  defaultModelSelection,
  loadConfig,
  openDb,
  QUEUE_NAMES,
} from "@nexus/shared/node";
import type { WorkerDeps } from "./deps.js";
import { checkOllamaContext, createProviderRegistry } from "./llm/factory.js";
import { undiciVersions } from "./llm/ollama.js";
import { createWorkers } from "./worker.js";

const config = loadConfig();
const logger = createLogger("worker", config.LOG_LEVEL);

try {
  const db = openDb(config.DATABASE_PATH);
  // Only the api migrates. Starting on an old schema would fail later on some query, so fail here.
  assertMigrated(db);

  // Providers are built per job from what the job asks for, not once here.
  const providers = createProviderRegistry(config);
  const embedder = createEmbedder(config);
  const deps: WorkerDeps = { db, config, logger, providers, embedder, clock: () => new Date() };
  // close() lets active jobs finish, which can take as long as one llm call.
  // docker compose stop_grace_period has to be longer than this (6m with the defaults), or SIGKILL
  // arrives before active jobs finish.
  const shutdownTimeoutMs = config.LLM_TIMEOUT_MS + 30_000;

  const workers = createWorkers(config, deps);
  logger.info(
    {
      queues: QUEUE_NAMES,
      localConcurrency: workers.local.opts.concurrency,
      hostedConcurrency: workers.hosted.opts.concurrency,
      defaultModel: defaultModelSelection(config),
      embedProvider: embedder.name,
      embedModel: embedder.model,
      // The three timeouts depend on each other, so a wrong setting should show up here at startup.
      llmTimeoutMs: config.LLM_TIMEOUT_MS,
      lockDurationMs: workers.local.opts.lockDuration,
      shutdownTimeoutMs,
      undici: undiciVersions(),
      ollamaNumCtx: config.OLLAMA_NUM_CTX,
    },
    "worker started",
  );
  // Whatever the default provider is: a single upload can pick an ollama model.
  const context = checkOllamaContext(config);
  if (!context.fits) {
    logger.warn(
      {
        ollamaNumCtx: context.configured,
        needed: context.needed,
        llmMaxInputChars: config.LLM_MAX_INPUT_CHARS,
        promptVersion: config.PROMPT_VERSION,
      },
      `OLLAMA_NUM_CTX is ${String(context.configured)} but a full chunk needs ${String(context.needed)}. Such calls get the bigger num_ctx and ollama reloads the model every time the size changes. Set OLLAMA_NUM_CTX=${String(context.needed)} or lower LLM_MAX_INPUT_CHARS.`,
    );
  }

  const shutdown = createShutdown({
    logger,
    exit: (code) => process.exit(code),
    forceAfterMs: shutdownTimeoutMs,
    steps: [
      // Together: each waits for its own active jobs, and the force timeout covers both.
      ["workers", () => Promise.all([workers.local.close(), workers.hosted.close()])],
      // After the workers, so no call is still using a connection pool.
      ["llm", () => providers.close()],
      ["embedder", async () => embedder.close?.()],
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
