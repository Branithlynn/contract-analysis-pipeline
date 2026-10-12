import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractionResult } from "../schemas/extraction.js";
import { openMemoryDb, type Db } from "./client.js";
import { migrate } from "./migrations.js";
import {
  createDocument,
  failRun,
  findCompletedBySha256,
  findStaleQueued,
  getDocument,
  getExtraction,
  getExtractionForRun,
  insertEvent,
  insertExtraction,
  listCompletedForExport,
  listDocuments,
  listEvents,
  listExtractionsForDocument,
  listFailedRuns,
  setIndexStatus,
  setStage,
  transitionStatus,
  type CreateDocumentInput,
} from "./repositories.js";

// The repo stores whatever it is given; shape is checked by the schema tests, not here.
const result = { summary: "test" } as unknown as ExtractionResult;

let db: Db;

function doc(id: string, overrides: Partial<CreateDocumentInput> = {}): CreateDocumentInput {
  return {
    id,
    original_name: `${id}.pdf`,
    mime: "application/pdf",
    size_bytes: 100,
    sha256: `sha-${id}`,
    storage_path: `${id}.pdf`,
    status: "queued",
    ...overrides,
  };
}

function extraction(documentId: string, run = 1) {
  return {
    document_id: documentId,
    run,
    provider: "mock",
    model: "mock-1",
    prompt_version: "v1",
    result,
    grounding_score: 0.9,
    chunk_count: 1,
    input_tokens: 10,
    output_tokens: 5,
    duration_ms: 42,
  };
}

// What extraction() stores, as the key the dedupe asks with.
const KEY = { provider: "mock", model: "mock-1", promptVersion: "v1" } as const;

function at(iso: string): void {
  vi.setSystemTime(new Date(iso));
}

beforeEach(() => {
  vi.useFakeTimers();
  at("2026-10-10T10:00:00.000Z");
  db = openMemoryDb();
  migrate(db);
});

afterEach(() => {
  db.close();
  vi.useRealTimers();
});

describe("createDocument / getDocument", () => {
  it("stores a queued document with defaults and iso timestamps", () => {
    createDocument(db, doc("a"));
    expect(getDocument(db, "a")).toMatchObject({
      id: "a",
      status: "queued",
      stage: null,
      needs_review: 0,
      attempts: 0,
      run: 1,
      duplicate_of: null,
      latest_extraction_id: null,
      created_at: "2026-10-10T10:00:00.000Z",
      updated_at: "2026-10-10T10:00:00.000Z",
    });
  });

  it("stores a completed duplicate pointing at the original and its extraction", () => {
    createDocument(db, doc("orig"));
    const extractionId = insertExtraction(db, extraction("orig"));
    createDocument(
      db,
      doc("dup", { status: "completed", duplicate_of: "orig", latest_extraction_id: extractionId }),
    );
    expect(getDocument(db, "dup")).toMatchObject({
      status: "completed",
      duplicate_of: "orig",
      latest_extraction_id: extractionId,
    });
  });

  it("returns undefined for an unknown id", () => {
    expect(getDocument(db, "nope")).toBeUndefined();
  });
});

describe("listDocuments", () => {
  it("returns newest first, respects the limit and joins the latest extraction", () => {
    createDocument(db, doc("old"));
    at("2026-10-10T11:00:00.000Z");
    createDocument(db, doc("mid"));
    at("2026-10-10T12:00:00.000Z");
    createDocument(db, doc("new"));
    insertExtraction(db, extraction("new", 1));
    const latest = insertExtraction(db, {
      ...extraction("new", 2),
      result: { summary: "second" } as unknown as ExtractionResult,
    });

    const rows = listDocuments(db, { limit: 2 });
    expect(rows.map((r) => r.id)).toEqual(["new", "mid"]);
    expect(rows[0]?.latest_extraction_id).toBe(latest);
    expect(JSON.parse(rows[0]?.result_json ?? "null")).toEqual({ summary: "second" });
    expect(rows[1]?.result_json).toBeNull();
  });
});

