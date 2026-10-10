import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DocumentSummarySchema } from "@nexus/shared";
import {
  createDocument,
  createLogger,
  getDocument,
  listEvents,
  loadConfig,
  migrate,
  openMemoryDb,
  transitionStatus,
  type Db,
} from "@nexus/shared/node";
import type { JobQueue } from "../queue.js";
import { buildServer } from "../server.js";

const ID = "00000000-0000-4000-8000-000000000001";

let db: Db;

beforeEach(() => {
  db = openMemoryDb();
  migrate(db);
  createDocument(db, {
    id: ID,
    original_name: "a.pdf",
    mime: "application/pdf",
    size_bytes: 10,
    sha256: "sha",
    storage_path: `${ID}.pdf`,
    status: "queued",
  });
});

afterEach(() => {
  db.close();
});

function moveTo(state: "processing" | "failed" | "completed", needsReview = false) {
  transitionStatus(db, ID, "processing", { from: "queued", bumpAttempts: true });
  if (state === "failed") {
    transitionStatus(db, ID, "failed", {
      from: "processing",
      error_code: "LLM_UNAVAILABLE",
      error_message: "down",
      bumpAttempts: true,
    });
  }
  if (state === "completed") {
    transitionStatus(db, ID, "completed", { from: "processing", needs_review: needsReview });
  }
}

async function setup({ failEnqueue = false } = {}) {
  const calls: [string, number][] = [];
  const queue: JobQueue = {
    enqueue: (documentId, run) => {
      calls.push([documentId, run]);
      return failEnqueue ? Promise.reject(new Error("redis is not ready")) : Promise.resolve();
    },
    ping: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  const app = await buildServer({
    db,
    queue,
    config: loadConfig({}),
    logger: createLogger("api", "silent"),
    clock: () => new Date("2026-06-01T12:00:00Z"),
  });
  const retry = (id = ID) => app.inject({ method: "POST", url: `/api/documents/${id}/retry` });
  return { retry, calls };
}

describe("POST /api/documents/:id/retry", () => {
  it("requeues a failed document with a bumped run and reset attempts, then enqueues that run", async () => {
    moveTo("failed");
    const { retry, calls } = await setup();

    const res = await retry();
    expect(res.statusCode).toBe(202);
    expect(DocumentSummarySchema.parse(res.json())).toMatchObject({
      id: ID,
      status: "queued",
      error_code: null,
    });
    expect(getDocument(db, ID)).toMatchObject({
      status: "queued",
      run: 2,
      attempts: 0,
      error_code: null,
      error_message: null,
    });
    expect(calls).toEqual([[ID, 2]]);
  });

  it("requeues a completed document that needs review and clears the flag", async () => {
    moveTo("completed", true);
    const { retry, calls } = await setup();

    const res = await retry();
    expect(res.statusCode).toBe(202);
    expect(getDocument(db, ID)).toMatchObject({ status: "queued", run: 2, needs_review: 0 });
    expect(calls).toEqual([[ID, 2]]);
  });

  it.each([
    ["queued", () => undefined],
    ["processing", () => moveTo("processing")],
    ["completed without review", () => moveTo("completed", false)],
  ])("409s a %s document and leaves it alone", async (_label, arrange) => {
    arrange();
    const before = getDocument(db, ID);
    const { retry, calls } = await setup();

    const res = await retry();
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe("NOT_RETRYABLE");
    expect(getDocument(db, ID)).toEqual(before);
    expect(calls).toEqual([]);
  });

  it("still answers 202 and leaves the document queued with a retry event when enqueue throws", async () => {
    moveTo("failed");
    const { retry, calls } = await setup({ failEnqueue: true });

    const res = await retry();
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ id: ID, status: "queued" });
    expect(getDocument(db, ID)).toMatchObject({ status: "queued", run: 2, error_code: null });
    expect(calls).toEqual([[ID, 2]]);
    expect(listEvents(db, ID)).toMatchObject([
      {
        run: 2,
        stage: "queue",
        outcome: "retry",
        message: "queue unavailable, will retry automatically",
      },
    ]);
  });

  it("404s an unknown id and 400s a non uuid", async () => {
    const { retry } = await setup();
    expect((await retry("00000000-0000-4000-8000-000000000009")).statusCode).toBe(404);
    expect((await retry("nope")).statusCode).toBe(400);
  });
});
