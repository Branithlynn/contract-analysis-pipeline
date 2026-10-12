import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, openMemoryDb, type Db } from "./client.js";
import { assertMigrated, migrate, MIGRATIONS, type Migration } from "./migrations.js";

const NOW = "2026-10-10T00:00:00.000Z";

function insertDocument(db: Db, id: string, overrides: Record<string, unknown> = {}): void {
  const row = {
    id,
    original_name: "msa.pdf",
    mime: "application/pdf",
    size_bytes: 1024,
    sha256: "abc",
    storage_path: `${id}.pdf`,
    status: "queued",
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
  const columns = Object.keys(row);
  db.prepare(
    `INSERT INTO documents (${columns.join(", ")}) VALUES (${columns.map((c) => `@${c}`).join(", ")})`,
  ).run(row);
}

describe("openDb", () => {
  let dir: string;
  let db: Db | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nexus-db-"));
  });

  afterEach(async () => {
    // Close first: on Windows the open WAL files would block the rm.
    db?.close();
    db = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  it("creates the parent directory and applies the pragmas", () => {
    const path = join(dir, "nested", "deeper", "app.db");
    db = openDb(path);
    expect(existsSync(path)).toBe(true);
    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    // 1 = NORMAL
    expect(db.pragma("synchronous", { simple: true })).toBe(1);
  });
});

describe("openMemoryDb", () => {
  it("enables foreign keys", () => {
    const db = openMemoryDb();
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    db.close();
  });
});

// What the migrations after version 1 add to a document, all empty on a row that was there before.
const NEW_DOCUMENT_COLUMNS = {
  index_status: null,
  index_error: null,
  llm_provider: null,
  llm_model: null,
  fallback_needs_review: null,
};

// Migration 2 drops and re-adds documents.stage. This runs it the way a dev database meets it: a
// file on disk in WAL mode, in the version 1 schema, with documents in every status and stage.
describe("migration 2 on a version 1 database file", () => {
  let dir: string;
  let db: Db;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nexus-migrate-"));
    db = openDb(join(dir, "app.db"));
    migrate(
      db,
      MIGRATIONS.filter((m) => m.version === 1),
    );
  });

  afterEach(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  const all = (table: string, order: string) =>
    db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all() as Record<string, unknown>[];

  it("loses nothing: every document, stage, extraction and event is the same afterwards", () => {
    insertDocument(db, "queued");
    insertDocument(db, "parsing", { status: "processing", stage: "parsing", attempts: 1 });
    insertDocument(db, "extracting", { status: "processing", stage: "extracting", attempts: 2 });
    insertDocument(db, "validating", { status: "processing", stage: "validating", run: 3 });
    insertDocument(db, "completed", {
      status: "completed",
      needs_review: 1,
      attempts: 2,
      run: 2,
      latest_extraction_id: "ext-1",
      original_name: "Rahmenvertrag Müller & Söhne.pdf",
      updated_at: "2026-10-11T08:30:00.000Z",
    });
    insertDocument(db, "failed", {
      status: "failed",
      error_code: "NO_TEXT_LAYER",
      error_message: "PDF has no extractable text (likely scanned). OCR is not supported.",
      attempts: 1,
    });
    insertDocument(db, "duplicate", {
      status: "completed",
      duplicate_of: "completed",
      latest_extraction_id: "ext-1",
    });
    db.prepare(
      `INSERT INTO extractions
         (id, document_id, run, provider, model, prompt_version, result_json, grounding_score,
          chunk_count, input_tokens, output_tokens, duration_ms, created_at)
       VALUES ('ext-1', 'completed', 2, 'ollama', 'qwen2.5:7b-instruct', 'extract.v3',
               '{"summary":"A contract."}', 0.75, 3, 9000, 800, 61000, ?)`,
    ).run(NOW);
    const event = db.prepare(
      "INSERT INTO processing_events (document_id, run, stage, outcome, message, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    event.run("completed", 1, "extracting", "error", "LLM_UNAVAILABLE: down", 1200, NOW);
    event.run("completed", 1, "job", "retry", "retrying as attempt 2 of 3", null, NOW);
    event.run("completed", 2, "validating", "ok", "ok", 40, NOW);
    event.run("extracting", 1, "parsing", "ok", "ok", 15, NOW);
    event.run("failed", 1, "parsing", "error", "NO_TEXT_LAYER: no text", 9, NOW);

    const before = {
      documents: all("documents", "id"),
      extractions: all("extractions", "id"),
      events: all("processing_events", "id"),
    };
    expect(before.documents).toHaveLength(7);
    // A second connection, like the worker that is still running while the api migrates.
    const other = openDb(join(dir, "app.db"));
    try {
      expect(migrate(db)).toEqual(MIGRATIONS.filter((m) => m.version > 1).map((m) => m.version));

      // Compared as objects, so the stage column moving to the end does not matter. Every old
      // column has its old value, the two new ones are null.
      expect(all("documents", "id")).toEqual(
        before.documents.map((row) => ({ ...row, ...NEW_DOCUMENT_COLUMNS })),
      );
      expect(all("extractions", "id")).toEqual(before.extractions);
      expect(all("processing_events", "id")).toEqual(before.events);
      expect(
        db.prepare("SELECT id, stage FROM documents WHERE stage IS NOT NULL ORDER BY id").all(),
      ).toEqual([
        { id: "extracting", stage: "extracting" },
        { id: "parsing", stage: "parsing" },
        { id: "validating", stage: "validating" },
      ]);

      expect(db.pragma("foreign_key_check")).toEqual([]);
      expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
      // The other connection sees the same rows and the new schema without reopening.
      expect(() => assertMigrated(other)).not.toThrow();
      expect(other.prepare("SELECT COUNT(*) AS n FROM documents").get()).toEqual({ n: 7 });
      expect(
        other.prepare("UPDATE documents SET stage = 'indexing' WHERE id = 'validating'").run()
          .changes,
      ).toBe(1);
      expect(migrate(db)).toEqual([]);
    } finally {
      other.close();
    }
  });

  it("changes nothing when the migration fails half way", () => {
    insertDocument(db, "parsing", { status: "processing", stage: "parsing" });
    const before = all("documents", "id");
    const second = MIGRATIONS.find((m) => m.version === 2);
    if (!second) throw new Error("migration 2 is missing");
    const broken: Migration = {
      ...second,
      sql: `${second.sql}; INSERT INTO no_such_table VALUES (1);`,
    };

    expect(() => migrate(db, [broken])).toThrow(/no_such_table/);

    // Still the version 1 schema: the stage column with its old check, no index columns.
    expect(all("documents", "id")).toEqual(before);
    expect(() => insertDocument(db, "x", { stage: "indexing" })).toThrow(/CHECK/);
    expect(
      db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'retrieval_chunks'").get(),
    ).toBeUndefined();
    expect(migrate(db)).toEqual(MIGRATIONS.filter((m) => m.version > 1).map((m) => m.version));
    expect(all("documents", "id")).toEqual(
      before.map((row) => ({ ...row, ...NEW_DOCUMENT_COLUMNS })),
    );
  });
});

// Migration 3 renames retrieval_chunks.page and adds the full text index over chunks that may
// already be there.
describe("migration 3 on a version 2 database with chunks", () => {
  let db: Db;

  beforeEach(() => {
    db = openMemoryDb();
    migrate(
      db,
      MIGRATIONS.filter((m) => m.version <= 2),
    );
    insertDocument(db, "msa", { status: "completed", index_status: "indexed" });
    insertDocument(db, "sow", { status: "completed", index_status: "indexed" });
    const insert = db.prepare(
      `INSERT INTO retrieval_chunks
         (document_id, chunk_index, page, text, injection_flagged, embed_model, embed_dim, embedding, created_at)
       VALUES (?, ?, ?, ?, ?, 'nomic-embed-text', 2, ?, ?)`,
    );
    const vector = Buffer.from(new Float32Array([1, 0]).buffer);
    insert.run("msa", 0, 11, "Vendor may terminate for convenience.", 0, vector, NOW);
    insert.run("msa", 1, 12, "All Work Product is owned by Vendor.", 0, vector, NOW);
    insert.run("sow", 0, null, "The fee includes all travel expenses.", 1, vector, NOW);
  });

  afterEach(() => {
    db.close();
  });

  const match = (query: string) =>
    db
      .prepare(
        `SELECT c.text FROM retrieval_chunks_fts f JOIN retrieval_chunks c ON c.id = f.rowid
         WHERE retrieval_chunks_fts MATCH ? ORDER BY c.id`,
      )
      .all(query)
      .map((row) => (row as { text: string }).text);

  it("keeps every chunk and turns its page into a one page range", () => {
    const before = db.prepare("SELECT * FROM retrieval_chunks ORDER BY id").all() as Record<
      string,
      unknown
    >[];

    expect(migrate(db)).toEqual(MIGRATIONS.filter((m) => m.version > 2).map((m) => m.version));

    const after = db.prepare("SELECT * FROM retrieval_chunks ORDER BY id").all();
    expect(after).toEqual(
      before.map(({ page, ...rest }) => ({
        ...rest,
        page_start: page,
        page_end: page,
        page_breaks: null,
      })),
    );
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
  });

  it("fills the full text index from the chunks that were already there", () => {
    migrate(db);

    expect(match('"convenience"')).toEqual(["Vendor may terminate for convenience."]);
    // Stemmed: "owns" finds "owned".
    expect(match('"owns"')).toEqual(["All Work Product is owned by Vendor."]);
    // A flagged chunk is in the index like any other, the search leaves it out.
    expect(match('"travel"')).toEqual(["The fee includes all travel expenses."]);
  });

  it("keeps the index in step with inserts, updates and deletes from then on", () => {
    migrate(db);
    const vector = Buffer.from(new Float32Array([1, 0]).buffer);
    db.prepare(
      `INSERT INTO retrieval_chunks
         (document_id, chunk_index, page_start, page_end, text, embed_model, embed_dim, embedding, created_at)
       VALUES ('msa', 2, 13, 13, 'Insurance must be kept in force.', 'm', 2, ?, ?)`,
    ).run(vector, NOW);
    expect(match('"insurance"')).toEqual(["Insurance must be kept in force."]);

    db.prepare(
      "UPDATE retrieval_chunks SET text = 'Notices go by email.' WHERE chunk_index = 2",
    ).run();
    expect(match('"insurance"')).toEqual([]);
    expect(match('"email"')).toEqual(["Notices go by email."]);

    db.prepare("DELETE FROM retrieval_chunks WHERE document_id = 'msa'").run();
    expect(match('"email" OR "convenience" OR "vendor"')).toEqual([]);
    expect(match('"travel"')).toHaveLength(1);
    expect(
      db
        .prepare(
          "INSERT INTO retrieval_chunks_fts (retrieval_chunks_fts) VALUES ('integrity-check')",
        )
        .run(),
    ).toBeDefined();
  });
});

describe("migration 4: model per document run", () => {
  it("leaves existing documents without a model and only takes a provider it knows", () => {
    const db = openMemoryDb();
    try {
      migrate(
        db,
        MIGRATIONS.filter((m) => m.version <= 3),
      );
      insertDocument(db, "old", { status: "completed" });

      expect(migrate(db)).toEqual(MIGRATIONS.filter((m) => m.version > 3).map((m) => m.version));

      expect(db.prepare("SELECT llm_provider, llm_model FROM documents").get()).toEqual({
        llm_provider: null,
        llm_model: null,
      });
      insertDocument(db, "new", { llm_provider: "openai", llm_model: "gpt-5-mini" });
      expect(() => insertDocument(db, "bad", { llm_provider: "gemini" })).toThrow(/CHECK/);
    } finally {
      db.close();
    }
  });
});

describe("migration 5: failed runs", () => {
  it("adds the fallback column empty and a failed_runs table that takes one row per run", () => {
    const db = openMemoryDb();
    try {
      migrate(
        db,
        MIGRATIONS.filter((m) => m.version <= 4),
      );
      insertDocument(db, "old", { status: "completed" });

      expect(migrate(db)).toEqual([5]);

      expect(db.prepare("SELECT fallback_needs_review AS f FROM documents").get()).toEqual({
        f: null,
      });
      expect(() => insertDocument(db, "bad", { fallback_needs_review: 2 })).toThrow(/CHECK/);
      const insert = db.prepare(
        `INSERT INTO failed_runs
           (document_id, run, provider, model, prompt_version, error_code, error_message, created_at)
         VALUES (?, ?, 'mock', 'mock', 'extract.v3', 'LLM_AUTH', 'bad key', ?)`,
      );
      insert.run("old", 2, NOW);
      expect(() => insert.run("old", 2, NOW)).toThrow(/UNIQUE/);
      expect(() => insert.run("missing", 1, NOW)).toThrow(/FOREIGN KEY/);
    } finally {
      db.close();
    }
  });
});

describe("migrations", () => {
  let db: Db;

  beforeEach(() => {
    db = openMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  it("applies every migration on a fresh db and nothing on the second run", () => {
    expect(migrate(db)).toEqual(MIGRATIONS.map((m) => m.version));
    expect(migrate(db)).toEqual([]);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "documents",
        "extractions",
        "processing_events",
        "schema_migrations",
      ]),
    );
  });

  it("has strictly increasing versions", () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(versions).toEqual([...new Set(versions)].sort((a, b) => a - b));
  });

  it("assertMigrated throws before migrate and passes after", () => {
    expect(() => assertMigrated(db)).toThrow(/version 0/);
    migrate(db);
    expect(() => assertMigrated(db)).not.toThrow();
  });

  it("rolls back a failing migration and records nothing for it", () => {
    migrate(db);
    const broken: Migration = {
      version: 999,
      name: "broken",
      sql: "CREATE TABLE half_done (id TEXT); INSERT INTO no_such_table VALUES (1);",
    };
    expect(() => migrate(db, [...MIGRATIONS, broken])).toThrow();
    const table = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'half_done'").get();
    expect(table).toBeUndefined();
    expect(() => assertMigrated(db)).not.toThrow();
  });

  it("upgrades a version 1 database with data in it", () => {
    migrate(
      db,
      MIGRATIONS.filter((m) => m.version === 1),
    );
    insertDocument(db, "mid-job", { status: "processing", stage: "extracting" });
    insertDocument(db, "done", { status: "completed" });
    insertDocument(db, "copy", { status: "completed", duplicate_of: "done" });
    db.prepare(
      "INSERT INTO processing_events (document_id, run, stage, outcome, message, created_at) VALUES ('done', 1, 'parsing', 'ok', 'ok', ?)",
    ).run(NOW);
    // The old check has no indexing stage.
    expect(() => insertDocument(db, "x", { stage: "indexing" })).toThrow(/CHECK/);

    expect(migrate(db)).toEqual(MIGRATIONS.filter((m) => m.version > 1).map((m) => m.version));

    // Rows, the stage of a document that was mid job, and the references between tables survive.
    const columns = "id, status, stage, duplicate_of, index_status, index_error";
    expect(db.prepare(`SELECT ${columns} FROM documents ORDER BY id`).all()).toEqual([
      {
        id: "copy",
        status: "completed",
        stage: null,
        duplicate_of: "done",
        index_status: null,
        index_error: null,
      },
      {
        id: "done",
        status: "completed",
        stage: null,
        duplicate_of: null,
        index_status: null,
        index_error: null,
      },
      {
        id: "mid-job",
        status: "processing",
        stage: "extracting",
        duplicate_of: null,
        index_status: null,
        index_error: null,
      },
    ]);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM processing_events").get()).toEqual({ n: 1 });
    expect(() => insertDocument(db, "y", { stage: "indexing" })).not.toThrow();
    expect(() => insertDocument(db, "z", { duplicate_of: "missing" })).toThrow(/FOREIGN KEY/);
    // Dropping the stage column did not take the indexes of version 1 along.
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'documents'")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        "idx_documents_status",
        "idx_documents_sha256",
        "idx_documents_created_at",
      ]),
    );
    expect(db.prepare("SELECT name FROM sqlite_temp_master").all()).toEqual([]);
  });

  it("enforces the index status check", () => {
    migrate(db);
    expect(() => insertDocument(db, "a", { index_status: "pending" })).toThrow(/CHECK/);
    expect(() => insertDocument(db, "b", { index_status: "failed" })).not.toThrow();
    expect(() => insertDocument(db, "c", { index_status: "indexed" })).not.toThrow();
  });

  it("loads the sqlite-vec functions on every connection", () => {
    const row = db.prepare("SELECT vec_version() AS v").get() as { v: string };
    expect(row.v).toMatch(/^v\d+\.\d+\.\d+/);
  });

  it("enforces the status and stage checks", () => {
    migrate(db);
    expect(() => insertDocument(db, "i", { stage: "indexing" })).not.toThrow();
    expect(() => insertDocument(db, "a", { status: "done" })).toThrow(/CHECK/);
    expect(() => insertDocument(db, "b", { stage: "uploading" })).toThrow(/CHECK/);
    expect(() => insertDocument(db, "c", { stage: null })).not.toThrow();
  });

  it("applies the column defaults", () => {
    migrate(db);
    insertDocument(db, "d");
    expect(
      db.prepare("SELECT needs_review, attempts, run FROM documents WHERE id = 'd'").get(),
    ).toEqual({
      needs_review: 0,
      attempts: 0,
      run: 1,
    });
  });

  it("enforces foreign keys", () => {
    migrate(db);
    expect(() => insertDocument(db, "e", { duplicate_of: "missing" })).toThrow(/FOREIGN KEY/);
    expect(() =>
      db
        .prepare(
          "INSERT INTO processing_events (document_id, run, stage, outcome, message, created_at) VALUES (?, 1, 'parsing', 'ok', 'x', ?)",
        )
        .run("missing", NOW),
    ).toThrow(/FOREIGN KEY/);
  });

  it("rejects an unknown event outcome", () => {
    migrate(db);
    insertDocument(db, "f");
    expect(() =>
      db
        .prepare(
          "INSERT INTO processing_events (document_id, run, stage, outcome, message, created_at) VALUES ('f', 1, 'parsing', 'maybe', 'x', ?)",
        )
        .run(NOW),
    ).toThrow(/CHECK/);
  });
});
