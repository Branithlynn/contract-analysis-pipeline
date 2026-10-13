import { AIMessage } from "@langchain/core/messages";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLogger,
  listIndexedThreadIds,
  migrate,
  MockEmbedder,
  openMemoryDb,
  searchThreadIndex,
  type Db,
} from "@nexus/shared/node";
import { readContext } from "../services/dto.js";
import { NOW } from "../test-support/fixtures.js";
import { backfillThreadIndex, indexThread, runAsk, type AskResult } from "./agent.js";
import { stripCitationMarkers } from "./citations.js";
import { ScriptedChatModel, toolCall, type ChatScript } from "./scripted-model.js";
import { titleOf } from "./thread-index.js";
import { createThreadStore } from "./threads.js";

let db: Db;
let threads: ReturnType<typeof createThreadStore>;
const log = createLogger("api", "silent");
const context = readContext(NOW, 0.8);

beforeEach(() => {
  db = openMemoryDb();
  migrate(db);
  threads = createThreadStore(db);
});

afterEach(() => {
  db.close();
});

function ask(
  threadId: string,
  question: string,
  script: ChatScript,
  maxSteps = 6,
): Promise<AskResult> {
  const model = new ScriptedChatModel(script);
  return runAsk(
    {
      db,
      embedder: new MockEmbedder(),
      chatModels: { create: () => model, close: () => Promise.resolve() },
      threads,
      maxSteps,
    },
    {
      question,
      threadId,
      model: { provider: "mock", model: "mock" },
      signal: new AbortController().signal,
      log,
      context,
    },
  );
}

const says =
  (answer: string): ChatScript =>
  () =>
    new AIMessage(answer);
// Asks for a tool on every call, so the step limit ends the question without an answer.
const loops: ChatScript = () => toolCall("find_contracts", {});

interface Row {
  thread_id: string;
  title: string;
  updated_at: string;
  body: string;
}

function rows(): Row[] {
  return db
    .prepare<[], Row>("SELECT thread_id, title, updated_at, body FROM thread_index ORDER BY id")
    .all();
}

const found = (query: string) => searchThreadIndex(db, query, 50).map((hit) => hit.thread_id);

describe("titleOf", () => {
  it("is the question on one line, cut to a title", () => {
    expect(titleOf("  What does the order\nsay about delivery?  ")).toBe(
      "What does the order say about delivery?",
    );
    const long = titleOf("word ".repeat(60));
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("stripCitationMarkers", () => {
  it("leaves the sentence without the ids", () => {
    expect(
      stripCitationMarkers(
        'Notice is due on 2026-11-15 [contract:abc-1]. It says "60 days" [chunk:7], [chunk:8].',
      ),
    ).toBe('Notice is due on 2026-11-15. It says "60 days",.');
  });
});

describe("the thread index after a turn", () => {
  it("has the question and the answer as plain text", async () => {
    await ask(
      "t1",
      "Which contracts renew?",
      says("Only the msa renews [contract:11111111-1111-4111-8111-111111111111]."),
    );

    expect(rows()).toEqual([
      {
        thread_id: "t1",
        title: "Which contracts renew?",
        updated_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as string,
        body: "Which contracts renew?\n\nOnly the msa renews.",
      },
    ]);
    // By the title, and by a word that is only in the answer.
    expect(found("contracts")).toEqual(["t1"]);
    expect(found("msa")).toEqual(["t1"]);
    // The id in the citation is not something that was said.
    expect(found("11111111")).toEqual([]);
  });

  it("grows with the thread and keeps the first question as the title", async () => {
    await ask("t1", "Which contracts renew?", says("Only the msa renews."));
    const first = rows()[0]?.updated_at ?? "";
    await ask("t1", "And when is notice due?", says("On 2027-11-02."));

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      title: "Which contracts renew?",
      body: "Which contracts renew?\n\nOnly the msa renews.\n\nAnd when is notice due?\n\nOn 2027-11-02.",
    });
    expect((rows()[0]?.updated_at ?? "") >= first).toBe(true);
    expect(found("notice due")).toEqual(["t1"]);
  });

  it("keeps threads apart", async () => {
    await ask("t1", "Which contracts renew?", says("Only the msa renews."));
    await ask("t2", "Is there a late payment charge?", says("Yes, 2% per week."));

    expect(found("renew")).toEqual(["t1"]);
    expect(found("payment")).toEqual(["t2"]);
  });

  it("does not index a question that was rolled back", async () => {
    const stopped = await ask("t1", "Does the unicorn clause apply?", loops, 1);

    expect(stopped.stopped).toBe("step_limit");
    expect(rows()).toEqual([]);
    expect(found("unicorn")).toEqual([]);
  });

  it("leaves a thread's row alone when a later question is rolled back", async () => {
    await ask("t1", "Which contracts renew?", says("Only the msa renews."));
    const before = rows();

    await ask("t1", "Does the unicorn clause apply?", loops, 1);

    expect(rows()).toEqual(before);
    expect(found("unicorn")).toEqual([]);
  });

  it("does not index a question that failed", async () => {
    const fails: ChatScript = () => {
      throw new Error("model down");
    };

    await expect(ask("t1", "Does the unicorn clause apply?", fails)).rejects.toThrow("model down");

    expect(rows()).toEqual([]);
  });
});

describe("backfillThreadIndex", () => {
  it("indexes the threads that have no row, and only those", async () => {
    await ask("t1", "Which contracts renew?", says("Only the msa renews."));
    await ask("t2", "Is there a late payment charge?", says("Yes, 2% per week."));
    await ask("t3", "Does the unicorn clause apply?", loops, 1);
    // As after an upgrade: the threads are there, the index is new and empty. t2 keeps its row,
    // changed, to show that it is not written again.
    db.prepare("DELETE FROM thread_index WHERE thread_id = 't1'").run();
    db.prepare("UPDATE thread_index SET title = 'kept' WHERE thread_id = 't2'").run();
    expect(found("renew")).toEqual([]);

    const added = await backfillThreadIndex({ db, threads, log, context });

    expect(added).toBe(1);
    expect(found("renew")).toEqual(["t1"]);
    expect(rows().find((row) => row.thread_id === "t1")?.body).toBe(
      "Which contracts renew?\n\nOnly the msa renews.",
    );
    expect(rows().find((row) => row.thread_id === "t2")?.title).toBe("kept");
    // The thread whose only question never finished has nothing to index.
    expect(listIndexedThreadIds(db).sort()).toEqual(["t1", "t2"]);
  });

  it("does nothing when every thread is indexed", async () => {
    await ask("t1", "Which contracts renew?", says("Only the msa renews."));

    expect(await backfillThreadIndex({ db, threads, log, context })).toBe(0);
  });

  it("does nothing on a database without threads", async () => {
    expect(await backfillThreadIndex({ db, threads, log, context })).toBe(0);
  });
});

describe("indexThread", () => {
  it("says so when there is no such thread", async () => {
    expect(await indexThread({ db, threads, log, context }, "nope")).toBe(false);
    expect(rows()).toEqual([]);
  });
});
