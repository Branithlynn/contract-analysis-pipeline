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
  {
    version: 3,
    name: "chunk page ranges and full text search",
    sql: `
      -- A chunk can run over a page break. Chunks written before this get their one known page
      -- as both ends and no breaks, which is right for most and one page short for the rest,
      -- until the document is indexed again (npm run index:backfill -- --all).
      ALTER TABLE retrieval_chunks RENAME COLUMN page TO page_start;
      ALTER TABLE retrieval_chunks ADD COLUMN page_end INTEGER;
      -- Json: [{"page": 4, "offset": 812}] for every later page that starts inside the text.
      ALTER TABLE retrieval_chunks ADD COLUMN page_breaks TEXT;
      UPDATE retrieval_chunks SET page_end = page_start;

      -- Keyword search over the same chunks. An external content table: the text stays in
      -- retrieval_chunks and this only holds the index. The triggers keep it in step with every
      -- insert and delete, so indexing and the backfill fill it without knowing about it.
      -- porter, so "charges" finds "charge" and "renewing" finds "renewal".
      CREATE VIRTUAL TABLE retrieval_chunks_fts USING fts5(
        text,
        content = 'retrieval_chunks',
        content_rowid = 'id',
        tokenize = 'porter unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER retrieval_chunks_fts_insert AFTER INSERT ON retrieval_chunks BEGIN
        INSERT INTO retrieval_chunks_fts (rowid, text) VALUES (new.id, new.text);
      END;
      CREATE TRIGGER retrieval_chunks_fts_delete AFTER DELETE ON retrieval_chunks BEGIN
        INSERT INTO retrieval_chunks_fts (retrieval_chunks_fts, rowid, text)
          VALUES ('delete', old.id, old.text);
      END;
      CREATE TRIGGER retrieval_chunks_fts_update AFTER UPDATE OF text ON retrieval_chunks BEGIN
        INSERT INTO retrieval_chunks_fts (retrieval_chunks_fts, rowid, text)
          VALUES ('delete', old.id, old.text);
        INSERT INTO retrieval_chunks_fts (rowid, text) VALUES (new.id, new.text);
      END;
      -- The chunks that are already there.
      INSERT INTO retrieval_chunks_fts (retrieval_chunks_fts) VALUES ('rebuild');
    `,
  },
  {
    version: 4,
    name: "model per document run",
    sql: `
      -- The model the current run was asked to use. NULL on documents from before a model
      -- could be chosen: they run with LLM_PROVIDER / LLM_MODEL. What a finished run really
      -- used is on its extraction row, which had provider and model from the start.
      ALTER TABLE documents ADD COLUMN llm_provider TEXT
        CHECK (llm_provider IN ('ollama', 'anthropic', 'openai', 'mock'));
      ALTER TABLE documents ADD COLUMN llm_model TEXT;
      -- Dedupe asks for a finished analysis of the same file by the same model and prompt.
      CREATE INDEX idx_extractions_model ON extractions (provider, model, prompt_version);
    `,
  },
  {
    version: 5,
    name: "failed runs, and a completed document survives a failed reanalysis",
    sql: `
      -- Set while a reanalysis of a completed document is queued or running: the needs_review
      -- the document had. If that run fails the document goes back to completed with this
      -- value and keeps its extraction. NULL for every other run, which fails the document.
      ALTER TABLE documents ADD COLUMN fallback_needs_review INTEGER
        CHECK (fallback_needs_review IN (0, 1));

      -- A run that ended without an extraction. The extractions table only knows the runs that
      -- worked, and the document row only the last error.
      CREATE TABLE failed_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id TEXT NOT NULL REFERENCES documents (id),
        run INTEGER NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        error_code TEXT NOT NULL,
        error_message TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (document_id, run)
      );
    `,
  },
  {
    version: 6,
    name: "thread index for searching earlier chats",
    sql: `
      -- What was said in a chat thread, as plain text. The thread itself is kept by the langgraph
      -- package in its own tables, serialized, which is nothing to search in. The api fills this
      -- after every finished turn, and at startup for threads from before this table.
      CREATE TABLE thread_index (
        -- Its own integer key: the full text index points at it, and the rowid of a table
        -- without one may change on VACUUM.
        id INTEGER PRIMARY KEY,
        thread_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        -- The questions and answers in order, one block each.
        body TEXT NOT NULL
      );
      CREATE INDEX idx_thread_index_updated_at ON thread_index (updated_at DESC);

      -- Same setup as retrieval_chunks_fts: external content, kept in step by triggers.
      CREATE VIRTUAL TABLE thread_index_fts USING fts5(
        title,
        body,
        content = 'thread_index',
        content_rowid = 'id',
        tokenize = 'porter unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER thread_index_fts_insert AFTER INSERT ON thread_index BEGIN
        INSERT INTO thread_index_fts (rowid, title, body) VALUES (new.id, new.title, new.body);
      END;
      CREATE TRIGGER thread_index_fts_delete AFTER DELETE ON thread_index BEGIN
        INSERT INTO thread_index_fts (thread_index_fts, rowid, title, body)
          VALUES ('delete', old.id, old.title, old.body);
      END;
      CREATE TRIGGER thread_index_fts_update AFTER UPDATE OF title, body ON thread_index BEGIN
        INSERT INTO thread_index_fts (thread_index_fts, rowid, title, body)
          VALUES ('delete', old.id, old.title, old.body);
        INSERT INTO thread_index_fts (rowid, title, body) VALUES (new.id, new.title, new.body);
      END;
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