describe("listCompletedForExport", () => {
  it("returns completed documents newest first with the extraction's json, model and prompt version", () => {
    createDocument(db, doc("queued"));
    at("2026-10-10T11:00:00.000Z");
    createDocument(db, doc("older"));
    transitionStatus(db, "older", "processing", { from: "queued" });
    insertExtraction(db, extraction("older"));
    transitionStatus(db, "older", "completed", { from: "processing" });
    at("2026-10-10T12:00:00.000Z");
    const original = getDocument(db, "older");
    createDocument(db, {
      ...doc("dup"),
      status: "completed",
      duplicate_of: "older",
      latest_extraction_id: original?.latest_extraction_id ?? null,
    });

    const rows = listCompletedForExport(db);
    expect(rows.map((r) => r.id)).toEqual(["dup", "older"]);
    for (const row of rows) {
      expect(row).toMatchObject({ model: "mock-1", prompt_version: "v1" });
      expect(JSON.parse(row.result_json ?? "null")).toEqual({ summary: "test" });
    }
  });
});

describe("findCompletedBySha256", () => {
  it("returns the newest completed document that does not need review", () => {
    createDocument(db, doc("queued", { sha256: "same" }));
    at("2026-10-10T11:00:00.000Z");
    createDocument(db, doc("older", { sha256: "same", status: "completed" }));
    at("2026-10-10T12:00:00.000Z");
    createDocument(db, doc("newer", { sha256: "same", status: "completed" }));
    at("2026-10-10T13:00:00.000Z");
    createDocument(db, doc("review", { sha256: "same" }));
    transitionStatus(db, "review", "processing", { from: "queued" });
    transitionStatus(db, "review", "completed", { from: "processing", needs_review: true });

    for (const id of ["older", "newer", "review"]) insertExtraction(db, extraction(id));

    expect(findCompletedBySha256(db, "same", KEY)?.id).toBe("newer");
    expect(findCompletedBySha256(db, "other", KEY)).toBeUndefined();
  });
});

describe("findCompletedBySha256: the analysis key", () => {
  function completed(id: string, overrides: Partial<ReturnType<typeof extraction>> = {}) {
    createDocument(db, doc(id, { sha256: "same" }));
    transitionStatus(db, id, "processing", { from: "queued" });
    transitionStatus(db, id, "completed", { from: "processing" });
    return insertExtraction(db, { ...extraction(id), ...overrides });
  }

  it("only matches the same provider, model and prompt version", () => {
    completed("a");

    expect(findCompletedBySha256(db, "same", KEY)?.id).toBe("a");
    expect(findCompletedBySha256(db, "same", { ...KEY, model: "mock-2" })).toBeUndefined();
    expect(findCompletedBySha256(db, "same", { ...KEY, provider: "openai" })).toBeUndefined();
    expect(findCompletedBySha256(db, "same", { ...KEY, promptVersion: "v2" })).toBeUndefined();
  });

  it("picks the document analyzed with the asked model among several of the same file", () => {
    completed("a");
    at("2026-10-10T11:00:00.000Z");
    completed("b", { model: "mock-2" });

    expect(findCompletedBySha256(db, "same", KEY)?.id).toBe("a");
    expect(findCompletedBySha256(db, "same", { ...KEY, model: "mock-2" })?.id).toBe("b");
  });

  it("goes by a document's latest extraction, not by an older run", () => {
    completed("a");
    at("2026-10-10T11:00:00.000Z");
    insertExtraction(db, { ...extraction("a", 2), model: "mock-2" });

    expect(findCompletedBySha256(db, "same", KEY)).toBeUndefined();
    expect(findCompletedBySha256(db, "same", { ...KEY, model: "mock-2" })?.id).toBe("a");
  });

  it("does not match a completed document that has no extraction", () => {
    createDocument(db, doc("a", { sha256: "same", status: "completed" }));

    expect(findCompletedBySha256(db, "same", KEY)).toBeUndefined();
  });
});

