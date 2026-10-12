import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ErrorBodySchema } from "@nexus/shared";
import {
  createDocument,
  createLogger,
  loadConfig,
  migrate,
  MockEmbedder,
  openMemoryDb,
  type Db,
} from "@nexus/shared/node";
import { buildServer } from "../server.js";
import { docId, offlineModels, okQueue } from "../test-support/fixtures.js";
import { inlineDisposition } from "./documents.js";

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_BYTES = Buffer.from("%PDF-1.7\n1 0 obj\n<< >>\nendobj\n%%EOF\n");

let db: Db;
// The folder the api reads from, inside a folder the test owns.
let outer: string;
let uploadDir: string;

beforeEach(async () => {
  db = openMemoryDb();
  migrate(db);
  outer = await mkdtemp(join(tmpdir(), "nexus-file-"));
  uploadDir = join(outer, "uploads");
});

afterEach(async () => {
  db.close();
  await rm(outer, { recursive: true, force: true });
});

async function store(n: number, name: string, mime: string, storagePath: string, bytes?: Buffer) {
  createDocument(db, {
    id: docId(n),
    original_name: name,
    mime,
    size_bytes: bytes?.length ?? 0,
    sha256: `sha-${String(n)}`,
    storage_path: storagePath,
    status: "queued",
  });
  if (bytes) {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(uploadDir, { recursive: true });
    await writeFile(join(uploadDir, storagePath), bytes);
  }
}

async function setup() {
  const lines: Record<string, unknown>[] = [];
  const stream = {
    write: (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>),
  };
  const app = await buildServer({
    db,
    queue: okQueue,
    config: loadConfig({ UPLOAD_DIR: uploadDir }),
    logger: createLogger("api", "info", stream),
    embedder: new MockEmbedder(),
    models: offlineModels(),
    clock: () => new Date("2026-06-01T12:00:00Z"),
  });
  const file = (id: string) => app.inject({ method: "GET", url: `/api/documents/${id}/file` });
  return { file, lines };
}

describe("GET /api/documents/:id/file", () => {
  it("serves the stored upload with its stored type, to be shown in the browser", async () => {
    await store(1, "msa.pdf", PDF, `${docId(1)}.pdf`, PDF_BYTES);
    const { file } = await setup();

    const res = await file(docId(1));

    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(PDF_BYTES)).toBe(true);
    expect(res.headers["content-type"]).toBe(PDF);
    expect(res.headers["content-length"]).toBe(String(PDF_BYTES.length));
    expect(res.headers["content-disposition"]).toBe(
      `inline; filename="msa.pdf"; filename*=UTF-8''msa.pdf`,
    );
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toBe("private, max-age=3600");
  });

  it("serves a docx with the docx type", async () => {
    const bytes = Buffer.from("PK\u0003\u0004 not a real docx");
    await store(2, "sow.docx", DOCX, `${docId(2)}.docx`, bytes);
    const { file } = await setup();

    const res = await file(docId(2));

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe(DOCX);
    expect(res.rawPayload.equals(bytes)).toBe(true);
  });

  it("uses the type stored at upload, whatever the original name says", async () => {
    await store(3, "looks-like.html", PDF, `${docId(3)}.pdf`, PDF_BYTES);
    const { file } = await setup();

    expect((await file(docId(3))).headers["content-type"]).toBe(PDF);
  });

  it("answers 404 for a document that does not exist", async () => {
    const { file } = await setup();

    const res = await file(docId(9));

    expect(res.statusCode).toBe(404);
    expect(ErrorBodySchema.parse(res.json()).error.code).toBe("NOT_FOUND");
  });

  it("takes nothing but a document id from the request", async () => {
    await writeFile(join(outer, "secret.txt"), "not an upload");
    await store(1, "msa.pdf", PDF, `${docId(1)}.pdf`, PDF_BYTES);
    const { file } = await setup();

    for (const id of [
      "..%2Fsecret.txt",
      "..%2F..%2Fsecret.txt",
      `${docId(1)}.pdf`,
      "secret.txt",
      "%2e%2e",
    ]) {
      const res = await file(id);
      // Refused as not an id, or not routed here at all once the dots are resolved. Never served.
      expect([400, 404], id).toContain(res.statusCode);
      expect(res.body).not.toContain("not an upload");
    }
  });

  it("does not follow a stored path that leaves the upload folder", async () => {
    // No row this api writes looks like this. One that does must not be a way out.
    await writeFile(join(outer, "secret.txt"), "not an upload");
    await store(4, "msa.pdf", PDF, "../secret.txt");
    const { file, lines } = await setup();

    const res = await file(docId(4));

    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("not an upload");
    expect(lines).toContainEqual(
      expect.objectContaining({
        level: 50,
        documentId: docId(4),
        msg: "stored path points outside the upload folder",
      }),
    );
  });

  it("says so when the row is there and the file is gone", async () => {
    await store(5, "msa.pdf", PDF, `${docId(5)}.pdf`);
    const { file } = await setup();

    const res = await file(docId(5));

    expect(res.statusCode).toBe(404);
    expect(ErrorBodySchema.parse(res.json()).error).toEqual({
      code: "FILE_MISSING",
      message: "The stored file of this document is gone",
    });
  });
});

describe("inlineDisposition", () => {
  it("gives the name in ascii and in utf-8", () => {
    expect(inlineDisposition("Vertrag Müller & Söhne.pdf")).toBe(
      `inline; filename="Vertrag M_ller & S_hne.pdf"; filename*=UTF-8''Vertrag%20M%C3%BCller%20%26%20S%C3%B6hne.pdf`,
    );
  });

  it("lets nothing in a name end the header or start a new one", () => {
    const header = inlineDisposition('a"b\\c\r\nSet-Cookie: x=1;.pdf');

    expect(header).not.toMatch(/[\r\n]/);
    // The only quotes are the two around the ascii name.
    expect(header.match(/"/g)).toHaveLength(2);
    expect(header).toContain(`filename="a_b_c__Set-Cookie: x=1;.pdf"`);
    expect(header).toContain("filename*=UTF-8''a%22b%5Cc%0D%0ASet-Cookie%3A%20x%3D1%3B.pdf");
  });

  it("encodes the characters encodeURIComponent leaves alone but the header format does not", () => {
    expect(inlineDisposition("it's (final)*.pdf")).toContain(
      "filename*=UTF-8''it%27s%20%28final%29%2A.pdf",
    );
  });
});
