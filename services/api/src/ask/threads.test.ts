import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AIMessage } from "@langchain/core/messages";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLogger,
  migrate,
  MIGRATIONS,
  MockEmbedder,
  openDb,
  openMemoryDb,
  type Db,
} from "@nexus/shared/node";
import { readContext } from "../services/dto.js";
import { NOW } from "../test-support/fixtures.js";
import { runAsk } from "./agent.js";
import { ScriptedChatModel, type ChatScript } from "./scripted-model.js";
import { createThreadStore, THREAD_TABLES } from "./threads.js";

// The checkpointer package is built against better-sqlite3 12 and gets our 13 handle. These tests
// are what show that it works on it.

function tables(db: Db): string[] {
  return db
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name)
    .sort();
}

const dirs: string[] = [];
const open: Db[] = [];

afterEach(() => {
  for (const db of open.splice(0)) if (db.open) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function ask(
  db: Db,
  threads: ReturnType<typeof createThreadStore>,
  question: string,
  script: ChatScript,
) {
  const model = new ScriptedChatModel(script);
  const result = runAsk(
    {
      db,
      embedder: new MockEmbedder(),
      chatModels: { create: () => model, close: () => Promise.resolve() },
      threads,
      maxSteps: 6,
      promptVersion: "ask.v3",
    },
    {
      question,
      threadId: "thread-1",
      model: { provider: "mock", model: "mock" },
      signal: new AbortController().signal,
      log: createLogger("api", "silent"),
      context: readContext(NOW, 0.8),
    },
  );
  return { model, result };
}

describe("createThreadStore", () => {
  it("adds exactly the tables it says it adds", () => {
    const db = openMemoryDb();
    open.push(db);
    migrate(db);
    const before = tables(db);

    createThreadStore(db);

    const added = tables(db).filter((name) => !before.includes(name));
    expect(added).toEqual([...THREAD_TABLES].sort());
    expect(added).toEqual(["checkpoints", "writes"]);
  });

  it("uses names no migration creates or mentions", () => {
    const db = openMemoryDb();
    open.push(db);
    migrate(db);

    for (const name of THREAD_TABLES) {
      expect(tables(db)).not.toContain(name);
      for (const migration of MIGRATIONS) {
        expect(migration.sql).not.toMatch(new RegExp(`\\b${name}\\b`, "i"));
      }
    }
  });

  it("can be called again on a database that already has the tables", () => {
    const db = openMemoryDb();
    open.push(db);
    migrate(db);
    createThreadStore(db);

    expect(() => createThreadStore(db)).not.toThrow();
  });

  it("keeps a thread when the database is closed and opened again", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nexus-threads-"));
    dirs.push(dir);
    const path = join(dir, "app.db");

    const first = openDb(path);
    open.push(first);
    migrate(first);
    const firstTurn = ask(first, createThreadStore(first), "Which contracts renew?", () => {
      return new AIMessage("Only the msa renews.");
    });
    await expect(firstTurn.result).resolves.toMatchObject({ answer: "Only the msa renews." });
    first.close();

    // A new process: new handle, new store, nothing in memory.
    const second = openDb(path);
    open.push(second);
    migrate(second);
    const secondTurn = ask(second, createThreadStore(second), "And when?", () => {
      return new AIMessage("On 12 July 2026.");
    });
    await secondTurn.result;

    // The first call of the second question: what the thread held, and the question.
    const seen = secondTurn.model.seen[0]?.map((m) => [m.getType(), m.text]);
    expect(seen?.slice(1)).toEqual([
      ["human", "Which contracts renew?"],
      ["ai", "Only the msa renews."],
      ["human", "And when?"],
    ]);
    expect(seen?.[0]?.[0]).toBe("system");
  });
});