describe("the model of a document run", () => {
  it("is stored when the document is created, and null when none is given", () => {
    createDocument(db, doc("a", { model: { provider: "openai", model: "gpt-5-mini" } }));
    createDocument(db, doc("b"));

    expect(getDocument(db, "a")).toMatchObject({ llm_provider: "openai", llm_model: "gpt-5-mini" });
    expect(getDocument(db, "b")).toMatchObject({ llm_provider: null, llm_model: null });
  });

  it("changes together with the status when a new run is queued", () => {
    createDocument(db, doc("a", { model: { provider: "ollama", model: "qwen2.5:7b-instruct" } }));
    transitionStatus(db, "a", "processing", { from: "queued" });
    transitionStatus(db, "a", "completed", { from: "processing" });

    const moved = transitionStatus(db, "a", "queued", {
      from: "completed",
      bumpRun: true,
      model: { provider: "mock", model: "mock-alt" },
    });

    expect(moved).toBe(true);
    expect(getDocument(db, "a")).toMatchObject({
      status: "queued",
      run: 2,
      llm_provider: "mock",
      llm_model: "mock-alt",
    });
  });

  it("stays as it was when the transition does not match or names no model", () => {
    createDocument(db, doc("a", { model: { provider: "ollama", model: "qwen2.5:7b-instruct" } }));

    // The document is queued, not completed: nothing matches, nothing changes.
    expect(
      transitionStatus(db, "a", "queued", {
        from: "completed",
        model: { provider: "mock", model: "mock" },
      }),
    ).toBe(false);
    transitionStatus(db, "a", "processing", { from: "queued" });

    expect(getDocument(db, "a")).toMatchObject({
      llm_provider: "ollama",
      llm_model: "qwen2.5:7b-instruct",
    });
  });

  it("can only be set on the way to queued", () => {
    createDocument(db, doc("a"));

    expect(() =>
      transitionStatus(db, "a", "processing", {
        from: "queued",
        model: { provider: "mock", model: "mock" },
      }),
    ).toThrow(/only be set when moving to queued/);
  });
});

describe("failRun", () => {
  const input = (run = 1) => ({
    documentId: "a",
    run,
    model: { provider: "openai", model: "gpt-5-mini" } as const,
    promptVersion: "v1",
    code: "LLM_AUTH" as const,
    message: "bad key",
  });

  // A document that completed run 1, then got a new run queued and claimed by a worker.
  function secondRunOfCompleted(needsReview: boolean): string {
    createDocument(db, doc("a"));
    transitionStatus(db, "a", "processing", { from: "queued" });
    transitionStatus(db, "a", "completed", { from: "processing", needs_review: needsReview });
    const extractionId = insertExtraction(db, extraction("a"));
    // What retry and reanalyze both do.
    transitionStatus(db, "a", "queued", { from: "completed", bumpRun: true, needs_review: false });
    transitionStatus(db, "a", "processing", { from: "queued", stage: "extracting" });
    return extractionId;
  }

  it("fails a document that never completed and records the run", () => {
    createDocument(db, doc("a"));
    transitionStatus(db, "a", "processing", { from: "queued" });

    expect(failRun(db, input())).toBe("failed");

    expect(getDocument(db, "a")).toMatchObject({
      status: "failed",
      error_code: "LLM_AUTH",
      error_message: "bad key",
    });
    expect(listFailedRuns(db, "a")).toMatchObject([
      {
        run: 1,
        provider: "openai",
        model: "gpt-5-mini",
        prompt_version: "v1",
        error_code: "LLM_AUTH",
      },
    ]);
    expect(listEvents(db, "a")).toEqual([]);
  });

  it("puts a document that was completed back to completed with its extraction and review state", () => {
    const extractionId = secondRunOfCompleted(true);

    expect(failRun(db, input(2))).toBe("kept_completed");

    expect(getDocument(db, "a")).toMatchObject({
      status: "completed",
      stage: null,
      needs_review: 1,
      error_code: null,
      error_message: null,
      latest_extraction_id: extractionId,
      fallback_needs_review: null,
      run: 2,
    });
    expect(listFailedRuns(db, "a")).toMatchObject([{ run: 2, error_code: "LLM_AUTH" }]);
    expect(listEvents(db, "a")).toMatchObject([
      {
        run: 2,
        stage: "job",
        outcome: "error",
        message:
          "run 2 with openai / gpt-5-mini failed, the previous result is kept. LLM_AUTH: bad key",
      },
    ]);
  });

  it("restores needs_review false as false", () => {
    secondRunOfCompleted(false);
    expect(getDocument(db, "a")?.fallback_needs_review).toBe(0);

    expect(failRun(db, input(2))).toBe("kept_completed");
    expect(getDocument(db, "a")).toMatchObject({ status: "completed", needs_review: 0 });
  });

  it("fails the retry of a document that failed before: it never completed", () => {
    createDocument(db, doc("a"));
    transitionStatus(db, "a", "processing", { from: "queued" });
    failRun(db, input());
    transitionStatus(db, "a", "queued", { from: "failed", bumpRun: true });
    transitionStatus(db, "a", "processing", { from: "queued" });

    expect(failRun(db, input(2))).toBe("failed");

    expect(getDocument(db, "a")).toMatchObject({ status: "failed", run: 2 });
    expect(listFailedRuns(db, "a").map((r) => r.run)).toEqual([2, 1]);
  });

  it("does nothing when the document is not processing that run any more", () => {
    createDocument(db, doc("a"));
    // Still queued.
    expect(failRun(db, input())).toBe("skipped");
    transitionStatus(db, "a", "processing", { from: "queued" });
    // Another run.
    expect(failRun(db, input(2))).toBe("skipped");
    expect(failRun(db, { ...input(), documentId: "missing" })).toBe("skipped");

    expect(getDocument(db, "a")).toMatchObject({ status: "processing", error_code: null });
    expect(listFailedRuns(db, "a")).toEqual([]);
  });

  it("keeps a long provider error out of the timeline beyond 500 characters", () => {
    secondRunOfCompleted(false);

    failRun(db, { ...input(2), message: "x".repeat(2000) });

    expect(listEvents(db, "a")[0]?.message).toHaveLength(500);
    // The full message is on the failed run.
    expect(listFailedRuns(db, "a")[0]?.error_message).toHaveLength(2000);
  });
});

