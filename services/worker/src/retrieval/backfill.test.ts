import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getDocument,
  listRetrievalChunks,
  LlmError,
  MockEmbedder,
  setIndexStatus,
  transitionStatus,
  type Embedder,
} from "@nexus/shared/node";
import type { WorkerDeps } from "../deps.js";
import { docId, makeDeps as makeBaseDeps, seedDocument } from "../test-support/fixtures.js";
import { makePdf } from "../test-support/pdf.js";
import { backfillIndex } from "./backfill.js";
import { indexDocument } from "./index-document.js";

const LINE = "The supplier shall provide the services described in this agreement";
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "nexus-backfill-"));
  for (const n of [1, 2, 3, 5]) {
    await writeFile(join(dir, `${docId(n)}.pdf`), await makePdf([[LINE], [`${LINE} ${n}`]]));
  }
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const makeDeps = () => makeBaseDeps({ UPLOAD_DIR: dir });

function seedCompleted(deps: WorkerDeps, n: number, extra: { duplicate_of?: string } = {}): string {
  const id = seedDocument(deps, {
    id: docId(n),
    original_name: `contract-${n}.pdf`,
    sha256: String(n).repeat(64),
    storage_path: `${docId(n)}.pdf`,
    ...extra,
  });
  transitionStatus(deps.db, id, "processing", { from: "queued" });
  transitionStatus(deps.db, id, "completed", { from: "processing" });
  return id;
}

describe("backfillIndex", () => {
  it("indexes documents that were never indexed, failed, or have chunks of another model", async () => {
    const { deps } = makeDeps();
    const never = seedCompleted(deps, 1);
    const failed = seedCompleted(deps, 2);
    setIndexStatus(deps.db, failed, "failed", "LLM_UNAVAILABLE: Cannot reach Ollama");
    const oldModel = seedCompleted(deps, 3);
    await indexDocument({ ...deps, embedder: new MockEmbedder({ model: "old" }) }, oldModel, LINE);
    setIndexStatus(deps.db, oldModel, "indexed");

    const result = await backfillIndex(deps);

    expect(result.failed).toEqual([]);
    expect(result.indexed.map((d) => d.id).sort()).toEqual([never, failed, oldModel]);
    expect(result.indexed[0]).toMatchObject({ name: "contract-1.pdf", chunks: 1, flagged: 0 });
    for (const id of [never, failed, oldModel]) {
      expect(getDocument(deps.db, id)).toMatchObject({
        status: "completed",
        index_status: "indexed",
        index_error: null,
      });
      expect(listRetrievalChunks(deps.db, id)).toMatchObject([
        { page: 1, embed_model: "mock", embed_dim: 64 },
      ]);
    }
    // Nothing left to do on a second run.
    expect(await backfillIndex(deps)).toEqual({ indexed: [], failed: [] });
  });

  it("leaves indexed documents, duplicates and documents that are not completed alone", async () => {
    const { deps } = makeDeps();
    const embedder = new MockEmbedder();
    const indexed = seedCompleted(deps, 1);
    await indexDocument(deps, indexed, LINE);
    setIndexStatus(deps.db, indexed, "indexed");
    const before = listRetrievalChunks(deps.db, indexed);
    const duplicate = seedCompleted(deps, 2, { duplicate_of: indexed });
    const queued = seedDocument(deps, { id: docId(3), sha256: "3".repeat(64) });

    const result = await backfillIndex({ ...deps, embedder });

    expect(result).toEqual({ indexed: [], failed: [] });
    expect(embedder.calls).toEqual([]);
    expect(listRetrievalChunks(deps.db, indexed)).toEqual(before);
    expect(getDocument(deps.db, duplicate)?.index_status).toBeNull();
    expect(getDocument(deps.db, queued)?.index_status).toBeNull();
  });

  it("marks a document it cannot index as failed and goes on with the rest", async () => {
    const { deps, lines } = makeDeps();
    // No file on disk for this one.
    const missing = seedCompleted(deps, 4);
    const ok = seedCompleted(deps, 5);

    const result = await backfillIndex(deps);

    expect(result.indexed.map((d) => d.id)).toEqual([ok]);
    expect(result.failed).toEqual([
      {
        id: missing,
        name: "contract-4.pdf",
        error: expect.stringMatching(/^PARSE_ERROR: Could not parse pdf/) as string,
      },
    ]);
    expect(getDocument(deps.db, missing)).toMatchObject({
      status: "completed",
      index_status: "failed",
      index_error: expect.stringMatching(/^PARSE_ERROR/) as string,
    });
    expect(lines).toContainEqual(
      expect.objectContaining({ level: 40, documentId: missing, code: "PARSE_ERROR" }),
    );
  });

  it("records a provider failure on every document it hits", async () => {
    const { deps } = makeDeps();
    const embedder: Embedder = {
      name: "ollama",
      model: "nomic-embed-text",
      embed: () => Promise.reject(new LlmError("unavailable", "Cannot reach Ollama")),
    };
    const a = seedCompleted(deps, 1);
    const b = seedCompleted(deps, 2);

    const result = await backfillIndex({ ...deps, embedder });

    expect(result.indexed).toEqual([]);
    expect(result.failed.map((d) => d.id).sort()).toEqual([a, b]);
    expect(getDocument(deps.db, a)).toMatchObject({
      index_status: "failed",
      index_error: "LLM_UNAVAILABLE: Cannot reach Ollama",
    });
  });
});
