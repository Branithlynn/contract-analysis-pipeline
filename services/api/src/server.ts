import fastifyMultipart from "@fastify/multipart";
import { fastify } from "fastify";
import type { ErrorBody } from "@nexus/shared";
import type { Config, Db, Embedder, Logger } from "@nexus/shared/node";
import { errorHandler } from "./errors.js";
import { healthRoutes } from "./health.js";
import type { JobQueue } from "./queue.js";
import { requestIdFrom } from "./request-id.js";
import { documentRoutes } from "./routes/documents.js";
import { searchRoutes } from "./routes/search.js";

const MB = 1024 * 1024;

export interface ServerDeps {
  db: Db;
  queue: JobQueue;
  config: Config;
  logger: Logger;
  // Embeds search queries. The worker embeds the documents with the same provider and model.
  embedder: Embedder;
  // Injected so tests can pin "today". Anything date dependent reads time through this.
  clock: () => Date;
}

// Returns the app without listening so tests can drive it with inject().
export async function buildServer({ db, queue, config, logger, embedder, clock }: ServerDeps) {
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
  await app.register(documentRoutes, { prefix: "/api", db, queue, config, clock });
  await app.register(searchRoutes, { prefix: "/api", db, embedder });

  return app;
}