describe("the fallback of a run", () => {
  function completed(needsReview: boolean): void {
    createDocument(db, doc("a"));
    transitionStatus(db, "a", "processing", { from: "queued" });
    transitionStatus(db, "a", "completed", { from: "processing", needs_review: needsReview });
  }

  it("is set by every new run of a completed document, to the needs_review it had", () => {
    completed(true);

    // needs_review is reset for the new run in the same update. The fallback keeps the old value.
    transitionStatus(db, "a", "queued", { from: "completed", needs_review: false });

    expect(getDocument(db, "a")).toMatchObject({ needs_review: 0, fallback_needs_review: 1 });
  });

  it("is 0, not null, for a completed document that did not need review", () => {
    completed(false);
    transitionStatus(db, "a", "queued", { from: "completed" });

    expect(getDocument(db, "a")?.fallback_needs_review).toBe(0);
  });

  it("is not set for the first run or for a new run of a failed document", () => {
    createDocument(db, doc("a"));
    expect(getDocument(db, "a")?.fallback_needs_review).toBeNull();
    transitionStatus(db, "a", "processing", { from: "queued" });
    transitionStatus(db, "a", "failed", { from: "processing", error_code: "INTERNAL" });

    transitionStatus(db, "a", "queued", { from: "failed", bumpRun: true });

    expect(getDocument(db, "a")?.fallback_needs_review).toBeNull();
  });

  it("stays while the run is claimed and is cleared when the run finishes either way", () => {
    completed(true);
    transitionStatus(db, "a", "queued", { from: "completed" });
    // Claiming the job keeps it, also when a stalled job is delivered again.
    transitionStatus(db, "a", "processing", { from: "queued" });
    transitionStatus(db, "a", "processing", { from: "processing" });
    expect(getDocument(db, "a")?.fallback_needs_review).toBe(1);

    transitionStatus(db, "a", "completed", { from: "processing" });
    expect(getDocument(db, "a")?.fallback_needs_review).toBeNull();

    transitionStatus(db, "a", "queued", { from: "completed" });
    transitionStatus(db, "a", "processing", { from: "queued" });
    transitionStatus(db, "a", "failed", { from: "processing", error_code: "INTERNAL" });
    expect(getDocument(db, "a")?.fallback_needs_review).toBeNull();
  });
});

describe("listExtractionsForDocument / getExtractionForRun", () => {
  it("lists every run of a document newest first, and finds one by its run", () => {
    createDocument(db, doc("a"));
    createDocument(db, doc("other"));
    const first = insertExtraction(db, extraction("a", 1));
    at("2026-10-10T11:00:00.000Z");
    const second = insertExtraction(db, { ...extraction("a", 2), provider: "openai" });
    insertExtraction(db, extraction("other", 1));

    expect(listExtractionsForDocument(db, "a", second).map((e) => e.id)).toEqual([second, first]);
    expect(getExtractionForRun(db, "a", 1)?.id).toBe(first);
    expect(getExtractionForRun(db, "a", 2)).toMatchObject({ id: second, provider: "openai" });
    expect(getExtractionForRun(db, "a", 3)).toBeUndefined();
  });

  it("lists the reused extraction for a duplicate that has none of its own", () => {
    createDocument(db, doc("original"));
    const extractionId = insertExtraction(db, extraction("original"));
    createDocument(
      db,
      doc("copy", {
        status: "completed",
        duplicate_of: "original",
        latest_extraction_id: extractionId,
      }),
    );

    expect(listExtractionsForDocument(db, "copy", extractionId).map((e) => e.id)).toEqual([
      extractionId,
    ]);
    expect(listExtractionsForDocument(db, "copy", null)).toEqual([]);
  });
});

