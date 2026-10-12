import fastifyMultipart from "@fastify/multipart";
import { fastify } from "fastify";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { ErrorBody } from "@nexus/shared";
import type { Config, Db, Embedder, Logger } from "@nexus/shared/node";
import { createOllamaGate } from "./ask/busy.js";
import { createChatModels, type ChatModels } from "./ask/chat-models.js";
import { createThreadStore } from "./ask/threads.js";
import { errorHandler } from "./errors.js";
import { healthRoutes } from "./health.js";
import type { JobQueue } from "./queue.js";
import { requestIdFrom } from "./request-id.js";
import { askRoutes } from "./routes/ask.js";
import { documentRoutes } from "./routes/documents.js";
import { modelRoutes } from "./routes/models.js";
import { searchRoutes } from "./routes/search.js";
import type { ModelCatalog } from "./services/models.js";

const MB = 1024 * 1024;

export interface ServerDeps {
  db: Db;
  queue: JobQueue;
  config: Config;
  logger: Logger;
  // Embeds search queries. The worker embeds the documents with the same provider and model.
  embedder: Embedder;
  // Which models can be selected right now. Lists them and checks what a request asks for.
  models: ModelCatalog;
  // Injected so tests can pin "today". Anything date dependent reads time through this.
  clock: () => Date;
  // The memory of the chat threads. index.ts creates it at startup, right after the migrations.
  // Left out, it is created here on the same database, which is what the tests do.
  threads?: BaseCheckpointSaver;
  // The chat models of the ask agent. Tests pass scripted ones.
  chatModels?: ChatModels;
}

// Returns the app without listening so tests can drive it with inject().
export async function buildServer({
  db,
  queue,
  config,
  logger,
  embedder,
  models,
  clock,
  threads = createThreadStore(db),
  chatModels = createChatModels({ config }),
}: ServerDeps) {
  const app = fastify({
    loggerInstance: logger,
    genReqId: (request) => requestIdFrom(request.headers["x-request-id"]),
    // Only json bodies hit this. Multipart streams past it and is capped by the limits below.
    bodyLimit: 1 * MB,
  });

  app.setErrorHandler(errorHandler);
  // Without this, unknown routes get fastify's own 404 body instead of ErrorBody.
  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: { code: "NOT_FOUND", message: `Route ${request.method} ${request.url} not found` },
    } satisfies ErrorBody),
  );

  await app.register(fastifyMultipart, {
    // A file over the limit is rejected on its own (part.file.truncated) instead of failing the whole batch.
    throwFileSizeLimit: false,
    limits: {
      fileSize: config.MAX_UPLOAD_MB * MB,
      files: config.MAX_FILES_PER_REQUEST,
      // Uploads are files only, any text field is rejected.
      fields: 0,
    },
  });
  await app.register(healthRoutes, { db, queue });
  await app.register(documentRoutes, { prefix: "/api", db, queue, config, models, clock });
  await app.register(modelRoutes, { prefix: "/api", models });
  await app.register(searchRoutes, { prefix: "/api", db, embedder });
  await app.register(askRoutes, {
    prefix: "/api",
    db,
    embedder,
    config,
    models,
    clock,
    threads,
    chatModels,
    ollamaGate: createOllamaGate({
      activeLocalJobs: () => queue.activeLocalJobs(),
      waitMs: config.ASK_BUSY_WAIT_MS,
      logger,
    }),
  });

  return app;
}
