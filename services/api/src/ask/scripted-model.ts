import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";

// What the model would have answered to these messages: tool calls or the final text.
export type ChatScript = (
  messages: readonly BaseMessage[],
  signal: AbortSignal | undefined,
) => AIMessage | Promise<AIMessage>;

// The mock provider of the ask agent: a chat model whose answers come from a function, so the
// agent, its tools and the citation check run in tests and ci without a model or network.
export class ScriptedChatModel extends BaseChatModel {
  // Every list of messages the model was called with, to assert what reached it.
  readonly seen: BaseMessage[][] = [];

  constructor(private readonly script: ChatScript) {
    super({});
  }

  _llmType(): string {
    return "scripted";
  }

  // The script decides which tools are called, so there is nothing to bind.
  override bindTools(): this {
    return this;
  }

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
  ): Promise<ChatResult> {
    options.signal?.throwIfAborted();
    this.seen.push(messages);
    const message = await this.script(messages, options.signal);
    return { generations: [{ text: message.text, message }] };
  }
}

let callIds = 0;

export function toolCall(name: string, args: Record<string, unknown>): AIMessage {
  callIds += 1;
  return new AIMessage({
    content: "",
    tool_calls: [{ id: `call_${String(callIds)}`, name, args, type: "tool_call" }],
  });
}

// The messages of the question being answered: everything after the last human message.
export function currentTurn(messages: readonly BaseMessage[]): {
  question: string;
  toolResults: string[];
} {
  const at = messages.findLastIndex((m) => m.getType() === "human");
  const question = messages[at]?.text ?? "";
  const toolResults = messages
    .slice(at + 1)
    .filter((m) => m.getType() === "tool")
    .map((m) => m.text);
  return { question, toolResults };
}

const FIRST_CHUNK_ID = /"chunk_id":\s*(\d+)/;

// What LLM_PROVIDER=mock answers in the ui: one search with the question as it is, then an
// answer that cites the first chunk found. Enough to see the trace and a verified citation.
export const defaultMockScript: ChatScript = (messages) => {
  const { question, toolResults } = currentTurn(messages);
  const result = toolResults[0];
  if (result === undefined) return toolCall("search_clauses", { query: question, k: 3 });
  const id = FIRST_CHUNK_ID.exec(result)?.[1];
  return new AIMessage(
    id === undefined
      ? "Mock answer: the search found nothing."
      : `Mock answer: see the first search result. [chunk:${id}]`,
  );
};
