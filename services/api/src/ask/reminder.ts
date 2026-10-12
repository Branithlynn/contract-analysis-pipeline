import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { randomUUID } from "node:crypto";
import type { AskStep } from "@nexus/shared";

// What is sent back when the model's first reply to a question uses no tool. Small models like
// to answer a question about the contracts from the conversation or from thin air, and such an
// answer has nothing behind it. Whether a question is about the contracts is the model's call:
// code cannot tell "thanks" from "which ones renew", so the message leaves that door open.
export const LOOKUP_REMINDER =
  "You answered without using a tool. If the question is about the contracts, look it up with the tools before answering, and cite what you find. If it is not about the contracts, answer as before.";

// The reminder is a message in the thread like any other, so it is found again by its id.
const ID_PREFIX = "lookup-reminder-";

export function lookupReminder(): HumanMessage {
  return new HumanMessage({ id: `${ID_PREFIX}${randomUUID()}`, content: LOOKUP_REMINDER });
}

export function isLookupReminder(message: BaseMessage): boolean {
  return message instanceof HumanMessage && (message.id?.startsWith(ID_PREFIX) ?? false);
}

// Not a tool call, but part of how the answer came about, and it cost a step. So it has a line
// in the trace like one.
export const LOOKUP_REMINDER_STEP: AskStep = {
  tool: "lookup_reminder",
  input: {},
  result: "the first reply used no tool, so it was sent back once",
};
