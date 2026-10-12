import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnrecoverableError } from "bullmq";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ErrorCode, ExtractionResultSchema } from "@nexus/shared";
import {
  getDocument,
  getExtraction,
  listEvents,
  listRetrievalChunks,
  LlmError,
  transitionStatus,
  type Embedder,
} from "@nexus/shared/node";
import { docId, makeDeps as makeBaseDeps, seedDocument } from "../test-support/fixtures.js";
import { makePdf } from "../test-support/pdf.js";
import type * as analyzeModule from "./analyze.js";
import { analyzeDocument } from "./analyze.js";
import { PermanentError, TransientError } from "./errors.js";
import { handleFinalFailure, processJob, type ExtractJob, type FailedJob } from "./run.js";

// Wraps the real analysis so the happy path parses real files, while failure tests can make it throw.
vi.mock("./analyze.js", async (importOriginal) => {
  const mod = await importOriginal<typeof analyzeModule>();
  return { ...mod, analyzeDocument: vi.fn(mod.analyzeDocument) };
});

const LINE = "The supplier shall provide the services described in this agreement";
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "nexus-run-"));
  // seedDocument stores docId(1) as "<id>.pdf".
  await writeFile(join(dir, `${docId(1)}.pdf`), await makePdf([[LINE], [LINE]]));
  await writeFile(join(dir, "blank.pdf"), await makePdf([[], []]));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const makeDeps = () => makeBaseDeps({ UPLOAD_DIR: dir });

function job(
  data: unknown,
  attemptsMade = 0,
  opts: ExtractJob["opts"] = { attempts: 3 },
): ExtractJob {
  return { id: "job-1", data, attemptsMade, opts };
}

