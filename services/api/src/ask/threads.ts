import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { z } from "zod";
import type { Db } from "@nexus/shared/node";

// The memory of a chat thread: langgraph's sqlite checkpointer on our own database handle, so a
// thread is still there after the api restarts.

// The tables the checkpointer creates for itself. They are not in our migrations: the package owns
// their shape and changes it with its own versions. A migration must never use these names.
export const THREAD_TABLES: readonly string[] = ["checkpoints", "writes"];

// The package creates its tables on first use. This makes that happen at a known moment.
class ThreadStore extends SqliteSaver {
  createTables(): void {
    this.setup();
  }
}

const NameRow = z.object({ name: z.string() });

// Called once at api startup, right after the migrations, so the tables exist before the first
// question and a broken setup fails at boot. The worker never touches them.
// The package depends on better-sqlite3 12 and is given our 13 handle (see the override in the
// root package.json). The threads tests are what say that this still works.
export function createThreadStore(db: Db): SqliteSaver {
  const store = new ThreadStore(db);
  store.createTables();
  const present = new Set(
    z
      .array(NameRow)
      .parse(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all())
      .map((row) => row.name),
  );
  const missing = THREAD_TABLES.filter((name) => !present.has(name));
  if (missing.length > 0) {
    // A newer version of the package renamed its tables: THREAD_TABLES is out of date.
    throw new Error(`the thread store did not create ${missing.join(", ")}`);
  }
  return store;
}
