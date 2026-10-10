import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractionResult } from "../schemas/extraction.js";
import { openMemoryDb, type Db } from "./client.js";
import { migrate } from "./migrations.js";
import {
  createDocument,
  findCompletedBySha256,
  findStaleQueued,
  getDocument,
  getExtraction,
  insertEvent,
  insertExtraction,
  listCompletedForExport,
  listDocuments,
  listEvents,
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

    expect(findCompletedBySha256(db, "same")?.id).toBe("newer");
    expect(findCompletedBySha256(db, "other")).toBeUndefined();
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