describe("findStaleQueued", () => {
  it("returns queued documents last updated before the cutoff", () => {
    createDocument(db, doc("stale"));
    createDocument(db, doc("stale-but-processing"));
    transitionStatus(db, "stale-but-processing", "processing", { from: "queued" });
    at("2026-10-10T11:00:00.000Z");
    createDocument(db, doc("fresh"));

    expect(findStaleQueued(db, "2026-10-10T10:30:00.000Z").map((r) => r.id)).toEqual(["stale"]);
  });
});

describe("transitionStatus", () => {
  it("throws on a pair that is not in ALLOWED_TRANSITIONS", () => {
    createDocument(db, doc("a"));
    expect(() => transitionStatus(db, "a", "completed", { from: "queued" })).toThrow(
      /queued -> completed/,
    );
  });

  it("only one of two racing transitions wins", () => {
    createDocument(db, doc("a"));
    expect(transitionStatus(db, "a", "processing", { from: "queued" })).toBe(true);
    expect(transitionStatus(db, "a", "failed", { from: "queued" })).toBe(false);
    expect(getDocument(db, "a")?.status).toBe("processing");
  });

  it("accepts several from statuses", () => {
    createDocument(db, doc("a"));
    expect(transitionStatus(db, "a", "processing", { from: ["queued", "processing"] })).toBe(true);
    expect(transitionStatus(db, "a", "processing", { from: ["queued", "processing"] })).toBe(true);
  });

  it("returns false for an unknown id", () => {
    expect(transitionStatus(db, "nope", "processing", { from: "queued" })).toBe(false);
  });

  it("sets stage, error fields, needs_review and bumps attempts", () => {
    createDocument(db, doc("a"));
    at("2026-10-10T11:00:00.000Z");
    transitionStatus(db, "a", "processing", {
      from: "queued",
      stage: "parsing",
      bumpAttempts: true,
    });
    transitionStatus(db, "a", "failed", {
      from: "processing",
      error_code: "PARSE_ERROR",
      error_message: "bad pdf",
      needs_review: true,
    });
    expect(getDocument(db, "a")).toMatchObject({
      status: "failed",
      stage: null,
      error_code: "PARSE_ERROR",
      error_message: "bad pdf",
      needs_review: 1,
      attempts: 1,
      updated_at: "2026-10-10T11:00:00.000Z",
    });
  });

  it("retry to queued clears errors, bumps run and resets attempts", () => {
    createDocument(db, doc("a"));
    transitionStatus(db, "a", "processing", {
      from: "queued",
      stage: "extracting",
      bumpAttempts: true,
    });
    transitionStatus(db, "a", "failed", {
      from: "processing",
      error_code: "LLM_UNAVAILABLE",
      error_message: "down",
    });
    expect(
      transitionStatus(db, "a", "queued", {
        from: ["completed", "failed"],
        bumpRun: true,
        resetAttempts: true,
      }),
    ).toBe(true);
    expect(getDocument(db, "a")).toMatchObject({
      status: "queued",
      error_code: null,
      error_message: null,
      run: 2,
      attempts: 0,
    });
  });

  it("completed nulls the stage and clears errors", () => {
    createDocument(db, doc("a"));
    transitionStatus(db, "a", "processing", {
      from: "queued",
      stage: "validating",
      error_message: "transient",
    });
    transitionStatus(db, "a", "completed", { from: "processing" });
    expect(getDocument(db, "a")).toMatchObject({
      stage: null,
      error_code: null,
      error_message: null,
    });
  });

  it("throws on contradictory options", () => {
    createDocument(db, doc("a"));
    expect(() =>
      transitionStatus(db, "a", "processing", {
        from: "queued",
        bumpAttempts: true,
        resetAttempts: true,
      }),
    ).toThrow();
  });
});

