import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DocumentDetailSchema, DocumentSummarySchema, type ExtractionResult } from "@nexus/shared";
import {
  createDocument,
  createLogger,
  insertEvent,
  getExtraction,
  insertExtraction,
  loadConfig,
  migrate,
  openMemoryDb,
  setIndexStatus,
  transitionStatus,
  MockEmbedder,
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

function complete(n: number, stored: unknown): string {
  transitionStatus(db, id(n), "processing", { from: "queued" });
  const extractionId = insertExtraction(db, {
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
  return extractionId;
}

async function setup(now = NOW) {
  const lines: Record<string, unknown>[] = [];
  const stream = {
    write: (chunk: string) => lines.push(JSON.parse(chunk) as Record<string, unknown>),
  };
  const app = await buildServer({
    db,
    queue,
    config: loadConfig({}),
    logger: createLogger("api", "info", stream),
    embedder: new MockEmbedder(),
    clock: () => now,
  });
  return { app, lines };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("index_status", () => {
  it("is in the list and in the detail: null, indexed or failed", async () => {
    addDoc(1);
    addDoc(2);
    complete(2, result());
    setIndexStatus(db, id(2), "indexed");
    addDoc(3);
    complete(3, result());
    setIndexStatus(db, id(3), "failed", "LLM_UNAVAILABLE: Cannot reach Ollama");
    const { app } = await setup();

    const res = await app.inject({ method: "GET", url: "/api/documents" });
    const list = DocumentSummarySchema.array().parse(res.json());
    const byId = new Map(list.map((d) => [d.id, d.index_status]));
    expect(byId).toEqual(
      new Map([
        [id(1), null],
        [id(2), "indexed"],
        [id(3), "failed"],
      ]),
    );

    const detail = await app.inject({ method: "GET", url: `/api/documents/${id(3)}` });
    // A failed index does not make the document failed.
    expect(DocumentDetailSchema.parse(detail.json())).toMatchObject({
      status: "completed",
      error_code: null,
      index_status: "failed",
    });
  });
});

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
      expiration_date: "2026-07-11",
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
    const extractionId = complete(1, result());
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
    // The time the extraction row was written, not the document's updated_at.
    const stored = getExtraction(db, extractionId);
    expect(stored).toBeDefined();
    expect(detail.extraction?.created_at).toBe(stored?.created_at);
  });

  it("recomputes the derived block from the facts, so a year later the term has rolled", async () => {
    addDoc(1);
    complete(1, result());
    const today = await setup();
    // A year and 24 days on: the 2026-07-11 term has renewed to 2027-07-11 and its deadline is gone.
    const later = await setup(new Date("2027-06-25T08:00:00Z"));

    const read = async (app: typeof today.app) => {
      const res = await app.inject({ method: "GET", url: `/api/documents/${id(1)}` });
      return DocumentDetailSchema.parse(res.json());
    };
    const now = await read(today.app);
    const nextYear = await read(later.app);

    expect(now.extraction?.result.derived).toMatchObject({
      current_term_end: "2026-07-11",
      next_renewal_date: "2026-07-12",
      notice_deadline: "2026-06-11",
      days_until_notice_deadline: 10,
    });
    expect(now.extraction?.result.derived.alerts.map((a) => a.code)).toEqual([
      "notice_deadline_soon",
      "high_risk",
    ]);
    expect(nextYear).toMatchObject({
      notice_deadline: "2027-06-11",
      days_until_notice_deadline: -14,
    });
    expect(nextYear.extraction?.result.derived).toMatchObject({
      expiration_date: "2026-07-11",
      current_term_end: "2027-07-11",
      next_renewal_date: "2027-07-12",
      notice_deadline: "2027-06-11",
      days_until_notice_deadline: -14,
    });
    expect(nextYear.extraction?.result.derived.alerts).toEqual([
      {
        level: "critical",
        code: "notice_deadline_passed",
        message: "Notice deadline 2027-06-11 has passed. Contract renews on 2027-07-12.",
      },
      { level: "warning", code: "high_risk", message: "1 high-severity risk clause(s)." },
    ]);
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
