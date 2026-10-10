import { describe, expect, it } from "vitest";
import { createLogger, loadConfig, openMemoryDb } from "@nexus/shared/node";
import type { JobQueue } from "./queue.js";
import { buildServer } from "./server.js";

function fakeQueue(pingError?: Error): JobQueue {
  return {
    enqueue: () => Promise.resolve(),
    ping: () => (pingError ? Promise.reject(pingError) : Promise.resolve()),
    close: () => Promise.resolve(),
  };
}

async function setup(queue: JobQueue) {
  const lines: Record<string, unknown>[] = [];
  const stream = {
    write: (chunk: string) => lines.push(JSON.parse(chunk) as Record<string, unknown>),
  };
  const db = openMemoryDb();
  const app = await buildServer({
    db,
    queue,
    config: loadConfig({}),
    logger: createLogger("api", "info", stream),
    clock: () => new Date("2026-06-01T12:00:00Z"),
  });
  return { app, db, lines };
}

describe("health routes", () => {
  it("/healthz is always 200, even with redis down", async () => {
    const { app } = await setup(fakeQueue(new Error("ECONNREFUSED")));
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("/readyz is 200 when the db and the queue answer", async () => {
    const { app } = await setup(fakeQueue());
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, checks: { db: true, queue: true } });
  });

  it("/readyz is 503 when the queue ping throws, and logs the reason", async () => {
    const { app, lines } = await setup(fakeQueue(new Error("redis ping timed out after 1000ms")));
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, checks: { db: true, queue: false } });
    const logged = lines.find((line) => line.msg === "readyz: redis ping failed");
    expect(logged?.err).toMatchObject({ message: "redis ping timed out after 1000ms" });
    expect(logged?.reqId).toEqual(expect.any(String));
  });

  it("/readyz is 503 when the db query fails", async () => {
    const { app, db, lines } = await setup(fakeQueue());
    db.close();
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, checks: { db: false, queue: true } });
    expect(lines.some((line) => line.msg === "readyz: database check failed")).toBe(true);
  });
});
