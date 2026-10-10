import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtractionResult } from "@nexus/shared";
import {
  createDocument,
  createLogger,
  getDocument,
  insertExtraction,
  loadConfig,
  migrate,
  openMemoryDb,
  transitionStatus,
  type Db,
} from "@nexus/shared/node";
import { buildServer } from "../server.js";
import { EXPORT_COLUMNS } from "../services/export.js";
import { clause, docId, extractionResult, field, NOW, okQueue } from "../test-support/fixtures.js";

let db: Db;

beforeEach(() => {
  db = openMemoryDb();
  migrate(db);
});

afterEach(() => {
  db.close();
});

function addDoc(n: number, name: string) {
  createDocument(db, {
    id: docId(n),
    original_name: name,
    mime: "application/pdf",
    size_bytes: 1,
    sha256: `sha-${n}`,
    storage_path: `${docId(n)}.pdf`,
    status: "queued",
  });
}

function complete(n: number, stored: unknown) {
  transitionStatus(db, docId(n), "processing", { from: "queued" });
  insertExtraction(db, {
    document_id: docId(n),
    run: 1,
    provider: "mock",
    model: "mock-1",
    prompt_version: "v1",
    result: stored as ExtractionResult,
    grounding_score: 0.9,
    chunk_count: 1,
    input_tokens: 0,
    output_tokens: 0,
    duration_ms: 1,
  });
  transitionStatus(db, docId(n), "completed", { from: "processing" });
}

// Splits our own output back into rows. Good enough for these values: no quoted line breaks.
function parse(body: string): string[][] {
  return body
    .replace(/^﻿/, "")
    .split("\r\n")
    .filter((line) => line !== "")
    .map((line) => {
      const cells: string[] = [];
      for (const match of line.matchAll(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)) {
        const raw = match[1] ?? "";
        cells.push(raw.startsWith('"') ? raw.slice(1, -1).replaceAll('""', '"') : raw);
        if (match[2] === "") break;
      }
      return cells;
    });
}

async function exportCsv() {
  const app = await buildServer({
    db,
    queue: okQueue,
    config: loadConfig({}),
    logger: createLogger("api", "silent"),
    clock: () => NOW,
  });
  return app.inject({ method: "GET", url: "/api/documents/export.csv" });
}

describe("GET /api/documents/export.csv", () => {
  it("sends completed documents only, as a dated utf-8 csv attachment", async () => {
    addDoc(1, "queued.pdf");
    addDoc(2, "done.pdf");
    complete(2, extractionResult());

    const res = await exportCsv();
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="contracts-2026-06-01.csv"',
    );
    expect(res.body.startsWith("﻿")).toBe(true);

    const [header, ...rows] = parse(res.body);
    expect(header).toEqual([...EXPORT_COLUMNS]);
    expect(rows).toHaveLength(1);
    const row = Object.fromEntries(EXPORT_COLUMNS.map((c, i) => [c, rows[0]?.[i]]));
    expect(row).toEqual({
      id: docId(2),
      file: "done.pdf",
      status: "completed",
      needs_review: "false",
      vendor: "Acme Ltd",
      customer: "Nexus Corp",
      document_type: "contract",
      effective_date: "2026-01-01",
      expiration_date: "2027-01-01",
      expiration_source: "stated",
      notice_deadline: "2026-06-11",
      days_until_notice_deadline: "10",
      auto_renewal: "true",
      total_value: "120000",
      currency: "USD",
      payment_terms: "net 30",
      governing_law: "England",
      high_risks: "1",
      medium_risks: "1",
      low_risks: "1",
      grounding_score: "0.9",
      model: "mock-1",
      prompt_version: "v1",
    });
  });

  it("neutralises formula injection and quotes per rfc 4180", async () => {
    addDoc(1, "=cmd.pdf");
    complete(
      1,
      extractionResult({
        vendor_name: field('=HYPERLINK("http://evil","click")'),
        customer_name: field("Nexus, Corp"),
        risk_clauses: [clause("high"), clause("high")],
      }),
    );

    const res = await exportCsv();
    expect(res.body).toContain('"\'=HYPERLINK(""http://evil"",""click"")"');
    expect(res.body).toContain('"Nexus, Corp"');
    const [, row] = parse(res.body);
    expect(row?.[EXPORT_COLUMNS.indexOf("file")]).toBe("'=cmd.pdf");
    expect(row?.[EXPORT_COLUMNS.indexOf("high_risks")]).toBe("2");
  });

  it("keeps a row with a broken result, with only the document columns filled", async () => {
    addDoc(1, "broken.pdf");
    complete(1, { broken: true });

    const res = await exportCsv();
    expect(res.statusCode).toBe(200);
    const [, row] = parse(res.body);
    const cell = (c: (typeof EXPORT_COLUMNS)[number]) => row?.[EXPORT_COLUMNS.indexOf(c)];
    expect(cell("file")).toBe("broken.pdf");
    expect(cell("vendor")).toBe("");
    expect(cell("high_risks")).toBe("");
    expect(cell("model")).toBe("mock-1");
  });

  it("exports a duplicate with its original's extraction", async () => {
    addDoc(1, "first.pdf");
    complete(1, extractionResult());
    createDocument(db, {
      id: docId(2),
      original_name: "again.pdf",
      mime: "application/pdf",
      size_bytes: 1,
      sha256: "sha-1",
      storage_path: `${docId(2)}.pdf`,
      status: "completed",
      duplicate_of: docId(1),
      latest_extraction_id: getDocument(db, docId(1))?.latest_extraction_id ?? null,
    });

    const rows = parse((await exportCsv()).body).slice(1);
    expect(rows.map((r) => r[EXPORT_COLUMNS.indexOf("vendor")])).toEqual(["Acme Ltd", "Acme Ltd"]);
  });

  it("sends just the header when nothing is completed", async () => {
    const res = await exportCsv();
    expect(res.body).toBe(`﻿${EXPORT_COLUMNS.join(",")}\r\n`);
  });
});
