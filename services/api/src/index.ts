import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  createEmbedder,
  createLogger,
  defaultModelSelection,
  createShutdown,
  LATEST_VERSION,
  loadConfig,
  migrate,
  openDb,
} from "@nexus/shared/node";
import { backfillThreadIndex } from "./ask/agent.js";
import { createChatModels } from "./ask/chat-models.js";
import { createThreadStore, THREAD_TABLES } from "./ask/threads.js";
import { BullMqJobQueue } from "./queue.js";
import { startReconciler } from "./reconciler.js";
import { buildServer } from "./server.js";
import { readContext } from "./services/dto.js";
import { createModelCatalog } from "./services/models.js";

const config = loadConfig();
const logger = createLogger("api", config.LOG_LEVEL);

try {
  const db = openDb(config.DATABASE_PATH);
  // Only the api migrates; the worker asserts the version, so the two never race on DDL.
  const applied = migrate(db);
  logger.info(
    {
      applied,
      schemaVersion: LATEST_VERSION,
      path: config.DATABASE_PATH,
      embedProvider: config.EMBED_PROVIDER,
      embedModel: config.EMBED_MODEL,
    },
    "database ready",
  );

  // The chat threads live in the same file, in tables the checkpointer package creates itself.
  // Here and nowhere else, so they exist before the first question and a failure stops the boot.
  const threads = createThreadStore(db);
  logger.info({ tables: THREAD_TABLES }, "thread store ready");
  // Chats from before the search index over them existed. Nothing to do on later starts.
  const indexedThreads = await backfillThreadIndex({
    db,
    threads,
    log: logger,
    context: readContext(new Date(), config.GROUNDING_REVIEW_THRESHOLD),
  });
  if (indexedThreads > 0) logger.info({ threads: indexedThreads }, "thread search index filled");

  mkdirSync(join(config.UPLOAD_DIR, "tmp"), { recursive: true });

  const queue = new BullMqJobQueue(config.REDIS_URL, config.JOB_ATTEMPTS, logger);
  const clock = () => new Date();
  const embedder = createEmbedder(config);
  const models = createModelCatalog({ config, logger });
  const chatModels = createChatModels({ config });
  const app = await buildServer({
    db,
    queue,
    config,
    logger,
    embedder,
    models,
    clock,
    threads,
    chatModels,
  });
  await app.listen({ host: "0.0.0.0", port: config.API_PORT });

  const reconciler = startReconciler({
    db,
    queue,
    logger,
    clock,
    defaultModel: defaultModelSelection(config),
  });

  const shutdown = createShutdown({
    logger,
    exit: (code) => process.exit(code),
    steps: [
      ["reconciler", () => reconciler.stop()],
      // Stops accepting connections and waits for in-flight requests, which may still enqueue or write.
      ["http", () => app.close()],
      ["queue", () => queue.close()],
      // After http, so no search request is still waiting on it.
      ["embedder", async () => embedder.close?.()],
      ["models", () => models.close()],
      ["chat models", () => chatModels.close()],
      ["db", () => db.close()],
    ],
  });
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
} catch (err) {
  logger.fatal({ err }, "api failed to start");
  process.exit(1);
}
