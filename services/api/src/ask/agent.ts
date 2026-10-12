import { AIMessage, HumanMessage, RemoveMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { FastifyBaseLogger } from "fastify";
import { createAgent, createMiddleware } from "langchain";
import type { AskCitation, AskStep } from "@nexus/shared";
import { getRetrievalChunk, type Db, type Embedder, type ModelSelection } from "@nexus/shared/node";
import type { ReadContext } from "../services/dto.js";
import type { ChatModels } from "./chat-models.js";
import { verifyCitations } from "./citations.js";
import { buildAskSystemPrompt } from "./prompt.js";
import { createAskTools, loadContract, summaryOf } from "./tools.js";

export interface AskDeps {
  db: Db;
  embedder: Embedder;
  chatModels: ChatModels;
  // One checkpoint history per thread_id.
  threads: BaseCheckpointSaver;
  // Model calls per question.
  maxSteps: number;
}

export interface AskInput {
  question: string;
  threadId: string;
  model: ModelSelection;
  // The limit of the whole question. Aborted by the route's timeout.
  signal: AbortSignal;
  log: FastifyBaseLogger;
  context: ReadContext;
}

export interface AskResult {
  stopped: "done" | "step_limit";
  answer: string | null;
  citations: AskCitation[];
  steps: AskStep[];
}

// The question ran into its time limit. Carries what the agent had done until then.
export class AskTimeoutError extends Error {
  constructor(readonly steps: AskStep[]) {
    super("the question was not answered in time");
    this.name = "AskTimeoutError";
  }
}

// The model asked for tools on its last allowed call instead of answering.
class StepLimitError extends Error {
  constructor(maxSteps: number) {
    super(`no answer after ${String(maxSteps)} model calls`);
    this.name = "StepLimitError";
  }
}

// Counts the model calls of one question. When the last allowed call asks for tools again, the
// run ends there: running them would be work nobody reads. The agent is built per question, so
// the count is too. langchain ships a modelCallLimitMiddleware for this, but its types do not
// compile under exactOptionalPropertyTypes and it keeps its count in the thread, where a run
// that was cut short leaves it behind.
function stepLimit(maxSteps: number) {
  let calls = 0;
  return createMiddleware({
    name: "StepLimit",
    afterModel: (state) => {
      calls += 1;
      const last = state.messages.at(-1);
      const wantsTools = last instanceof AIMessage && (last.tool_calls?.length ?? 0) > 0;
      if (calls >= maxSteps && wantsTools) throw new StepLimitError(maxSteps);
    },
  });
}

// The tool calls of one question in the order they were made, each with one line about its result.
export function stepsOf(turn: readonly BaseMessage[]): AskStep[] {
  const results = new Map<string, string>();
  for (const message of turn) {
    if (message instanceof ToolMessage) results.set(message.tool_call_id, message.text);
  }
  const steps: AskStep[] = [];
  for (const message of turn) {
    if (!(message instanceof AIMessage)) continue;
    for (const call of message.tool_calls ?? []) {
      const result = call.id === undefined ? undefined : results.get(call.id);
      steps.push({
        tool: call.name,
        input: call.args,
        result: result === undefined ? "not run" : summaryOf(result),
      });
    }
  }
  return steps;
}

function removals(messages: readonly BaseMessage[]): RemoveMessage[] {
  const out: RemoveMessage[] = [];
  for (const message of messages) {
    if (message.id !== undefined) out.push(new RemoveMessage({ id: message.id }));
  }
  return out;
}

export async function runAsk(deps: AskDeps, input: AskInput): Promise<AskResult> {
  const { db, log, context } = { ...deps, ...input };
  const agent = createAgent({
    model: deps.chatModels.create(input.model, input.signal),
    tools: createAskTools({ db, embedder: deps.embedder, log, context }),
    systemPrompt: buildAskSystemPrompt(context.today),
    checkpointer: deps.threads,
    middleware: [stepLimit(deps.maxSteps)],
  });
  const config = {
    configurable: { thread_id: input.threadId },
    signal: input.signal,
    // langgraph's own limit counts graph steps, several per model call, and is not what
    // ASK_MAX_STEPS means. It only has to stay out of the way of the step limit below.
    recursionLimit: 10 * deps.maxSteps + 10,
  };

  async function threadMessages(): Promise<BaseMessage[]> {
    const state = await agent.graph.getState({ configurable: config.configurable });
    return state.values.messages ?? [];
  }
  const before = (await threadMessages()).length;

  let turn: BaseMessage[];
  try {
    const result = await agent.invoke({ messages: [new HumanMessage(input.question)] }, config);
    turn = result.messages.slice(before);
  } catch (err) {
    // The thread now ends in the middle of a question: a tool call without its result, or a
    // question without an answer. The next question would send that to the model, and hosted
    // providers reject such a history. So a question that did not finish is taken out again and
    // the thread is as it was.
    const partial = (await threadMessages()).slice(before);
    await agent.graph.updateState(
      { configurable: config.configurable },
      { messages: removals(partial) },
    );
    const steps = stepsOf(partial);
    if (err instanceof StepLimitError)
      return { stopped: "step_limit", answer: null, citations: [], steps };
    if (input.signal.aborted) throw new AskTimeoutError(steps);
    throw err;
  }

  // The thread keeps the question and the answer, not the tool calls in between. Their results
  // are the bulk of the text, and kept they would be sent again with every later question until
  // a local model's context overflows. A follow-up that needs the passages searches again.
  const last = turn.at(-1);
  const between = turn.filter((message) => message !== last && !(message instanceof HumanMessage));
  if (between.length > 0) {
    await agent.graph.updateState(
      { configurable: config.configurable },
      { messages: removals(between) },
    );
  }

  const answer = last instanceof AIMessage ? last.text : "";
  const citations = verifyCitations(answer, {
    chunk: (id) => getRetrievalChunk(db, id),
    contract: (id) => loadContract({ db, log, context }, id),
  });
  return { stopped: "done", answer, citations, steps: stepsOf(turn) };
}
