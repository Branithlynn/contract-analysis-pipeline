import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { randomUUID } from "node:crypto";
import type { AskStep } from "@nexus/shared";

// What the code says and does when a model answers a question about the contracts without
// looking anything up. Small models like to answer from the conversation or from thin air, and
// such an answer has nothing behind it. First the model is told, then the lookup is made for it.

// What is sent back when a reply to a question uses no tool and no lookup has been made yet.
// Whether a question is about the contracts is the model's call: code cannot tell "thanks" from
// "which ones renew", so the message leaves that door open.
export const LOOKUP_REMINDER =
  "You answered without using a tool. If the question is about the contracts, look it up with the tools before answering, and cite what you find. If it is not about the contracts, answer as before.";

// What is sent when the reply to the reminder has no lookup behind it either. The search that
// comes right after this message was made by the code, with the question as the query.
export const ANSWER_FROM_RESULTS =
  "You answered again without looking anything up, so the contracts were searched for you with the question as the query. The results follow. Answer the question again, only from these results, and cite them. If they do not contain the answer, say that you could not find it. If the question is not about the contracts, answer as before.";

// Both are messages in the thread like any other, so they are found again by their id.
const REMINDER_PREFIX = "lookup-reminder-";
const ANSWER_FROM_RESULTS_PREFIX = "answer-from-results-";

export function lookupReminder(): HumanMessage {
  return new HumanMessage({ id: `${REMINDER_PREFIX}${randomUUID()}`, content: LOOKUP_REMINDER });
}

export function answerFromResults(): HumanMessage {
  return new HumanMessage({
    id: `${ANSWER_FROM_RESULTS_PREFIX}${randomUUID()}`,
    content: ANSWER_FROM_RESULTS,
  });
}

export function isLookupReminder(message: BaseMessage): boolean {
  return message instanceof HumanMessage && (message.id?.startsWith(REMINDER_PREFIX) ?? false);
}

// A human message that the code wrote and not the user: not a question.
export function isAgentNote(message: BaseMessage): boolean {
  return (
    isLookupReminder(message) ||
    (message instanceof HumanMessage &&
      (message.id?.startsWith(ANSWER_FROM_RESULTS_PREFIX) ?? false))
  );
}

// Not a tool call, but part of how the answer came about, and it cost a step. So it has a line
// in the trace like one.
export const LOOKUP_REMINDER_STEP: AskStep = {
  tool: "lookup_reminder",
  input: {},
  result: "the first reply used no tool, so it was sent back once",
};

// A search the code made itself is put into the conversation the way a model's own would be
// there: an ai message that asks for the tool and the tool's result. Every provider reads that,
// and nothing a model wrote as text has to be parsed. The id of the call says who made it.
const CODE_CALL_PREFIX = "code_lookup_";
// In front of the result line in the trace, so it does not read as the model's own search.
export const CODE_LOOKUP_NOTE = "searched by the agent, not asked for by the model: ";

export function isCodeLookupId(toolCallId: string | undefined): boolean {
  return toolCallId?.startsWith(CODE_CALL_PREFIX) ?? false;
}

// The ai message of a search the code made. It is not a model call.
export function isCodeLookup(message: BaseMessage): boolean {
  return (
    message instanceof AIMessage && (message.tool_calls ?? []).some((c) => isCodeLookupId(c.id))
  );
}

export function codeLookupMessages(
  tool: string,
  args: Record<string, unknown>,
  result: string,
): [AIMessage, ToolMessage] {
  // Letters, digits and underscores: anthropic takes nothing else in a tool call id.
  const id = `${CODE_CALL_PREFIX}${randomUUID().replaceAll("-", "")}`;
  return [
    new AIMessage({ content: "", tool_calls: [{ id, name: tool, args, type: "tool_call" }] }),
    new ToolMessage({ content: result, tool_call_id: id, name: tool }),
  ];
}
