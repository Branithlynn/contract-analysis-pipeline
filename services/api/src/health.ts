import type { FastifyPluginCallback } from "fastify";
import type { Db } from "@nexus/shared/node";
import type { JobQueue } from "./queue.js";

export interface HealthOptions {
  db: Db;
  queue: JobQueue;
}

// healthz says the process is up and never touches dependencies, so a redis outage doesn't get the
// container restarted. readyz says whether it can take uploads right now.
export const healthRoutes: FastifyPluginCallback<HealthOptions> = (app, { db, queue }, done) => {
  const selectOne = db.prepare("SELECT 1");

  app.get("/healthz", () => ({ ok: true }));

  app.get("/readyz", async (request, reply) => {
    const checks = { db: true, queue: true };
    try {
      selectOne.get();
    } catch (err) {
      checks.db = false;
      request.log.error({ err }, "readyz: database check failed");
    }
    try {
      await queue.ping();
    } catch (err) {
      checks.queue = false;
      request.log.warn({ err }, "readyz: redis ping failed");
    }
    const ok = checks.db && checks.queue;
    return reply.status(ok ? 200 : 503).send({ ok, checks });
  });

  done();
};
