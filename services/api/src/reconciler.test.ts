import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDocument,
  createLogger,
  migrate,
  openMemoryDb,
  transitionStatus,
  type Db,
} from "@nexus/shared/node";
import type { JobQueue } from "./queue.js";
import { startReconciler } from "./reconciler.js";

const NOW = new Date("2026-06-01T12:00:00Z");

let db: Db;

beforeEach(() => {
  db = openMemoryDb();
  migrate(db);
});

afterEach(() => {
  vi.useRealTimers();
  if (db.open) db.close();
});

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function addDoc(n: number, updatedAt: Date) {
  createDocument(db, {
    id: id(n),
    original_name: `${n}.pdf`,
    mime: "application/pdf",
    size_bytes: 1,
    sha256: `sha-${n}`,
    storage_path: `${id(n)}.pdf`,
    status: "queued",
  });
  db.prepare("UPDATE documents SET updated_at = ? WHERE id = ?").run(
    updatedAt.toISOString(),
    id(n),
  );
}

const ago = (ms: number) => new Date(NOW.getTime() - ms);

function fakeQueue(failFor: string[] = []) {
  const calls: [string, number][] = [];
  const queue: JobQueue = {
    enqueue: (documentId, run) => {
      calls.push([documentId, run]);
      return failFor.includes(documentId)
        ? Promise.reject(new Error("redis is not ready"))
        : Promise.resolve();
    },
    ping: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  return { queue, calls };
}

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = {
    write: (chunk: string) => lines.push(JSON.parse(chunk) as Record<string, unknown>),
  };
  return { lines, logger: createLogger("api", "debug", stream) };
}

describe("startReconciler", () => {
  it("re-enqueues only stale queued rows, with their current run, on the first pass", async () => {
    addDoc(1, ago(5 * 60_000));
    addDoc(2, ago(10_000));
    addDoc(3, ago(2 * 60_000));
    transitionStatus(db, id(3), "processing", { from: "queued" });
    db.prepare("UPDATE documents SET updated_at = ? WHERE id = ?").run(
      ago(2 * 60_000).toISOString(),
      id(3),
    );
    addDoc(4, ago(3 * 60_000));
    db.prepare("UPDATE documents SET run = 3 WHERE id = ?").run(id(4));

    const { queue, calls } = fakeQueue();
    const { logger, lines } = capture();
    const reconciler = startReconciler({ db, queue, logger, clock: () => NOW });
    await vi.waitFor(() => expect(lines.some((l) => l.msg === "reconciler pass")).toBe(true));
    reconciler.stop();

    // Oldest first, as findStaleQueued orders them.
    expect(calls).toEqual([
      [id(1), 1],
      [id(4), 3],
    ]);
    expect(lines.find((l) => l.msg === "reconciler pass")).toMatchObject({
      stale: 2,
      enqueued: 2,
      failed: 0,
    });
  });

  it("counts failures, keeps going and never throws", async () => {
    addDoc(1, ago(5 * 60_000));
    addDoc(2, ago(4 * 60_000));
    const { queue, calls } = fakeQueue([id(1)]);
    const { logger } = capture();
    const reconciler = startReconciler({ db, queue, logger, clock: () => NOW });
    reconciler.stop();

    await expect(reconciler.runOnce()).resolves.toEqual({ stale: 2, enqueued: 1, failed: 1 });
    expect(calls.map(([doc]) => doc)).toContain(id(2));
  });

  it("logs and swallows an error from the database", async () => {
    const { queue } = fakeQueue();
    const { logger, lines } = capture();
    const reconciler = startReconciler({ db, queue, logger, clock: () => NOW });
    reconciler.stop();
    await vi.waitFor(() => expect(lines.length).toBeGreaterThan(0));
    db.close();

    await expect(reconciler.runOnce()).resolves.toBeUndefined();
    expect(lines.some((l) => l.msg === "reconciler pass failed")).toBe(true);
  });

  it("runs again on the interval until stopped", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { queue } = fakeQueue();
    const { logger, lines } = capture();
    const passes = () => lines.filter((l) => l.msg === "reconciler pass").length;

    const reconciler = startReconciler({ db, queue, logger, clock: () => NOW, intervalMs: 1000 });
    await vi.waitFor(() => expect(passes()).toBe(1));
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(passes()).toBe(2));
    reconciler.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(passes()).toBe(2);
  });
});
