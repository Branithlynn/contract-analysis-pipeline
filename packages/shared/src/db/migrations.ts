import { z } from "zod";
import type { Db } from "./client.js";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

// Kept as TS instead of .sql files so tsc puts them in dist and the docker image needs no copy step.
// Each migration is a frozen snapshot: the CHECK lists are written out instead of built from status.ts,
// so changing an enum later means a new migration, not a silently different version 1.
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "initial",
    sql: `
      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        original_name TEXT NOT NULL,
        mime TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
        stage TEXT CHECK (stage IN ('parsing', 'extracting', 'validating')),
        needs_review INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        error_message TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        run INTEGER NOT NULL DEFAULT 1,
        duplicate_of TEXT REFERENCES documents (id),
        latest_extraction_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_documents_status ON documents (status);
      CREATE INDEX idx_documents_sha256 ON documents (sha256);
      CREATE INDEX idx_documents_created_at ON documents (created_at DESC);

      -- One row per run, never overwritten, so prompt versions can be compared on the same document.
      CREATE TABLE extractions (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents (id),
        run INTEGER NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        result_json TEXT NOT NULL,
        grounding_score REAL,
        chunk_count INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_extractions_document ON extractions (document_id, created_at DESC);

      CREATE TABLE processing_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id TEXT NOT NULL REFERENCES documents (id),
        run INTEGER NOT NULL,
        stage TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'error', 'retry', 'info')),
        message TEXT NOT NULL,
        duration_ms INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_processing_events_document ON processing_events (document_id, id);
    `,
  },
];

export const LATEST_VERSION = Math.max(0, ...MIGRATIONS.map((m) => m.version));

function ensureMigrationsTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
}

const VersionRow = z.object({ version: z.int().nullable() });

function currentVersion(db: Db): number {
  const row = VersionRow.parse(
    db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get(),
  );
  return row.version ?? 0;
}

// Only the api calls this on boot. The worker calls assertMigrated so two processes never race on DDL.
export function migrate(db: Db, migrations: readonly Migration[] = MIGRATIONS): number[] {
  ensureMigrationsTable(db);
  const current = currentVersion(db);
  const record = db.prepare(
    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
  );
  const applied: number[] = [];

  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (migration.version <= current) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.version, migration.name, new Date().toISOString());
    })();
    applied.push(migration.version);
  }
  return applied;
}

export function assertMigrated(db: Db): void {
  const hasTable = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  const current = hasTable ? currentVersion(db) : 0;
  if (current !== LATEST_VERSION) {
    throw new Error(
      `Database schema is at version ${current}, expected ${LATEST_VERSION}. Start the api first so it can migrate.`,
    );
  }
}
