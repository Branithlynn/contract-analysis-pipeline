import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnrecoverableError } from "bullmq";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@nexus/shared";
import { getDocument, listEvents, transitionStatus } from "@nexus/shared/node";
import { docId, makeDeps as makeBaseDeps, seedDocument } from "../test-support/fixtures.js";
import { makePdf } from "../test-support/pdf.js";
import type * as analyzeModule from "./analyze.js";
import { analyzeDocument } from "./analyze.js";
import { PermanentError, TransientError } from "./errors.js";
import { processJob, type ExtractJob } from "./run.js";

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

  it("parses a real 2 page pdf and completes it with needs_review", async () => {
    const { deps } = makeDeps();
    const id = seedDocument(deps);

    await processJob(job({ documentId: id, run: 1 }), deps);

    expect(getDocument(deps.db, id)).toMatchObject({
      status: "completed",
      attempts: 1,
      needs_review: 1,
      stage: null,
      error_code: null,
    });
    expect(listEvents(deps.db, id)).toEqual([
      expect.objectContaining({ stage: "parsing", outcome: "ok" }),
      expect.objectContaining({ outcome: "info", message: "extraction not implemented yet" }),
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
    const { deps, id, thrown } = await failWith(err, 0, { attempts: 3 });

    expect(thrown).toBe(err);
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