describe("processJob", () => {
  it("rejects an invalid payload as unrecoverable", async () => {
    const { deps } = makeDeps();

    await expect(processJob(job({ documentId: "nope", run: 0 }), deps)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it("drops a job whose document does not exist", async () => {
    const { deps, lines } = makeDeps();

    await processJob(job({ documentId: docId(9), run: 1 }), deps);

    expect(lines.at(-1)).toMatchObject({ level: 40, documentId: docId(9) });
  });

  it("drops a stale job without touching the document", async () => {
    const { deps } = makeDeps();
    const id = seedDocument(deps);

    await processJob(job({ documentId: id, run: 2 }), deps);

    expect(getDocument(deps.db, id)).toMatchObject({ status: "queued", attempts: 0 });
    expect(listEvents(deps.db, id)).toEqual([]);
  });

  it("drops a job for a document that is already finished", async () => {
    const { deps } = makeDeps();
    const id = seedDocument(deps, { status: "completed" });

    await processJob(job({ documentId: id, run: 1 }), deps);

    expect(getDocument(deps.db, id)).toMatchObject({ status: "completed", attempts: 0 });
  });

  it("does nothing when it loses the claim: no analysis, no event, no extraction", async () => {
    const { deps, lines } = makeDeps();
    const id = seedDocument(deps);
    transitionStatus(deps.db, id, "processing", { from: "queued", bumpAttempts: true });
    transitionStatus(deps.db, id, "failed", {
      from: "processing",
      error_code: ErrorCode.PARSE_ERROR,
      error_message: "broken pdf",
    });
    const before = getDocument(deps.db, id);
    vi.mocked(analyzeDocument).mockClear();

    await expect(processJob(job({ documentId: id, run: 1 }), deps)).resolves.toBeUndefined();

    expect(analyzeDocument).not.toHaveBeenCalled();
    expect(getDocument(deps.db, id)).toEqual(before);
    expect(listEvents(deps.db, id)).toEqual([]);
    expect(deps.db.prepare("SELECT COUNT(*) AS n FROM extractions").get()).toEqual({ n: 0 });
    expect(lines.at(-1)).toMatchObject({ msg: "document already done, dropping job" });
  });

  it("indexes the document after the extraction and marks it indexed", async () => {
    const { deps, lines } = makeDeps();
    const id = seedDocument(deps);

    await processJob(job({ documentId: id, run: 1 }), deps);

    expect(getDocument(deps.db, id)).toMatchObject({
      status: "completed",
      stage: null,
      index_status: "indexed",
      index_error: null,
    });
    // One short line per page, so the two pages fit one chunk, from page 1 to page 2.
    const chunks = listRetrievalChunks(deps.db, id);
    expect(chunks).toMatchObject([
      {
        chunk_index: 0,
        page_start: 1,
        page_end: 2,
        embed_model: "mock",
        embed_dim: 64,
        injection_flagged: 0,
      },
    ]);
    expect(chunks[0]?.text).toContain(LINE);
    expect(lines).toContainEqual(
      expect.objectContaining({ msg: "document indexed", documentId: id, chunks: 1 }),
    );
    expect(lines.find((line) => line.msg === "document completed")).toMatchObject({
      indexStatus: "indexed",
    });
  });

  it("completes the document when indexing fails, with index_status failed and a warning", async () => {
    const { deps, lines } = makeDeps();
    const embedder: Embedder = {
      name: "ollama",
      model: "nomic-embed-text",
      embed: () => Promise.reject(new LlmError("unavailable", "Cannot reach Ollama")),
    };
    const id = seedDocument(deps);

    // A transient failure anywhere else makes processJob throw, so bullmq retries. Not here.
    await expect(
      processJob(job({ documentId: id, run: 1 }), { ...deps, embedder }),
    ).resolves.toBeUndefined();

    const doc = getDocument(deps.db, id);
    expect(doc).toMatchObject({
      status: "completed",
      stage: null,
      error_code: null,
      error_message: null,
      index_status: "failed",
      index_error: "LLM_UNAVAILABLE: Cannot reach Ollama",
    });
    // The extraction is stored and attached, exactly as without the failure.
    expect(getExtraction(deps.db, doc?.latest_extraction_id ?? "")).toMatchObject({
      document_id: id,
      run: 1,
    });
    expect(listRetrievalChunks(deps.db, id)).toEqual([]);
    expect(listEvents(deps.db, id)).toEqual([
      expect.objectContaining({ stage: "parsing", outcome: "ok" }),
      expect.objectContaining({ stage: "extracting", outcome: "ok" }),
      expect.objectContaining({ stage: "validating", outcome: "ok" }),
      expect.objectContaining({
        stage: "indexing",
        outcome: "error",
        message: "LLM_UNAVAILABLE: Cannot reach Ollama",
      }),
      expect.objectContaining({ stage: "job", outcome: "info" }),
    ]);
    expect(lines).toContainEqual(
      expect.objectContaining({
        level: 40,
        documentId: id,
        code: "LLM_UNAVAILABLE",
        msg: "indexing failed, the document completes without a search index",
      }),
    );
    expect(lines.some((line) => line.msg === "document failed")).toBe(false);
  });

  it("completes the document when indexing throws something that is no llm error", async () => {
    const { deps } = makeDeps();
    const embedder: Embedder = {
      name: "mock",
      model: "mock",
      embed: () => Promise.reject(new TypeError("boom")),
    };
    const id = seedDocument(deps);

    await processJob(job({ documentId: id, run: 1 }), { ...deps, embedder });

    expect(getDocument(deps.db, id)).toMatchObject({
      status: "completed",
      index_status: "failed",
      index_error: "INTERNAL: boom",
    });
  });

  it("indexes and clears the index error when the document is processed again", async () => {
    const { deps } = makeDeps();
    const failing: Embedder = {
      name: "mock",
      model: "mock",
      embed: () => Promise.reject(new LlmError("timeout", "too slow")),
    };
    const id = seedDocument(deps);
    await processJob(job({ documentId: id, run: 1 }), { ...deps, embedder: failing });
    expect(getDocument(deps.db, id)).toMatchObject({ index_status: "failed" });
    // What the retry endpoint does for a completed document that needs review.
    transitionStatus(deps.db, id, "queued", { from: "completed", bumpRun: true });

    await processJob(job({ documentId: id, run: 2 }), deps);

    expect(getDocument(deps.db, id)).toMatchObject({
      status: "completed",
      index_status: "indexed",
      index_error: null,
    });
    expect(listRetrievalChunks(deps.db, id)).toHaveLength(1);
  });

  it("analyzes a real 2 page pdf, stores the extraction and completes it", async () => {
    const { deps, lines } = makeDeps();
    const id = seedDocument(deps);

    await processJob(job({ documentId: id, run: 1 }), deps);

    // The raw reply is recorded per call for the evals, and must stay out of the worker's log.
    const completedLine = lines.find((line) => line.msg === "document completed");
    expect(completedLine?.calls).toEqual([expect.objectContaining({ kind: "extract", ok: true })]);
    expect(JSON.stringify(completedLine)).not.toContain("rawText");
    expect(getDocument(deps.db, id)).toMatchObject({
      status: "completed",
      attempts: 1,
      needs_review: 1,
      stage: null,
      error_code: null,
    });
    expect(listEvents(deps.db, id)).toEqual([
      expect.objectContaining({ stage: "parsing", outcome: "ok" }),
      expect.objectContaining({ stage: "extracting", outcome: "ok" }),
      expect.objectContaining({ stage: "validating", outcome: "ok" }),
      expect.objectContaining({ stage: "indexing", outcome: "ok" }),
      // The default mock finds nothing it can quote, so grounding is 0 and a person should look.
      expect.objectContaining({
        stage: "job",
        outcome: "info",
        message: "chunks=1 grounding=0.00 needs_review=true",
      }),
    ]);
    const extractionId = getDocument(deps.db, id)?.latest_extraction_id ?? "";
    const row = getExtraction(deps.db, extractionId);
    expect(row).toMatchObject({
      document_id: id,
      run: 1,
      provider: "mock",
      model: "mock",
      prompt_version: "extract.v3",
      grounding_score: 0,
      chunk_count: 1,
      output_tokens: 100,
    });
    expect(row?.input_tokens).toBeGreaterThan(0);
    const stored = ExtractionResultSchema.parse(JSON.parse(row?.result_json ?? "null"));
    expect(stored.summary).toBe("Mock extraction.");
    expect(stored.warnings).toEqual([
      "review: only 0% of quotes were found, below the 80% threshold",
    ]);
  });

  it("fails a pdf without text for good, with an error event on the parsing stage", async () => {
    const { deps } = makeDeps();
    const id = seedDocument(deps, { storage_path: "blank.pdf" });

    const thrown = await processJob(job({ documentId: id, run: 1 }), deps).catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(UnrecoverableError);
    expect(getDocument(deps.db, id)).toMatchObject({
      status: "failed",
      error_code: "NO_TEXT_LAYER",
    });
    expect(listEvents(deps.db, id)).toEqual([
      expect.objectContaining({
        stage: "parsing",
        outcome: "error",
        message: expect.stringMatching(/^NO_TEXT_LAYER: /) as unknown,
      }),
    ]);
  });

  it("logs the stack of a permanent failure once, on the error line", async () => {
    const { deps, lines } = makeDeps();
    const id = seedDocument(deps, { storage_path: "blank.pdf" });

    await processJob(job({ documentId: id, run: 1 }), deps).catch((e: unknown) => e);

    const problems = lines.filter((line) => (line.level as number) >= 40);
    expect(problems.map((line) => [line.level, line.msg])).toEqual([
      [40, "stage failed"],
      [50, "document failed"],
    ]);
    expect(problems[0]).toMatchObject({ documentId: id, stage: "parsing", code: "NO_TEXT_LAYER" });
    expect(problems[0]).not.toHaveProperty("err");
    expect(problems[1]).toMatchObject({
      documentId: id,
      code: "NO_TEXT_LAYER",
      err: { stack: expect.stringContaining("PermanentError") as unknown },
    });
  });

  it("fails a missing upload file for good as PARSE_ERROR", async () => {
    const { deps } = makeDeps();
    const id = seedDocument(deps, { storage_path: "gone.pdf" });

    await expect(processJob(job({ documentId: id, run: 1 }), deps)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(getDocument(deps.db, id)).toMatchObject({ status: "failed", error_code: "PARSE_ERROR" });
  });

  it("picks up a document that is still processing, which is what a stalled job redelivery looks like", async () => {
    const { deps } = makeDeps();
    const id = seedDocument(deps);
    transitionStatus(deps.db, id, "processing", { from: "queued", bumpAttempts: true });

    await processJob(job({ documentId: id, run: 1 }), deps);

    expect(getDocument(deps.db, id)).toMatchObject({ status: "completed", attempts: 2 });
  });
});

describe("processJob failures", () => {
  async function failWith(err: unknown, attemptsMade: number, opts: ExtractJob["opts"]) {
    const { deps, lines } = makeDeps();
    const id = seedDocument(deps);
    vi.mocked(analyzeDocument).mockRejectedValueOnce(err);
    const thrown = await processJob(job({ documentId: id, run: 1 }, attemptsMade, opts), deps).then(
      () => undefined,
      (e: unknown) => e,
    );
    return { deps, lines, id, thrown };
  }

  it("permanent: marks failed and throws UnrecoverableError", async () => {
    const { deps, id, thrown } = await failWith(
      new PermanentError(ErrorCode.PARSE_ERROR, "broken pdf"),
      0,
      { attempts: 3 },
    );

    expect(thrown).toBeInstanceOf(UnrecoverableError);
    expect(getDocument(deps.db, id)).toMatchObject({
      status: "failed",
      error_code: "PARSE_ERROR",
      error_message: "broken pdf",
      stage: null,
    });
  });

  it("transient on the last attempt: marks failed and rethrows the original", async () => {
    const err = new TransientError(ErrorCode.LLM_UNAVAILABLE, "ollama down");
    const { deps, id, thrown } = await failWith(err, 2, { attempts: 3 });

    expect(thrown).toBe(err);
    expect(getDocument(deps.db, id)).toMatchObject({
      status: "failed",
      error_code: "LLM_UNAVAILABLE",
    });
  });

  it("transient with attempts left: writes a retry event, rethrows and stays processing", async () => {
    const err = new Error("socket hang up");
    const { deps, lines, id, thrown } = await failWith(err, 0, { attempts: 3 });

    expect(thrown).toBe(err);
    expect(lines.find((line) => line.msg === "attempt failed, will retry")).toMatchObject({
      level: 40,
      err: {
        message: "socket hang up",
        stack: expect.stringContaining("socket hang up") as unknown,
      },
    });
    expect(getDocument(deps.db, id)).toMatchObject({ status: "processing", error_code: null });
    expect(listEvents(deps.db, id).at(-1)).toMatchObject({
      outcome: "retry",
      message: expect.stringContaining("attempt 2 of 3") as unknown,
    });
  });

  it("treats a missing attempts option as a single attempt", async () => {
    const { deps, id } = await failWith(new Error("boom"), 0, {});

    expect(getDocument(deps.db, id)?.status).toBe("failed");
  });
});

describe("handleFinalFailure", () => {
  const stalledError = new UnrecoverableError("job stalled more than allowable limit");

  function failedJob(run: number): FailedJob {
    return { id: "job-1", data: { documentId: docId(1), run }, finishedOn: Date.now() };
  }

  function processingDoc() {
    const made = makeDeps();
    const id = seedDocument(made.deps);
    transitionStatus(made.deps.db, id, "processing", { from: "queued", bumpAttempts: true });
    return { ...made, id };
  }

  it("fails a processing document whose job hit the stalled limit, with a code and an event", () => {
    const { deps, id } = processingDoc();

    expect(handleFinalFailure(failedJob(1), stalledError, deps)).toBe(true);

    expect(getDocument(deps.db, id)).toMatchObject({
      status: "failed",
      stage: null,
      error_code: ErrorCode.WORKER_STOPPED,
      error_message: "worker stopped while processing this document twice",
    });
    expect(listEvents(deps.db, id)).toEqual([
      expect.objectContaining({
        stage: "job",
        outcome: "error",
        message: "WORKER_STOPPED: worker stopped while processing this document twice",
      }),
    ]);
  });

  it("fails a still-processing document with INTERNAL for any other final failure", () => {
    const { deps, id } = processingDoc();

    expect(handleFinalFailure(failedJob(1), new Error("lock lost"), deps)).toBe(true);

    expect(getDocument(deps.db, id)).toMatchObject({
      status: "failed",
      error_code: ErrorCode.INTERNAL,
      error_message: "job failed outside the pipeline: lock lost",
    });
  });

  it("changes nothing for a stale run", () => {
    const { deps, id } = processingDoc();
    const before = getDocument(deps.db, id);

    expect(handleFinalFailure(failedJob(2), stalledError, deps)).toBe(false);

    expect(getDocument(deps.db, id)).toEqual(before);
    expect(listEvents(deps.db, id)).toEqual([]);
  });

  it("changes nothing when processJob already marked the document failed", () => {
    const { deps, id } = processingDoc();
    transitionStatus(deps.db, id, "failed", {
      from: "processing",
      error_code: ErrorCode.NO_TEXT_LAYER,
      error_message: "no text",
    });
    const before = getDocument(deps.db, id);

    expect(handleFinalFailure(failedJob(1), stalledError, deps)).toBe(false);

    expect(getDocument(deps.db, id)).toEqual(before);
    expect(listEvents(deps.db, id)).toEqual([]);
  });

  it("changes nothing for a failure bullmq will retry, or with no job", () => {
    const { deps, id } = processingDoc();

    // finishedOn is only set on a final failure.
    const willRetry: FailedJob = { id: "job-1", data: { documentId: docId(1), run: 1 } };
    expect(handleFinalFailure(willRetry, new Error("timeout"), deps)).toBe(false);
    expect(handleFinalFailure(undefined, stalledError, deps)).toBe(false);

    expect(getDocument(deps.db, id)).toMatchObject({ status: "processing", error_code: null });
  });
});
