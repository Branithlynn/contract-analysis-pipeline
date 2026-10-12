import type { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@nexus/shared";
import { QUEUE_NAMES, getDocument, loadConfig, transitionStatus } from "@nexus/shared/node";
import { docId, makeDeps, seedDocument } from "./test-support/fixtures.js";
import { concurrencyOf, createWorker, createWorkers } from "./worker.js";

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

function setup(env: Record<string, string> = {}) {
  const { deps, lines } = makeDeps(env);
  return { deps, lines, config: loadConfig(env) };
}

const created = () => fakes.workers.at(-1) as FakeWorker;

afterEach(() => {
  fakes.workers.length = 0;
});

describe("createWorker", () => {
  it("holds the job lock a minute longer than the llm timeout, and allows one stall", () => {
    const { deps, config } = setup({ LLM_TIMEOUT_MS: "120000", REDIS_URL: "redis://example:6379" });

    const worker = createWorker(config, deps, "hosted");

    expect(worker).toBe(created());
    expect(created().name).toBe(QUEUE_NAMES.hosted);
    expect(created().opts).toEqual({
      connection: { url: "redis://example:6379", maxRetriesPerRequest: null },
      concurrency: 2,
      lockDuration: 120_000 + 60_000,
      maxStalledCount: 1,
    });
  });

  it("gives the local queue the same lock and stall settings", () => {
    const { deps, config } = setup({ LLM_TIMEOUT_MS: "120000", REDIS_URL: "redis://example:6379" });

    createWorker(config, deps, "local");

    expect(created().name).toBe(QUEUE_NAMES.local);
    expect(created().opts).toEqual({
      connection: { url: "redis://example:6379", maxRetriesPerRequest: null },
      concurrency: 1,
      lockDuration: 120_000 + 60_000,
      maxStalledCount: 1,
    });
  });

  it("runs one local job at a time, whatever WORKER_CONCURRENCY says", () => {
    for (const WORKER_CONCURRENCY of ["1", "4", "32"]) {
      const { deps, config } = setup({ WORKER_CONCURRENCY });

      createWorker(config, deps, "local");

      expect(created().opts.concurrency).toBe(1);
      expect(concurrencyOf("local", config)).toBe(1);
    }
  });

  it("runs WORKER_CONCURRENCY hosted jobs in parallel", () => {
    const { deps, config } = setup({ WORKER_CONCURRENCY: "4" });

    createWorker(config, deps, "hosted");

    expect(created().opts.concurrency).toBe(4);
  });

  it("createWorkers starts one consumer per queue: local with 1, hosted with the setting", () => {
    const { deps, config } = setup({ WORKER_CONCURRENCY: "5" });

    const workers = createWorkers(config, deps, "nexus-e2e");

    const all = fakes.workers as FakeWorker[];
    expect(all).toHaveLength(2);
    expect(all.map((w) => [w.name, w.opts.concurrency, w.opts.prefix])).toEqual([
      [QUEUE_NAMES.local, 1, "nexus-e2e"],
      [QUEUE_NAMES.hosted, 5, "nexus-e2e"],
    ]);
    expect(workers.local).toBe(all[0]);
    expect(workers.hosted).toBe(all[1]);
    // Two different queues, or the concurrency of one would mean nothing for the other.
    expect(QUEUE_NAMES.local).not.toBe(QUEUE_NAMES.hosted);
  });

  it("passes a key prefix on to bullmq when it is given one", () => {
    const { deps, config } = setup();

    createWorker(config, deps, "hosted", "nexus-e2e");

    expect(created().opts.prefix).toBe("nexus-e2e");
  });

  it("marks the document failed when bullmq gives up on a stalled job", () => {
    const { deps, config } = setup();
    const id = seedDocument(deps);
    transitionStatus(deps.db, id, "processing", { from: "queued", bumpAttempts: true });
    createWorker(config, deps, "hosted");

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
    createWorker(config, deps, "hosted");
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
    createWorker(config, deps, "hosted");

    // An EventEmitter throws on "error" when nobody listens.
    expect(() => created().emit("error", new Error("ECONNRESET"))).not.toThrow();
    expect(lines.at(-1)).toMatchObject({ level: 50, msg: "worker error" });
  });
});
