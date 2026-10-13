import { z } from "zod";
import type { Db } from "./client.js";

// The search index over earlier chats: one row per thread with its title and everything that was
// asked and answered as plain text, and a full text index over both.

export interface ThreadIndexInput {
  thread_id: string;
  title: string;
  // When the thread was last written to.
  updated_at: string;
  body: string;
}

// One row per thread: a new turn replaces what the thread had. The full text index follows
// through the triggers on the table.
export function upsertThreadIndex(db: Db, input: ThreadIndexInput): void {
  db.prepare<Record<string, unknown>>(
    `INSERT INTO thread_index (thread_id, title, updated_at, body)
     VALUES (@thread_id, @title, @updated_at, @body)
     ON CONFLICT (thread_id) DO UPDATE SET
       title = excluded.title, updated_at = excluded.updated_at, body = excluded.body`,
  ).run({ ...input });
}

const ThreadIdRow = z.object({ thread_id: z.string() });

export function listIndexedThreadIds(db: Db): string[] {
  return z
    .array(ThreadIdRow)
    .parse(db.prepare("SELECT thread_id FROM thread_index").all())
    .map((row) => row.thread_id);
}

const MAX_QUERY_TERMS = 16;

// What someone types into the search field as an fts5 query. Each word is quoted, so nothing is
// read as fts syntax. Unlike the question of a retrieval search, this is a filter: every word
// has to be there (AND), and each one matches as a prefix, so the list narrows while a word is
// still being typed. Null when the text has no words.
export function toThreadFtsQuery(text: string): string | null {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms = [...new Set(words)].slice(0, MAX_QUERY_TERMS);
  return terms.length === 0 ? null : terms.map((term) => `"${term}"*`).join(" AND ");
}

// A piece of a snippet. match: this piece is what the query found.
export interface SnippetPart {
  text: string;
  match: boolean;
}

export interface ThreadIndexHit {
  thread_id: string;
  title: string;
  updated_at: string;
  // The text around the first match in what was said. Null when only the title matches.
  snippet: SnippetPart[] | null;
}

// Control characters as the marks around a match: they cannot be in the text of a chat message
// the way "<b>" or "[" can.
const MARK_OPEN = "\u0001";
const MARK_CLOSE = "\u0002";
const SNIPPET_TOKENS = 14;

function snippetParts(marked: string): SnippetPart[] | null {
  if (!marked.includes(MARK_OPEN)) return null;
  const parts: SnippetPart[] = [];
  for (const piece of marked.split(MARK_OPEN)) {
    const [inside, after] = piece.includes(MARK_CLOSE) ? piece.split(MARK_CLOSE) : [null, piece];
    if (inside !== null && inside !== undefined && inside !== "") {
      parts.push({ text: inside, match: true });
    }
    if (after !== undefined && after !== "") parts.push({ text: after, match: false });
  }
  return parts;
}

const HitRow = z.object({
  thread_id: z.string(),
  title: z.string(),
  updated_at: z.string(),
  snippet: z.string(),
});

// The threads whose title or text has every word of the query, the one written to last first.
export function searchThreadIndex(db: Db, query: string, limit: number): ThreadIndexHit[] {
  const match = toThreadFtsQuery(query);
  if (match === null) return [];
  const rows = db
    .prepare<Record<string, unknown>>(
      // Column 1 is the body: the title is shown anyway, the snippet is for what the title
      // does not say.
      `SELECT t.thread_id, t.title, t.updated_at,
              snippet(thread_index_fts, 1, @open, @close, '…', @tokens) AS snippet
       FROM thread_index_fts
       JOIN thread_index t ON t.id = thread_index_fts.rowid
       WHERE thread_index_fts MATCH @match
       ORDER BY t.updated_at DESC, t.id DESC
       LIMIT @limit`,
    )
    .all({ match, limit, open: MARK_OPEN, close: MARK_CLOSE, tokens: SNIPPET_TOKENS });
  return z
    .array(HitRow)
    .parse(rows)
    .map((row) => ({
      thread_id: row.thread_id,
      title: row.title,
      updated_at: row.updated_at,
      snippet: snippetParts(row.snippet.replace(/\s+/g, " ")),
    }));
}
