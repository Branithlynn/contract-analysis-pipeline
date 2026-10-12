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
  {
    version: 2,
    name: "retrieval index",
    sql: `
      -- SQLite cannot change a CHECK in place. Dropping and re-adding the column is allowed because
      -- the CHECK only mentions the column itself, and it avoids rebuilding documents, which the
      -- other tables reference. The temp table carries the stage of documents that are mid job.
      CREATE TEMP TABLE migration_stage AS
        SELECT id, stage FROM documents WHERE stage IS NOT NULL;
      ALTER TABLE documents DROP COLUMN stage;
      ALTER TABLE documents ADD COLUMN stage TEXT
        CHECK (stage IN ('parsing', 'extracting', 'validating', 'indexing'));
      UPDATE documents
        SET stage = (SELECT s.stage FROM migration_stage s WHERE s.id = documents.id)
        WHERE id IN (SELECT id FROM migration_stage);
      DROP TABLE migration_stage;

      -- NULL: never indexed (processed before this feature, not completed yet, or a duplicate).
      ALTER TABLE documents ADD COLUMN index_status TEXT
        CHECK (index_status IN ('indexed', 'failed'));
      ALTER TABLE documents ADD COLUMN index_error TEXT;

      -- A plain table with the vector as a blob, not a vec0 virtual table: vec0 fixes the
      -- dimension when the table is created, and here it depends on EMBED_MODEL. Model and
      -- dimension are on every row, so the search skips rows from another model instead of
      -- comparing them with a vector they don't match.
      CREATE TABLE retrieval_chunks (
        id INTEGER PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents (id),
        chunk_index INTEGER NOT NULL,
        page INTEGER,
        text TEXT NOT NULL,
        injection_flagged INTEGER NOT NULL DEFAULT 0 CHECK (injection_flagged IN (0, 1)),
        embed_model TEXT NOT NULL,
        embed_dim INTEGER NOT NULL CHECK (embed_dim > 0),
        -- embed_dim float32 values, little endian.
        embedding BLOB NOT NULL CHECK (length(embedding) = embed_dim * 4),
        created_at TEXT NOT NULL,
        UNIQUE (document_id, chunk_index)
      );
      CREATE INDEX idx_retrieval_chunks_model ON retrieval_chunks (embed_model, embed_dim);
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
