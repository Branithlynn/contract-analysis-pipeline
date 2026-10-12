import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  createEmbedder,
  createLogger,
  createShutdown,
  LATEST_VERSION,
  loadConfig,
  migrate,
  openDb,
} from "@nexus/shared/node";
import { BullMqJobQueue } from "./queue.js";
import { startReconciler } from "./reconciler.js";
import { buildServer } from "./server.js";

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

  mkdirSync(join(config.UPLOAD_DIR, "tmp"), { recursive: true });

  const queue = new BullMqJobQueue(config.REDIS_URL, config.JOB_ATTEMPTS, logger);
  const clock = () => new Date();
  const embedder = createEmbedder(config);
  const app = await buildServer({ db, queue, config, logger, embedder, clock });
  await app.listen({ host: "0.0.0.0", port: config.API_PORT });

  const reconciler = startReconciler({ db, queue, logger, clock });

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
      ["db", () => db.close()],
    ],
  });
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
} catch (err) {
  logger.fatal({ err }, "api failed to start");
  process.exit(1);
}