describe("setStage", () => {
  it("updates the stage of a processing document only", () => {
    createDocument(db, doc("a"));
    expect(setStage(db, "a", "parsing")).toBe(false);
    transitionStatus(db, "a", "processing", { from: "queued" });
    expect(setStage(db, "a", "extracting")).toBe(true);
    expect(getDocument(db, "a")?.stage).toBe("extracting");
  });
});

describe("setIndexStatus", () => {
  it("starts as null and stores failed with its reason", () => {
    createDocument(db, doc("a"));
    expect(getDocument(db, "a")).toMatchObject({ index_status: null, index_error: null });

    expect(setIndexStatus(db, "a", "failed", "LLM_UNAVAILABLE: Cannot reach Ollama")).toBe(true);

    expect(getDocument(db, "a")).toMatchObject({
      index_status: "failed",
      index_error: "LLM_UNAVAILABLE: Cannot reach Ollama",
    });
  });

  it("clears the reason when the document gets indexed, and leaves status and updated_at alone", () => {
    createDocument(db, doc("a"));
    setIndexStatus(db, "a", "failed", "boom");
    const before = getDocument(db, "a");
    at("2026-10-11T10:00:00.000Z");

    expect(setIndexStatus(db, "a", "indexed")).toBe(true);

    expect(getDocument(db, "a")).toEqual({ ...before, index_status: "indexed", index_error: null });
  });

  it("refuses an error on an indexed document and reports an unknown id", () => {
    createDocument(db, doc("a"));
    expect(() => setIndexStatus(db, "a", "indexed", "boom")).toThrow(/cannot carry/);
    expect(setIndexStatus(db, "missing", "indexed")).toBe(false);
  });
});

describe("extractions", () => {
  it("inserts every run and points the document at the latest one", () => {
    createDocument(db, doc("a"));
    const first = insertExtraction(db, extraction("a", 1));
    const second = insertExtraction(db, extraction("a", 2));
    expect(first).not.toBe(second);
    expect(getDocument(db, "a")?.latest_extraction_id).toBe(second);
    expect(getExtraction(db, first)).toMatchObject({ document_id: "a", run: 1, input_tokens: 10 });
    expect(JSON.parse(getExtraction(db, second)?.result_json ?? "null")).toEqual({
      summary: "test",
    });
  });

  it("rolls back the insert when the document does not exist", () => {
    expect(() => insertExtraction(db, extraction("missing"))).toThrow(/FOREIGN KEY/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM extractions").get()).toEqual({ n: 0 });
  });

  it("keeps neither the row nor the pointer when pointing the document at it fails", () => {
    createDocument(db, doc("a"));
    const first = insertExtraction(db, extraction("a", 1));
    // The foreign key test above fails on the insert itself. This fails the second statement, after
    // the insert went through, which is the case the transaction exists for.
    db.exec(
      `CREATE TRIGGER fail_pointer BEFORE UPDATE OF latest_extraction_id ON documents
       BEGIN SELECT RAISE(ABORT, 'pointer update failed'); END`,
    );

    expect(() => insertExtraction(db, extraction("a", 2))).toThrow(/pointer update failed/);

    expect(db.prepare("SELECT run FROM extractions").all()).toEqual([{ run: 1 }]);
    expect(getDocument(db, "a")?.latest_extraction_id).toBe(first);
  });
});

describe("events", () => {
  it("lists events of a document in insert order", () => {
    createDocument(db, doc("a"));
    createDocument(db, doc("b"));
    insertEvent(db, {
      document_id: "a",
      run: 1,
      stage: "queued",
      outcome: "info",
      message: "enqueued",
    });
    insertEvent(db, {
      document_id: "b",
      run: 1,
      stage: "parsing",
      outcome: "ok",
      message: "other doc",
    });
    insertEvent(db, {
      document_id: "a",
      run: 1,
      stage: "parsing",
      outcome: "ok",
      message: "parsed",
      duration_ms: 12,
    });

    const events = listEvents(db, "a");
    expect(events.map((e) => e.message)).toEqual(["enqueued", "parsed"]);
    expect(events[0]?.duration_ms).toBeNull();
    expect(events[1]).toMatchObject({ duration_ms: 12, created_at: "2026-10-10T10:00:00.000Z" });
  });
});
