import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnrecoverableError } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getDocument,
  getExtraction,
  listEvents,
  listFailedRuns,
  listRetrievalChunks,
  LlmError,
  transitionStatus,
  type ModelSelection,
} from "@nexus/shared/node";
import type { WorkerDeps } from "../deps.js";
import type { LlmProvider } from "../llm/types.js";
import { docId, makeDeps as makeBaseDeps, seedDocument } from "../test-support/fixtures.js";
import { makePdf } from "../test-support/pdf.js";
import { handleFinalFailure, processJob, type ExtractJob } from "./run.js";

// What a run that ends without a result does to the document: one that was completed before
// the run stays completed, whether the run came from a retry or a reanalysis. Only a document
// that never completed is failed.

const LINE = "The supplier shall provide the services described in this agreement";
const MOCK: ModelSelection = { provider: "mock", model: "mock" };
const GPT: ModelSelection = { provider: "openai", model: "gpt-5-mini" };
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "nexus-failed-runs-"));
  await writeFile(join(dir, `${docId(1)}.pdf`), await makePdf([[LINE], [LINE]]));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function job(data: unknown, attemptsMade = 0): ExtractJob {
  return { id: "job-1", data, attemptsMade, opts: { attempts: 3 } };
}

const failing = (err: Error): LlmProvider => ({
  name: "openai",
  model: "gpt-5-mini",
  complete: () => Promise.reject(err),
});

// A document that completed run 1 with the mock, through the real pipeline.
async function completedDocument(needsReviewExpected = true) {
  const { deps, lines } = makeBaseDeps({ UPLOAD_DIR: dir });
  const id = seedDocument(deps, { model: MOCK });
  await processJob(job({ documentId: id, run: 1, ...MOCK }), deps);
  const first = getDocument(deps.db, id);
  // The default mock quotes nothing, so the document needs review. That has to come back too.
  expect(first).toMatchObject({ status: "completed", needs_review: needsReviewExpected ? 1 : 0 });
  return { deps, lines, id, first };
}

// What POST /retry and POST /reanalyze both do to the row: a new run with a model.
function queueRun(deps: WorkerDeps, id: string, model: ModelSelection): void {
  const doc = getDocument(deps.db, id);
  if (!doc) throw new Error("no document");
  transitionStatus(deps.db, id, "queued", {
    from: doc.status,
    bumpRun: true,
    resetAttempts: true,
    needs_review: false,
    model,
  });
}

