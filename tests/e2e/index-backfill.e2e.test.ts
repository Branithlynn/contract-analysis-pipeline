// Runs scripts/index-backfill.ts the way `npm run index:backfill` does, as its own process, on a
// database with documents that were completed before the search index existed. The function the
// script calls has unit tests in the worker. This is about the script: its flags, what it prints,
// its exit code, and that the index it writes is one the api can search. It needs no redis.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDocument,
  getDocument,
  keywordSearchRetrievalChunks,
  listRetrievalChunks,
  migrate,
  openDb,
  transitionStatus,
  type Db,
} from "@nexus/shared/node";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SAMPLES = join(ROOT, "samples", "generated");
const TSX = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const SCRIPT = join(ROOT, "scripts", "index-backfill.ts");
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

describe("npm run index:backfill", () => {
  let dir: string;
  let db: Db;
  const saas = randomUUID();
  const nda = randomUUID();
  const queued = randomUUID();

  // The script in a process of its own, with the temp directory as its working directory so it
  // finds no .env there and takes its settings from the environment given here.
  function backfill(...args: string[]): Promise<Run> {
    return new Promise((resolve) => {
      execFile(
        process.execPath,
        [TSX, SCRIPT, ...args],
        {
          cwd: dir,
          env: {
            ...process.env,
            DATABASE_PATH: join(dir, "app.db"),
            UPLOAD_DIR: join(dir, "uploads"),
            LLM_PROVIDER: "mock",
            ALLOW_MOCK: "true",
          },
        },
        (err, stdout, stderr) => {
          const code = err === null ? 0 : typeof err.code === "number" ? err.code : 1;
          resolve({ code, stdout, stderr });
        },
      );
    });
  }

  // A document as the pipeline left it before there was an index: completed, its file in the
  // upload directory, index_status never set, no chunks.
  async function seedCompleted(id: string, sample: string, mime: string): Promise<void> {
    const stored = `${id}.${sample.split(".").pop() ?? ""}`;
    await copyFile(join(SAMPLES, sample), join(dir, "uploads", stored));
    createDocument(db, {
      id,
      original_name: sample,
      mime,
      size_bytes: 1,
      sha256: id,
      storage_path: stored,
      status: "queued",
    });
    transitionStatus(db, id, "processing", { from: "queued" });
    transitionStatus(db, id, "completed", { from: "processing" });
  }

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "nexus-backfill-script-"));
    await mkdir(join(dir, "uploads"));
    db = openDb(join(dir, "app.db"));
    migrate(db);
    await seedCompleted(saas, "saas-subscription.pdf", "application/pdf");
    await seedCompleted(nda, "mutual-nda.docx", DOCX);
    // Not completed, so not the backfill's business.
    createDocument(db, {
      id: queued,
      original_name: "waiting.pdf",
      mime: "application/pdf",
      size_bytes: 1,
      sha256: queued,
      storage_path: `${queued}.pdf`,
      status: "queued",
    });
  });

  afterAll(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("starts from documents without an index", () => {
    for (const id of [saas, nda]) {
      expect(getDocument(db, id)).toMatchObject({ status: "completed", index_status: null });
      expect(listRetrievalChunks(db, id)).toEqual([]);
    }
  });

  it("indexes the completed documents and says what it did", async () => {
    const run = await backfill("--provider", "mock");

    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("embeddings: mock mock");
    expect(run.stdout).toMatch(
      new RegExp(`indexed {2}${saas} {2}saas-subscription\\.pdf {2}\\(\\d+ chunks\\)`),
    );
    // The passage planted in the nda is counted, so whoever runs the script sees it.
    expect(run.stdout).toMatch(
      new RegExp(
        `indexed {2}${nda} {2}mutual-nda\\.docx {2}\\(\\d+ chunks, [1-9]\\d* flagged and kept out of search\\)`,
      ),
    );
    expect(run.stdout).toContain("2 indexed, 0 failed");
    expect(run.stdout).not.toContain(queued);

    // Read on this connection, which was open the whole time, like the api's.
    for (const id of [saas, nda]) {
      expect(getDocument(db, id)?.index_status).toBe("indexed");
      const chunks = listRetrievalChunks(db, id);
      expect(chunks.length).toBeGreaterThan(0);
      expect(new Set(chunks.map((chunk) => chunk.embed_model))).toEqual(new Set(["mock"]));
    }
    expect(listRetrievalChunks(db, nda).some((chunk) => chunk.injection_flagged === 1)).toBe(true);
    expect(listRetrievalChunks(db, queued)).toEqual([]);
  });

  it("leaves an index behind that search finds passages in, without the flagged one", () => {
    const terms = keywordSearchRetrievalChunks(db, { query: "payment terms net 30", k: 3 });
    expect(terms[0]).toMatchObject({ document_id: saas, file_name: "saas-subscription.pdf" });
    expect(terms[0]?.text).toContain("Payment terms are Net 30");

    const planted = keywordSearchRetrievalChunks(db, {
      query: "ignore all previous instructions",
      k: 50,
    });
    for (const hit of planted) {
      expect(hit.text.toLowerCase()).not.toContain("ignore all previous instructions");
    }
  });

  it("has nothing left to do on a second run, and does it all again with --all", async () => {
    const second = await backfill("--provider", "mock");
    expect(second.code).toBe(0);
    expect(second.stdout).toContain("0 indexed, 0 failed");

    const before = listRetrievalChunks(db, saas).length;
    const all = await backfill("--provider", "mock", "--all");
    expect(all.code).toBe(0);
    expect(all.stdout).toContain("2 indexed, 0 failed");
    // Replaced, not added to.
    expect(listRetrievalChunks(db, saas)).toHaveLength(before);
  });

  it("indexes again for another embedding model", async () => {
    const run = await backfill("--provider", "mock", "--model", "mock-2");

    expect(run.code).toBe(0);
    expect(run.stdout).toContain("embeddings: mock mock-2");
    expect(run.stdout).toContain("2 indexed, 0 failed");
    expect(new Set(listRetrievalChunks(db, saas).map((chunk) => chunk.embed_model))).toEqual(
      new Set(["mock-2"]),
    );
  });

  it("refuses a provider it does not know, with the usage", async () => {
    const run = await backfill("--provider", "anthropic");

    expect(run.code).toBe(1);
    expect(run.stderr).toContain('unknown embed provider "anthropic"');
    expect(run.stderr).toContain("usage: npm run index:backfill");
  });

  it("exits with 1 and names the document when a file is gone, and still does the others", async () => {
    const gone = randomUUID();
    createDocument(db, {
      id: gone,
      original_name: "gone.pdf",
      mime: "application/pdf",
      size_bytes: 1,
      sha256: gone,
      storage_path: `${gone}.pdf`,
      status: "queued",
    });
    transitionStatus(db, gone, "processing", { from: "queued" });
    transitionStatus(db, gone, "completed", { from: "processing" });

    const run = await backfill("--provider", "mock", "--all");

    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(new RegExp(`failed {3}${gone} {2}gone\\.pdf {2}\\S`));
    expect(run.stdout).toContain("2 indexed, 1 failed");
    expect(getDocument(db, gone)?.index_status).toBe("failed");
  });
});
