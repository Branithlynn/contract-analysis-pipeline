import type { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@nexus/shared";
import { QUEUE_NAME, getDocument, loadConfig, transitionStatus } from "@nexus/shared/node";
import { docId, makeDeps, seedDocument } from "./test-support/fixtures.js";
import { createWorker } from "./worker.js";

// No redis in unit tests. The fake stands in for bullmq's Worker, so what is tested here is the
// options and listeners createWorker gives it. The e2e test runs the same function on a real redis.
const fakes = vi.hoisted(() => ({ workers: [] as unknown[] }));

// The factory runs before this file's imports, so it loads EventEmitter itself.
vi.mock("bullmq", async (importOriginal) => {
  const { EventEmitter } = await import("node:events");
  class Worker extends EventEmitter {
    constructor(
      readonly name: string,
      readonly processor: unknown,
      readonly opts: Record<string, unknown>,
    ) {
      super();
      fakes.workers.push(this);
    }
  }
  // run.ts needs the real UnrecoverableError.
  return { ...(await importOriginal<object>()), Worker };
});

interface FakeWorker extends EventEmitter {
  name: string;
  opts: Record<string, unknown>;
}

function setup(env: Record<string, string> = {}, providerName?: "ollama") {
  const { deps, lines } = makeDeps(env);
  if (providerName) Object.assign(deps.provider, { name: providerName });
  return { deps, lines, config: loadConfig(env) };
}

const created = () => fakes.workers.at(-1) as FakeWorker;

afterEach(() => {
  fakes.workers.length = 0;
});

describe("createWorker", () => {
  it("holds the job lock a minute longer than the llm timeout, and allows one stall", () => {
    const { deps, config } = setup({ LLM_TIMEOUT_MS: "120000", REDIS_URL: "redis://example:6379" });

    const worker = createWorker(config, deps);

    expect(worker).toBe(created());
    expect(created().name).toBe(QUEUE_NAME);
    expect(created().opts).toEqual({
      connection: { url: "redis://example:6379", maxRetriesPerRequest: null },
      concurrency: 2,
      lockDuration: 120_000 + 60_000,
      maxStalledCount: 1,
    });
  });

  it("runs one job at a time on ollama, whatever WORKER_CONCURRENCY says", () => {
    const { deps, config } = setup({ WORKER_CONCURRENCY: "4" }, "ollama");

    createWorker(config, deps);

    expect(created().opts.concurrency).toBe(1);
  });

  it("keeps WORKER_CONCURRENCY for other providers", () => {
    const { deps, config } = setup({ WORKER_CONCURRENCY: "4" });

    createWorker(config, deps);

    expect(created().opts.concurrency).toBe(4);
  });

  it("passes a key prefix on to bullmq when it is given one", () => {
    const { deps, config } = setup();

    createWorker(config, deps, "nexus-e2e");

    expect(created().opts.prefix).toBe("nexus-e2e");
  });

  it("marks the document failed when bullmq gives up on a stalled job", () => {
    const { deps, config } = setup();
    const id = seedDocument(deps);
    transitionStatus(deps.db, id, "processing", { from: "queued", bumpAttempts: true });
    createWorker(config, deps);

    created().emit(
      "failed",
      { id: "job-1", data: { documentId: id, run: 1 }, finishedOn: 1, attemptsMade: 1 },
      new Error("job stalled more than allowable limit"),
    );

    expect(getDocument(deps.db, id)).toMatchObject({
      status: "failed",
      error_code: ErrorCode.WORKER_STOPPED,
    });
  });

  it("logs instead of throwing when the failed handler itself fails", () => {
    const { deps, lines, config } = setup();
    createWorker(config, deps);
    deps.db.close();
    const job = { id: "job-1", data: { documentId: docId(1), run: 1 }, finishedOn: 1 };

    expect(() => created().emit("failed", job, new Error("lock lost"))).not.toThrow();
    expect(lines.at(-1)).toMatchObject({
      level: 50,
      jobId: "job-1",
      msg: "could not mark the document failed",
    });
  });

  it("logs a connection error from bullmq instead of letting it throw", () => {
    const { deps, lines, config } = setup();
    createWorker(config, deps);

    // An EventEmitter throws on "error" when nobody listens.
    expect(() => created().emit("error", new Error("ECONNRESET"))).not.toThrow();
    expect(lines.at(-1)).toMatchObject({ level: 50, msg: "worker error" });
  });
});
