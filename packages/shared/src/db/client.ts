import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

export type Db = Database.Database;

function applyPragmas(db: Db): void {
  // api and worker run as two containers writing the same file. busy_timeout comes first because
  // switching to WAL needs a lock, and the other process may hold it.
  db.pragma("busy_timeout = 5000");
  // WAL lets readers in one process keep going while the other one writes.
  db.pragma("journal_mode = WAL");
  // NORMAL is durable enough under WAL; a crash can lose the last commit but not corrupt the file.
  db.pragma("synchronous = NORMAL");
  // SQLite leaves foreign keys off per connection unless asked.
  db.pragma("foreign_keys = ON");
}

// Only the search query needs it (vec_distance_cosine). It is loaded on every connection anyway,
// so a missing or broken native binary fails at boot and not on the first search.
function loadVectorFunctions(db: Db): void {
  sqliteVec.load(db);
}

export function openDb(path: string): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  applyPragmas(db);
  loadVectorFunctions(db);
  return db;
}

// journal_mode stays "memory" here no matter what we ask for, so WAL is only testable on a real file.
export function openMemoryDb(): Db {
  const db = new Database(":memory:");
  applyPragmas(db);
  loadVectorFunctions(db);
  return db;
}
