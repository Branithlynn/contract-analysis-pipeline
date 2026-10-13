import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openMemoryDb, type Db } from "./client.js";
import { migrate } from "./migrations.js";
import {
  listIndexedThreadIds,
  searchThreadIndex,
  toThreadFtsQuery,
  upsertThreadIndex,
} from "./thread-index.js";

let db: Db;

beforeEach(() => {
  db = openMemoryDb();
  migrate(db);
});

afterEach(() => {
  db.close();
});

function thread(id: string, title: string, body: string, updatedAt = "2026-10-12T10:00:00.000Z") {
  upsertThreadIndex(db, { thread_id: id, title, updated_at: updatedAt, body });
}

const ids = (query: string) => searchThreadIndex(db, query, 50).map((hit) => hit.thread_id);

describe("toThreadFtsQuery", () => {
  it("wants every word, each as a prefix", () => {
    expect(toThreadFtsQuery("Notice dead")).toBe('"notice"* AND "dead"*');
  });

  it("reads nothing the user types as fts syntax", () => {
    expect(toThreadFtsQuery('title:x OR "y" NEAR(z) -w*')).toBe(
      '"title"* AND "x"* AND "or"* AND "y"* AND "near"* AND "z"* AND "w"*',
    );
  });

  it("is null without a word", () => {
    expect(toThreadFtsQuery("  ?! ")).toBeNull();
  });
});

describe("the thread index", () => {
  it("finds a thread by its title and by what was said in it", () => {
    thread("a", "Which contracts renew?", "Which contracts renew?\n\nOnly the msa renews.");
    thread("b", "Late payment", "Late payment\n\nFerrox charges 2% per week.");

    expect(ids("renew")).toEqual(["a"]);
    expect(ids("ferrox")).toEqual(["b"]);
    expect(ids("payment")).toEqual(["b"]);
    expect(ids("warranty")).toEqual([]);
  });

  it("wants all the words, in any order and any case", () => {
    thread("a", "Renewals", "Renewals\n\nThe msa renews, notice is due on 2027-11-02.");
    thread("b", "Notice", "Notice\n\nThe nda needs no notice.");

    expect(ids("NOTICE msa")).toEqual(["a"]);
    expect(ids("msa notice")).toEqual(["a"]);
  });

  it("matches a word that is still being typed, and other forms of it", () => {
    thread("a", "Charges", "Charges\n\nThe supplier charges interest on late invoices.");

    expect(ids("inter")).toEqual(["a"]);
    // The stemmer: "charge" and "charging" are the same word as "charges".
    expect(ids("charging")).toEqual(["a"]);
  });

  it("ignores accents", () => {
    thread("a", "Société Générale", "Société Générale\n\nThe contract is with Société Générale.");

    expect(ids("societe generale")).toEqual(["a"]);
  });

  it("puts the thread written to last first", () => {
    thread("old", "Renewal", "Renewal", "2026-10-10T10:00:00.000Z");
    thread("new", "Renewal again", "Renewal again", "2026-10-12T10:00:00.000Z");
    thread("mid", "Renewal too", "Renewal too", "2026-10-11T10:00:00.000Z");

    expect(ids("renewal")).toEqual(["new", "mid", "old"]);
    expect(searchThreadIndex(db, "renewal", 2).map((hit) => hit.thread_id)).toEqual(["new", "mid"]);
  });

  it("returns the text around the match with the match marked", () => {
    thread(
      "a",
      "Liability",
      `Liability\n\n${"The agreement has many clauses. ".repeat(10)}The cap is twelve months of fees. ${"More text follows here. ".repeat(10)}`,
    );

    const [hit] = searchThreadIndex(db, "twelve", 50);

    expect(hit?.snippet?.filter((part) => part.match)).toEqual([{ text: "twelve", match: true }]);
    const text = hit?.snippet?.map((part) => part.text).join("") ?? "";
    expect(text).toContain("The cap is twelve months of fees.");
    // An excerpt, not the whole conversation.
    expect(text.length).toBeLessThan(200);
    expect(text.startsWith("…")).toBe(true);
  });

  it("has no snippet when only the title matches", () => {
    upsertThreadIndex(db, {
      thread_id: "a",
      title: "Insurance",
      updated_at: "2026-10-12T10:00:00.000Z",
      body: "Something else entirely.",
    });

    expect(searchThreadIndex(db, "insurance", 50)).toEqual([
      { thread_id: "a", title: "Insurance", updated_at: "2026-10-12T10:00:00.000Z", snippet: null },
    ]);
  });

  it("keeps one row per thread and forgets the text it replaced", () => {
    thread("a", "First", "First\n\nAbout indemnities.");
    thread("a", "First", "First\n\nAbout warranties.", "2026-10-13T10:00:00.000Z");

    expect(listIndexedThreadIds(db)).toEqual(["a"]);
    expect(ids("indemnities")).toEqual([]);
    expect(searchThreadIndex(db, "warranties", 50)[0]?.updated_at).toBe("2026-10-13T10:00:00.000Z");
  });

  it("finds nothing for a query without words", () => {
    thread("a", "First", "First");

    expect(ids("?!")).toEqual([]);
  });
});
