import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DocumentDetailSchema, DocumentSummarySchema, type ExtractionResult } from "@nexus/shared";
import {
  createDocument,
  createLogger,
  insertEvent,
  insertExtraction,
  loadConfig,
  migrate,
  openMemoryDb,
  transitionStatus,
  type Db,
} from "@nexus/shared/node";
import { buildServer } from "../server.js";
import {
  addDays,
  docId as id,
  extractionResult as result,
  NOW,
  okQueue as queue,
} from "../test-support/fixtures.js";

let db: Db;
let seq = 0;

beforeEach(() => {
  db = openMemoryDb();
  migrate(db);
});

afterEach(() => {
  db.close();
});

// created_at comes from the clock, so rows are spaced out to make "newest first" deterministic.
function addDoc(n: number, name = `doc-${n}.pdf`) {
  createDocument(db, {
    id: id(n),
    original_name: name,
    mime: "application/pdf",
    size_bytes: 100,
    sha256: `sha-${n}-${seq++}`,
    storage_path: `${id(n)}.pdf`,
    status: "queued",
  });
}

function complete(n: number, stored: unknown) {
  transitionStatus(db, id(n), "processing", { from: "queued" });
  insertExtraction(db, {
    document_id: id(n),
    run: 1,
    provider: "mock",
    model: "mock-1",
    prompt_version: "v1",
    // Written as is, so a test can store something the schema rejects.
    result: stored as ExtractionResult,
    grounding_score: 0.9,
    chunk_count: 1,
    input_tokens: 10,
    output_tokens: 20,
    duration_ms: 30,
  });
  transitionStatus(db, id(n), "completed", { from: "processing" });
}

async function setup() {
  const lines: Record<string, unknown>[] = [];
  const stream = {
    write: (chunk: string) => lines.push(JSON.parse(chunk) as Record<string, unknown>),
  };
  const app = await buildServer({
    db,
    queue,
    config: loadConfig({}),
    logger: createLogger("api", "info", stream),
    clock: () => NOW,
  });
  return { app, lines };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("GET /api/documents", () => {
  it("lists summaries newest first with extraction fields mapped", async () => {
    addDoc(1);
    await sleep(5);
    addDoc(2);
    complete(2, result());
    const { app } = await setup();

    const res = await app.inject({ method: "GET", url: "/api/documents" });
    expect(res.statusCode).toBe(200);
    const list = DocumentSummarySchema.array().parse(res.json());
    expect(list.map((d) => d.id)).toEqual([id(2), id(1)]);
    expect(list[0]).toMatchObject({
      status: "completed",
      needs_review: false,
      vendor_name: "Acme Ltd",
      total_contract_value: { amount: 120000, currency: "USD" },
      expiration_date: "2027-01-01",
      notice_deadline: addDays(10),
      days_until_notice_deadline: 10,
      max_risk_severity: "high",
      risk_count: 3,
      grounding_score: 0.9,
    });
    expect(list[1]).toMatchObject({
      status: "queued",
      vendor_name: null,
      max_risk_severity: null,
      risk_count: null,
      days_until_notice_deadline: null,
    });
  });

  it("nulls the extraction fields of a row with a broken result and logs a warning", async () => {
    addDoc(1);
    complete(1, { not: "an extraction" });
    await sleep(5);
    addDoc(2);
    complete(2, result());
    const { app, lines } = await setup();

    const res = await app.inject({ method: "GET", url: "/api/documents" });
    expect(res.statusCode).toBe(200);
    const list = DocumentSummarySchema.array().parse(res.json());
    expect(list.find((d) => d.id === id(1))).toMatchObject({
      status: "completed",
      vendor_name: null,
      risk_count: null,
    });
    expect(list.find((d) => d.id === id(2))?.vendor_name).toBe("Acme Ltd");
    expect(
      lines.find((l) => l.msg === "stored extraction does not match the schema")?.documentId,
    ).toBe(id(1));
  });

  it("gives null max_risk_severity and 0 risk_count when there are no risk clauses", async () => {
    addDoc(1);
    complete(1, result({ risk_clauses: [] }));
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/api/documents" });
    expect(res.json()).toMatchObject([{ max_risk_severity: null, risk_count: 0 }]);
  });

  it("honours limit and validates it", async () => {
    addDoc(1);
    await sleep(5);
    addDoc(2);
    const { app } = await setup();

    const limited = await app.inject({ method: "GET", url: "/api/documents?limit=1" });
    expect(limited.json<unknown[]>()).toHaveLength(1);

    for (const bad of ["0", "201", "abc", "1.5"]) {
      const res = await app.inject({ method: "GET", url: `/api/documents?limit=${bad}` });
      expect(res.statusCode, `limit=${bad}`).toBe(400);
      expect(res.json<{ error: { code: string } }>().error.code).toBe("VALIDATION_ERROR");
    }
  });
});

describe("GET /api/documents/:id", () => {
  it("returns the detail with extraction, events and a fresh day count", async () => {
    addDoc(1);
    insertEvent(db, {
      document_id: id(1),
      run: 1,
      stage: "parsing",
      outcome: "ok",
      message: "parsed",
      duration_ms: 12,
    });
    complete(1, result());
    const { app } = await setup();

    const res = await app.inject({ method: "GET", url: `/api/documents/${id(1)}` });
    expect(res.statusCode).toBe(200);
    const detail = DocumentDetailSchema.parse(res.json());
    expect(detail).toMatchObject({
      id: id(1),
      mime: "application/pdf",
      size_bytes: 100,
      run: 1,
      attempts: 0,
      days_until_notice_deadline: 10,
      extraction: {
        provider: "mock",
        model: "mock-1",
        prompt_version: "v1",
        input_tokens: 10,
        output_tokens: 20,
        duration_ms: 30,
        chunk_count: 1,
      },
      events: [{ stage: "parsing", outcome: "ok", message: "parsed", duration_ms: 12 }],
    });
    expect(detail.extraction?.result.derived.days_until_notice_deadline).toBe(10);
  });

  it("returns extraction null when the stored result is broken", async () => {
    addDoc(1);
    complete(1, { broken: true });
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: `/api/documents/${id(1)}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ extraction: null, vendor_name: null });
  });

  it("404s an unknown id and 400s a non uuid", async () => {
    const { app } = await setup();
    const missing = await app.inject({ method: "GET", url: `/api/documents/${id(9)}` });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: { code: "NOT_FOUND", message: "Document not found" } });

    const bad = await app.inject({ method: "GET", url: "/api/documents/not-a-uuid" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json<{ error: { code: string } }>().error.code).toBe("VALIDATION_ERROR");
  });
});
