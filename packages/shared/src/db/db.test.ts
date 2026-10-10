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
    storage_path: `/data/uploads/${id}.pdf`,
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

  it("enforces the status and stage checks", () => {
    migrate(db);
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
