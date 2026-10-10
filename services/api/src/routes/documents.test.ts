import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtractionResult, UploadResponse } from "@nexus/shared";
import {
  createDocument,
  createLogger,
  getDocument,
  insertExtraction,
  listEvents,
  loadConfig,
  migrate,
  openMemoryDb,
  transitionStatus,
  type Db,
} from "@nexus/shared/node";
import type { JobQueue } from "../queue.js";
import { buildServer } from "../server.js";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Smallest thing file-type calls a pdf: it only looks at the magic bytes.
function pdf(size = 200): Buffer {
  const head = Buffer.from("%PDF-1.4\n");
  return Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length), 0x20)]);
}

// A stored (uncompressed) zip, enough for file-type to tell docx from a plain zip.
function zip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const data = Buffer.from(text);
    const nameBuf = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

function docx(): Buffer {
  return zip({
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="${DOCX_MIME}.main+xml"/></Types>`,
    "word/document.xml": "<w:document/>",
  });
}

type FilePart = { filename: string; content: Buffer; contentType?: string };

function multipart(files: FilePart[]) {
  const boundary = "nexus-upload-boundary";
  const chunks: Buffer[] = [];
  for (const f of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.filename}"\r\n` +
          `Content-Type: ${f.contentType ?? "application/octet-stream"}\r\n\r\n`,
      ),
      f.content,
      Buffer.from("\r\n"),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

const sha = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

let uploadDir: string;
let db: Db;

beforeEach(async () => {
  uploadDir = await mkdtemp(join(tmpdir(), "nexus-upload-"));
  db = openMemoryDb();
  migrate(db);
});

afterEach(async () => {
  db.close();
  await rm(uploadDir, { recursive: true, force: true });
});

function fakeQueue(fail = false) {
  const calls: [string, number][] = [];
  const queue: JobQueue = {
    enqueue: (documentId, run) => {
      calls.push([documentId, run]);
      return fail ? Promise.reject(new Error("redis is not ready")) : Promise.resolve();
    },
    ping: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  return { queue, calls };
}

async function setup({ env = {}, failEnqueue = false } = {}) {
  const lines: Record<string, unknown>[] = [];
  const stream = {
    write: (chunk: string) => lines.push(JSON.parse(chunk) as Record<string, unknown>),
  };
  const { queue, calls } = fakeQueue(failEnqueue);
  const app = await buildServer({
    db,
    queue,
    config: loadConfig({ UPLOAD_DIR: uploadDir, ...env }),
    logger: createLogger("api", "info", stream),
    clock: () => new Date("2026-06-01T12:00:00Z"),
  });
  const upload = async (files: FilePart[]) => {
    const res = await app.inject({ method: "POST", url: "/api/documents", ...multipart(files) });
    return { status: res.statusCode, body: res.json<UploadResponse>() };
  };
  const uploadLines = () => lines.filter((line) => line.msg === "upload handled");
  return { app, upload, calls, uploadLines };
}

const tmpEntries = async () => readdir(join(uploadDir, "tmp"));

describe("POST /api/documents", () => {
  it("stores a pdf under its uuid, creates a queued row at run 1 and enqueues it", async () => {
    const { upload, calls } = await setup();
    const content = pdf();
    const { status, body } = await upload([{ filename: "../../contract.pdf", content }]);

    expect(status).toBe(202);
    expect(body.rejected).toEqual([]);
    const [accepted] = body.accepted;
    // busboy drops the directory part of client filenames (preservePath is off).
    expect(accepted).toMatchObject({
      original_name: "contract.pdf",
      status: "queued",
      duplicate_of: null,
    });
    const id = accepted?.id ?? "";

    const row = getDocument(db, id);
    expect(row).toMatchObject({
      original_name: "contract.pdf",
      mime: "application/pdf",
      size_bytes: content.length,
      sha256: sha(content),
      storage_path: `${id}.pdf`,
      status: "queued",
      run: 1,
    });
    expect(existsSync(join(uploadDir, `${id}.pdf`))).toBe(true);
    expect(calls).toEqual([[id, 1]]);
    expect(await tmpEntries()).toEqual([]);
  });

  it("accepts a docx by its content and stores it as .docx", async () => {
    const { upload } = await setup();
    const { status, body } = await upload([{ filename: "msa", content: docx() }]);
    expect(status).toBe(202);
    const id = body.accepted[0]?.id ?? "";
    expect(getDocument(db, id)).toMatchObject({
      mime: DOCX_MIME,
      storage_path: `${id}.docx`,
    });
  });

  it("rejects by detected type, ignoring the client's extension and content-type", async () => {
    const { upload, calls } = await setup();
    const { status, body } = await upload([
      { filename: "fake.pdf", content: Buffer.from("just text"), contentType: "application/pdf" },
      { filename: "archive.docx", content: zip({ "a.txt": "hi" }), contentType: DOCX_MIME },
    ]);

    expect(status).toBe(400);
    expect(body.accepted).toEqual([]);
    expect(body.rejected).toEqual([
      {
        original_name: "fake.pdf",
        code: "UNSUPPORTED_TYPE",
        message: "Only PDF and DOCX are accepted, detected unknown",
      },
      {
        original_name: "archive.docx",
        code: "UNSUPPORTED_TYPE",
        message: "Only PDF and DOCX are accepted, detected application/zip",
      },
    ]);
    expect(calls).toEqual([]);
    expect(await readdir(uploadDir)).toEqual(["tmp"]);
    expect(await tmpEntries()).toEqual([]);
  });

  it("rejects only the file over MAX_UPLOAD_MB and keeps the rest of the batch", async () => {
    const { upload, calls } = await setup({ env: { MAX_UPLOAD_MB: "1" } });
    const { status, body } = await upload([
      { filename: "big.pdf", content: pdf(1024 * 1024 + 1) },
      { filename: "small.pdf", content: pdf() },
    ]);

    expect(status).toBe(202);
    expect(body.rejected).toEqual([
      { original_name: "big.pdf", code: "FILE_TOO_LARGE", message: "File is larger than 1 MB" },
    ]);
    expect(body.accepted.map((a) => a.original_name)).toEqual(["small.pdf"]);
    expect(calls).toHaveLength(1);
    expect(await tmpEntries()).toEqual([]);
  });

  it("links a duplicate of a completed document to its extraction and does not enqueue it", async () => {
    const { upload, calls } = await setup();
    const content = pdf();
    createDocument(db, {
      id: "11111111-1111-4111-8111-111111111111",
      original_name: "first.pdf",
      mime: "application/pdf",
      size_bytes: content.length,
      sha256: sha(content),
      storage_path: "first.pdf",
      status: "queued",
    });
    const extractionId = insertExtraction(db, {
      document_id: "11111111-1111-4111-8111-111111111111",
      run: 1,
      provider: "mock",
      model: "mock",
      prompt_version: "v1",
      // The repo stores whatever it is given; the shape doesn't matter for dedupe.
      result: { summary: "x" } as unknown as ExtractionResult,
      grounding_score: 1,
      chunk_count: 1,
      input_tokens: 0,
      output_tokens: 0,
      duration_ms: 1,
    });
    transitionStatus(db, "11111111-1111-4111-8111-111111111111", "processing", { from: "queued" });
    transitionStatus(db, "11111111-1111-4111-8111-111111111111", "completed", {
      from: "processing",
    });

    const { status, body } = await upload([{ filename: "again.pdf", content }]);

    expect(status).toBe(202);
    const [accepted] = body.accepted;
    expect(accepted).toMatchObject({
      status: "completed",
      duplicate_of: "11111111-1111-4111-8111-111111111111",
    });
    const id = accepted?.id ?? "";
    expect(getDocument(db, id)).toMatchObject({
      status: "completed",
      duplicate_of: "11111111-1111-4111-8111-111111111111",
      latest_extraction_id: extractionId,
      storage_path: `${id}.pdf`,
    });
    expect(existsSync(join(uploadDir, `${id}.pdf`))).toBe(true);
    expect(calls).toEqual([]);
  });

  it("leaves the document queued with a retry event when enqueue throws", async () => {
    const { upload, uploadLines } = await setup({ failEnqueue: true });
    const { status, body } = await upload([{ filename: "a.pdf", content: pdf() }]);

    expect(status).toBe(202);
    const [accepted] = body.accepted;
    expect(accepted?.status).toBe("queued");
    const id = accepted?.id ?? "";
    expect(getDocument(db, id)).toMatchObject({ status: "queued", run: 1, error_code: null });
    expect(listEvents(db, id)).toMatchObject([
      {
        run: 1,
        stage: "queue",
        outcome: "retry",
        message: "queue unavailable, will retry automatically",
      },
    ]);
    expect(uploadLines()[0]).toMatchObject({ documentId: id, outcome: "queue_unavailable" });
  });

  it("logs one line per file with documentId, sha, size, mime and outcome", async () => {
    const { upload, uploadLines } = await setup({ env: { MAX_UPLOAD_MB: "1" } });
    const content = pdf();
    const { body } = await upload([
      { filename: "a.pdf", content },
      { filename: "b.txt", content: Buffer.from("text") },
      { filename: "big.pdf", content: pdf(1024 * 1024 + 1) },
    ]);

    const lines = uploadLines();
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({
      documentId: body.accepted[0]?.id,
      sha256: sha(content),
      size: content.length,
      mime: "application/pdf",
      outcome: "queued",
    });
    expect(lines[1]).toMatchObject({ mime: null, outcome: "unsupported_type" });
    expect(lines[2]).toMatchObject({ outcome: "too_large" });
    for (const line of lines) expect(line.documentId).toEqual(expect.any(String));
  });

  it("keeps the files before a too many files limit and reports it as a request level error", async () => {
    const { upload, calls } = await setup({ env: { MAX_FILES_PER_REQUEST: "2" } });
    const { status, body } = await upload([
      { filename: "a.pdf", content: pdf(210) },
      { filename: "b.pdf", content: pdf(220) },
      { filename: "c.pdf", content: pdf(230) },
    ]);
    expect(status).toBe(202);
    expect(body.accepted.map((a) => a.original_name)).toEqual(["a.pdf", "b.pdf"]);
    expect(body.error).toEqual({
      code: "TOO_MANY_FILES",
      message: "Too many files in one request",
    });
    expect(calls).toHaveLength(2);
  });

  it("reports a text field as a request level error without dropping the files", async () => {
    const { app } = await setup();
    const boundary = "b";
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="note"',
      "",
      "hi",
      `--${boundary}`,
      'Content-Disposition: form-data; name="files"; filename="a.pdf"',
      "",
      "%PDF-1.4 x",
      `--${boundary}--`,
      "",
    ].join("\r\n");
    const res = await app.inject({
      method: "POST",
      url: "/api/documents",
      payload,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    const body = res.json<UploadResponse>();
    expect(res.statusCode).toBe(202);
    expect(body.accepted).toHaveLength(1);
    expect(body.error).toEqual({
      code: "UNEXPECTED_FIELD",
      message: "Only file parts are accepted",
    });
  });

  it("answers an empty batch with 400 NO_FILES", async () => {
    const { upload } = await setup();
    const { status, body } = await upload([]);
    expect(status).toBe(400);
    expect(body).toEqual({
      accepted: [],
      rejected: [],
      error: { code: "NO_FILES", message: "No files in request" },
    });
  });
});