describe("a new run of a completed document that fails", () => {
  it("leaves the document completed with its previous extraction when the failure is permanent", async () => {
    const { deps, lines, id, first } = await completedDocument();
    const chunksBefore = listRetrievalChunks(deps.db, id);
    queueRun(deps, id, GPT);
    const provider = failing(new LlmError("auth", "Incorrect API key provided"));

    const err = await processJob(job({ documentId: id, run: 2, ...GPT }), {
      ...deps,
      providers: { get: () => provider },
    }).catch((e: unknown) => e);

    // Still no retries for a permanent failure.
    expect(err).toBeInstanceOf(UnrecoverableError);
    const doc = getDocument(deps.db, id);
    expect(doc).toMatchObject({
      status: "completed",
      stage: null,
      error_code: null,
      error_message: null,
      run: 2,
      // Back to what it was before the reanalysis reset it.
      needs_review: first?.needs_review,
      latest_extraction_id: first?.latest_extraction_id,
      fallback_needs_review: null,
      index_status: "indexed",
    });
    expect(getExtraction(deps.db, doc?.latest_extraction_id ?? "")).toMatchObject({
      run: 1,
      provider: "mock",
      model: "mock",
    });
    expect(deps.db.prepare("SELECT COUNT(*) AS n FROM extractions").get()).toEqual({ n: 1 });
    // The search index of the first run is untouched.
    expect(listRetrievalChunks(deps.db, id)).toEqual(chunksBefore);

    expect(listFailedRuns(deps.db, id)).toMatchObject([
      {
        run: 2,
        provider: "openai",
        model: "gpt-5-mini",
        prompt_version: "extract.v3",
        error_code: "LLM_AUTH",
        error_message: "Incorrect API key provided",
      },
    ]);
    expect(listEvents(deps.db, id).at(-1)).toMatchObject({
      run: 2,
      stage: "job",
      outcome: "error",
      message:
        "run 2 with openai / gpt-5-mini failed, the previous result is kept. LLM_AUTH: Incorrect API key provided",
    });
    expect(lines).toContainEqual(
      expect.objectContaining({
        level: 50,
        documentId: id,
        code: "LLM_AUTH",
        msg: "run failed, the document keeps its previous result",
      }),
    );
    expect(lines.some((line) => line.msg === "document failed")).toBe(false);
  });

  it("keeps the document processing while attempts are left, and completed after the last one", async () => {
    const { deps, id, first } = await completedDocument();
    queueRun(deps, id, GPT);
    const down = {
      ...deps,
      providers: { get: () => failing(new LlmError("unavailable", "down")) },
    };
    const payload = { documentId: id, run: 2, ...GPT };

    await expect(processJob(job(payload, 0), down)).rejects.toBeInstanceOf(LlmError);
    await expect(processJob(job(payload, 1), down)).rejects.toBeInstanceOf(LlmError);
    // Not decided yet: bullmq will try again, and the fallback is still on the row for it.
    expect(getDocument(deps.db, id)).toMatchObject({
      status: "processing",
      fallback_needs_review: first?.needs_review,
    });
    expect(listFailedRuns(deps.db, id)).toEqual([]);

    await expect(processJob(job(payload, 2), down)).rejects.toBeInstanceOf(LlmError);

    expect(getDocument(deps.db, id)).toMatchObject({
      status: "completed",
      error_code: null,
      latest_extraction_id: first?.latest_extraction_id,
      needs_review: first?.needs_review,
    });
    expect(listFailedRuns(deps.db, id)).toMatchObject([
      { run: 2, error_code: "LLM_UNAVAILABLE", error_message: "down" },
    ]);
  });

  it("stays completed when the worker dies twice on the reanalysis", async () => {
    const { deps, id, first } = await completedDocument();
    queueRun(deps, id, GPT);
    transitionStatus(deps.db, id, "processing", { from: "queued", bumpAttempts: true });

    const ended = handleFinalFailure(
      { id: "job-2", data: { documentId: id, run: 2, ...GPT }, finishedOn: 1 },
      new Error("job stalled more than allowable limit"),
      deps,
    );

    expect(ended).toBe(true);
    expect(getDocument(deps.db, id)).toMatchObject({
      status: "completed",
      error_code: null,
      latest_extraction_id: first?.latest_extraction_id,
    });
    expect(listFailedRuns(deps.db, id)).toMatchObject([
      { run: 2, provider: "openai", model: "gpt-5-mini", error_code: "WORKER_STOPPED" },
    ]);
    // One event for the run, not a second "document failed" style one.
    const errors = listEvents(deps.db, id).filter((e) => e.run === 2 && e.outcome === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("the previous result is kept. WORKER_STOPPED");
  });

  it("replaces the result as before when the reanalysis works", async () => {
    const { deps, id, first } = await completedDocument();
    queueRun(deps, id, { provider: "mock", model: "mock-alt" });

    await processJob(job({ documentId: id, run: 2, provider: "mock", model: "mock-alt" }), deps);

    const doc = getDocument(deps.db, id);
    expect(doc).toMatchObject({ status: "completed", run: 2, fallback_needs_review: null });
    expect(doc?.latest_extraction_id).not.toBe(first?.latest_extraction_id);
    expect(listFailedRuns(deps.db, id)).toEqual([]);
  });

  it("keeps a completed document that needs review completed when its retry fails", async () => {
    // Retry is offered for a completed document that needs review. The row a retry leaves is the
    // same as after a reanalysis: a new run that started from completed.
    const { deps, id, first } = await completedDocument();
    expect(first?.needs_review).toBe(1);
    queueRun(deps, id, MOCK);
    expect(getDocument(deps.db, id)).toMatchObject({
      status: "queued",
      needs_review: 0,
      fallback_needs_review: 1,
    });

    await processJob(job({ documentId: id, run: 2, ...MOCK }), {
      ...deps,
      providers: { get: () => failing(new LlmError("auth", "bad key")) },
    }).catch(() => undefined);

    expect(getDocument(deps.db, id)).toMatchObject({
      status: "completed",
      error_code: null,
      run: 2,
      // Still needs review, as before the retry, and still the first run's extraction.
      needs_review: 1,
      latest_extraction_id: first?.latest_extraction_id,
    });
    expect(listFailedRuns(deps.db, id)).toMatchObject([{ run: 2, error_code: "LLM_AUTH" }]);
    expect(listEvents(deps.db, id).at(-1)).toMatchObject({
      outcome: "error",
      message: "run 2 with mock / mock failed, the previous result is kept. LLM_AUTH: bad key",
    });
    // And it can be retried again: it is a completed document that needs review.
    queueRun(deps, id, MOCK);
    await processJob(job({ documentId: id, run: 3, ...MOCK }), deps);
    expect(getDocument(deps.db, id)).toMatchObject({ status: "completed", run: 3 });
  });

  it("the document can be reanalyzed again after a failed reanalysis", async () => {
    const { deps, id } = await completedDocument();
    queueRun(deps, id, GPT);
    await processJob(job({ documentId: id, run: 2, ...GPT }), {
      ...deps,
      providers: { get: () => failing(new LlmError("auth", "bad key")) },
    }).catch(() => undefined);
    queueRun(deps, id, { provider: "mock", model: "mock-alt" });

    await processJob(job({ documentId: id, run: 3, provider: "mock", model: "mock-alt" }), deps);

    const doc = getDocument(deps.db, id);
    expect(doc).toMatchObject({ status: "completed", run: 3 });
    expect(getExtraction(deps.db, doc?.latest_extraction_id ?? "")).toMatchObject({ run: 3 });
    expect(listFailedRuns(deps.db, id).map((r) => r.run)).toEqual([2]);
  });
});

describe("a run of a document that never completed", () => {
  it("fails a first run as before, and records it as a failed run", async () => {
    const { deps, lines } = makeBaseDeps({ UPLOAD_DIR: dir });
    const id = seedDocument(deps, { model: GPT });

    await expect(
      processJob(job({ documentId: id, run: 1, ...GPT }), {
        ...deps,
        providers: { get: () => failing(new LlmError("auth", "bad key")) },
      }),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(getDocument(deps.db, id)).toMatchObject({
      status: "failed",
      error_code: "LLM_AUTH",
      error_message: "bad key",
      latest_extraction_id: null,
    });
    expect(listFailedRuns(deps.db, id)).toMatchObject([
      { run: 1, provider: "openai", model: "gpt-5-mini", error_code: "LLM_AUTH" },
    ]);
    expect(lines).toContainEqual(expect.objectContaining({ level: 50, msg: "document failed" }));
  });

  it("fails the retry of a failed document as before", async () => {
    const { deps } = makeBaseDeps({ UPLOAD_DIR: dir });
    const id = seedDocument(deps, { model: GPT });
    const broken = { ...deps, providers: { get: () => failing(new LlmError("auth", "bad key")) } };
    await processJob(job({ documentId: id, run: 1, ...GPT }), broken).catch(() => undefined);
    expect(getDocument(deps.db, id)?.status).toBe("failed");
    // A new run of a document that is failed: there is no completed result to go back to.
    queueRun(deps, id, GPT);

    await processJob(job({ documentId: id, run: 2, ...GPT }), broken).catch(() => undefined);

    expect(getDocument(deps.db, id)).toMatchObject({
      status: "failed",
      run: 2,
      error_code: "LLM_AUTH",
      fallback_needs_review: null,
    });
    expect(listFailedRuns(deps.db, id).map((r) => r.run)).toEqual([2, 1]);
  });

  it("fails a reanalysis of a document that was already failed: there is nothing to keep", async () => {
    const { deps } = makeBaseDeps({ UPLOAD_DIR: dir });
    const id = seedDocument(deps, { model: GPT });
    const broken = { ...deps, providers: { get: () => failing(new LlmError("auth", "bad key")) } };
    await processJob(job({ documentId: id, run: 1, ...GPT }), broken).catch(() => undefined);
    queueRun(deps, id, GPT);

    await processJob(job({ documentId: id, run: 2, ...GPT }), broken).catch(() => undefined);

    expect(getDocument(deps.db, id)).toMatchObject({ status: "failed", run: 2 });
  });

  it("marks a stalled first run failed with its event, as before", () => {
    const { deps } = makeBaseDeps({ UPLOAD_DIR: dir });
    const id = seedDocument(deps);
    transitionStatus(deps.db, id, "processing", { from: "queued", bumpAttempts: true });

    const ended = handleFinalFailure(
      { id: "job-1", data: { documentId: id, run: 1 }, finishedOn: 1 },
      new Error("job stalled more than allowable limit"),
      deps,
    );

    expect(ended).toBe(true);
    expect(getDocument(deps.db, id)).toMatchObject({
      status: "failed",
      error_code: "WORKER_STOPPED",
    });
    expect(listEvents(deps.db, id).at(-1)).toMatchObject({
      outcome: "error",
      message: "WORKER_STOPPED: worker stopped while processing this document twice",
    });
    // A job from before models could be chosen: the failed run is recorded with the default.
    expect(listFailedRuns(deps.db, id)).toMatchObject([
      { run: 1, provider: "ollama", model: "qwen2.5:7b-instruct" },
    ]);
  });
});
