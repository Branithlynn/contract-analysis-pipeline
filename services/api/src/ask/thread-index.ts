import { upsertThreadIndex, type Db } from "@nexus/shared/node";
// Type only: agent.ts imports this file.
import type { StoredThread } from "./agent.js";
import { stripCitationMarkers } from "./citations.js";

// The search index over earlier chats. The threads themselves are serialized by the checkpointer,
// so what was said in one is written out here as plain text. indexThread in agent.ts decides when.

const TITLE_CHARS = 80;

// A thread is listed under its first question.
export function titleOf(question: string): string {
  const line = question.replace(/\s+/g, " ").trim();
  return line.length <= TITLE_CHARS ? line : `${line.slice(0, TITLE_CHARS - 1).trimEnd()}…`;
}

function bodyOf(thread: StoredThread): string {
  return thread.messages
    .map((message) => (message.role === "user" ? message.text : stripCitationMarkers(message.text)))
    .join("\n\n");
}

// Returns false for a thread without a question, which is not listed either.
export function writeThreadIndex(db: Db, threadId: string, thread: StoredThread): boolean {
  const first = thread.messages.find((message) => message.role === "user");
  if (!first) return false;
  upsertThreadIndex(db, {
    thread_id: threadId,
    title: titleOf(first.text),
    updated_at: thread.updated_at,
    body: bodyOf(thread),
  });
  return true;
}
