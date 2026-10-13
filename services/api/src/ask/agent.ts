import { AIMessage, HumanMessage, RemoveMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { FastifyBaseLogger } from "fastify";
import { createAgent, createMiddleware } from "langchain";
import { z } from "zod";
import {
  AskStepSchema,
  ModelSelectionSchema,
  type AskCitation,
  type AskProgress,
  type AskStep,
  type ThreadMessage,
} from "@nexus/shared";
import {
  getRetrievalChunk,
  listIndexedThreadIds,
  type Db,
  type Embedder,
  type ModelSelection,
} from "@nexus/shared/node";
import type { ReadContext } from "../services/dto.js";
import type { ChatModels } from "./chat-models.js";
import { verifyCitations, type CitationSources } from "./citations.js";
import { buildAskSystemPrompt } from "./prompt.js";
import { isLookupReminder, lookupReminder, LOOKUP_REMINDER_STEP } from "./reminder.js";
import { writeThreadIndex } from "./thread-index.js";
import { listThreadIds } from "./threads.js";
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
  // The question is about this one contract: searches are limited to it.
  documentId?: string | undefined;
  // The limit of the whole question. Aborted by the route's timeout, or when the client left.
  signal: AbortSignal;
  log: FastifyBaseLogger;
  context: ReadContext;
  // Called for every tool the model asks for and for every result, while the agent works.
  onProgress?: ((progress: AskProgress) => void) | undefined;
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

// The two rules of a run that the model does not get a say in:
// - A first reply without a tool call is sent back once with the lookup reminder. Once: a second
//   reply without one is taken as the answer, the question may really not need a lookup.
// - The model calls of one question are counted, the one that was sent back included. When the
//   last allowed call asks for tools again, the run ends there: running them would be work nobody
//   reads.
// The agent is built per question, so the count is too. langchain ships a
// modelCallLimitMiddleware for the second rule, but its types do not compile under
// exactOptionalPropertyTypes and it keeps its count in the thread, where a run that was cut short
// leaves it behind.
function runRules(maxSteps: number) {
  let calls = 0;
  return createMiddleware({
    name: "RunRules",
    afterModel: {
      canJumpTo: ["model"],
      hook: (state) => {
        calls += 1;
        const last = state.messages.at(-1);
        const wantsTools = last instanceof AIMessage && (last.tool_calls?.length ?? 0) > 0;
        if (calls >= maxSteps && wantsTools) throw new StepLimitError(maxSteps);
        // Not when this was the only call there is: the reminder would have nobody to go to.
        if (calls === 1 && !wantsTools && maxSteps > 1) {
          return {
            messages: [lookupReminder()],
            jumpTo: "model" as const,
          };
        }
        return undefined;
      },
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
    if (isLookupReminder(message)) steps.push(LOOKUP_REMINDER_STEP);
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

// What an answer carries in the thread besides its text, so the conversation can be shown again
// after a reload: the trace, the model and the contract it was about. Kept in the message's
// response_metadata, which langchain stores with the message and does not send to a provider.
const METADATA_KEY = "nexus_ask";
const AnswerMetadata = z.object({
  steps: z.array(AskStepSchema),
  model: ModelSelectionSchema.nullable(),
  document_id: z.string().nullable(),
});
type AnswerMetadata = z.infer<typeof AnswerMetadata>;

function metadataOf(message: BaseMessage): AnswerMetadata {
  const parsed = AnswerMetadata.safeParse(message.response_metadata[METADATA_KEY]);
  return parsed.success ? parsed.data : { steps: [], model: null, document_id: null };
}

function citationSources(deps: Pick<AskInput, "log" | "context"> & { db: Db }): CitationSources {
  return {
    chunk: (id) => getRetrievalChunk(deps.db, id),
    contract: (id) => loadContract(deps, id),
  };
}

// One event per message the graph produced: the model asking for tools, or a tool's result.
function progressOf(message: unknown): AskProgress[] {
  if (message instanceof AIMessage) {
    return (message.tool_calls ?? []).map((call) => ({
      type: "tool_call",
      tool: call.name,
      input: call.args,
    }));
  }
  if (message instanceof ToolMessage) {
    return [{ type: "tool_result", tool: message.name ?? "tool", result: summaryOf(message.text) }];
  }
  if (message instanceof HumanMessage && isLookupReminder(message)) {
    return [
      { type: "tool_call", tool: LOOKUP_REMINDER_STEP.tool, input: {} },
      { type: "tool_result", tool: LOOKUP_REMINDER_STEP.tool, result: LOOKUP_REMINDER_STEP.result },
    ];
  }
  return [];
}

// The shape of one item of langgraph's "updates" stream that matters here: what each node that
// ran added to the messages. Nodes that add none (the step limit) have no messages key.
const GraphUpdate = z.record(
  z.string(),
  z.object({ messages: z.array(z.unknown()).optional() }).nullish(),
);

export async function runAsk(deps: AskDeps, input: AskInput): Promise<AskResult> {
  const { db, log, context } = { ...deps, ...input };
  const agent = createAgent({
    model: deps.chatModels.create(input.model, input.signal),
    tools: createAskTools({
      db,
      embedder: deps.embedder,
      log,
      context,
      documentId: input.documentId,
    }),
    systemPrompt: buildAskSystemPrompt(context.today, input.documentId),
    checkpointer: deps.threads,
    middleware: [runRules(deps.maxSteps)],
  });
  const thread = { configurable: { thread_id: input.threadId } };

  async function threadMessages(): Promise<BaseMessage[]> {
    const state = await agent.graph.getState(thread);
    return state.values.messages ?? [];
  }
  const before = (await threadMessages()).length;

  try {
    // The same run for both endpoints: the stream is read here either way, and whoever wants
    // to watch passes onProgress.
    const stream = await agent.stream(
      { messages: [new HumanMessage(input.question)] },
      {
        ...thread,
        signal: input.signal,
        streamMode: "updates",
        // langgraph's own limit counts graph steps, several per model call, and is not what
        // ASK_MAX_STEPS means. It only has to stay out of the way of the step limit above.
        recursionLimit: 10 * deps.maxSteps + 10,
      },
    );
    for await (const item of stream) {
      const update = GraphUpdate.safeParse(item);
      if (!update.success || input.onProgress === undefined) continue;
      for (const node of Object.values(update.data)) {
        for (const message of node?.messages ?? []) progressOf(message).forEach(input.onProgress);
      }
    }
  } catch (err) {
    // The thread now ends in the middle of a question: a tool call without its result, or a
    // question without an answer. The next question would send that to the model, and hosted
    // providers reject such a history. So a question that did not finish is taken out again and
    // the thread is as it was.
    const partial = (await threadMessages()).slice(before);
    await agent.graph.updateState(thread, { messages: removals(partial) });
    const steps = stepsOf(partial);
    if (err instanceof StepLimitError)
      return { stopped: "step_limit", answer: null, citations: [], steps };
    if (input.signal.aborted) throw new AskTimeoutError(steps);
    throw err;
  }

  const turn = (await threadMessages()).slice(before);
  const steps = stepsOf(turn);
  const last = turn.at(-1);
  const answer = last instanceof AIMessage ? last.text : "";

  // The thread keeps the question and the answer, not the tool calls in between. Their results
  // are the bulk of the text, and kept they would be sent again with every later question until
  // a local model's context overflows. A follow-up that needs the passages searches again.
  // The answer is written back with the trace attached: a message with the id of one that is
  // there replaces it.
  // Everything between the two goes, the reminder and the reply it answered included.
  const between = turn.slice(1, -1);
  const metadata: AnswerMetadata = {
    steps,
    model: input.model,
    document_id: input.documentId ?? null,
  };
  const kept =
    last instanceof AIMessage && last.id !== undefined
      ? [
          new AIMessage({
            id: last.id,
            content: last.content,
            additional_kwargs: last.additional_kwargs,
            response_metadata: { ...last.response_metadata, [METADATA_KEY]: metadata },
          }),
        ]
      : [];
  await agent.graph.updateState(thread, { messages: [...removals(between), ...kept] });

  // Only here, after a turn that finished: the paths above that roll a question back return or
  // throw before this, so the search index never holds a question the thread does not.
  try {
    await indexThread({ db, threads: deps.threads, log, context }, input.threadId);
  } catch (err) {
    // The answer is there and the thread has it. Search finds the chat again after the next
    // turn or the next startup.
    log.warn({ threadId: input.threadId, err }, "could not update the thread search index");
  }

  return {
    stopped: "done",
    answer,
    citations: verifyCitations(answer, citationSources({ db, log, context })),
    steps,
  };
}

export interface StoredThread {
  messages: ThreadMessage[];
  // The contract the newest answer was about.
  document_id: string | null;
  updated_at: string;
}

const Checkpoint = z.object({
  ts: z.iso.datetime(),
  channel_values: z.object({ messages: z.array(z.unknown()).optional() }),
});

// A thread as the chat shows it: questions and answers in order, each answer with its trace and
// its citations checked against the index as it is now. Undefined when the thread has no
// messages, which is also what a thread looks like whose only question never finished.
export async function readThread(
  deps: { db: Db; threads: BaseCheckpointSaver } & Pick<AskInput, "log" | "context">,
  threadId: string,
  // False for the list of threads, which shows no citations and would check them for nothing.
  withCitations = true,
): Promise<StoredThread | undefined> {
  const tuple = await deps.threads.getTuple({ configurable: { thread_id: threadId } });
  const checkpoint = Checkpoint.safeParse(tuple?.checkpoint);
  if (!checkpoint.success) return undefined;

  const sources = citationSources(deps);
  const messages: ThreadMessage[] = [];
  let documentId: string | null = null;
  for (const message of checkpoint.data.channel_values.messages ?? []) {
    if (message instanceof HumanMessage) {
      messages.push({ role: "user", text: message.text });
    } else if (message instanceof AIMessage && (message.tool_calls?.length ?? 0) === 0) {
      const metadata = metadataOf(message);
      documentId = metadata.document_id;
      messages.push({
        role: "assistant",
        text: message.text,
        citations: withCitations ? verifyCitations(message.text, sources) : [],
        steps: metadata.steps,
        model: metadata.model,
      });
    }
  }
  if (messages.length === 0) return undefined;
  return { messages, document_id: documentId, updated_at: checkpoint.data.ts };
}

type ThreadDeps = Parameters<typeof readThread>[0];

// Writes the thread as it is now to the search index over earlier chats. Read back from the
// store, not taken from the turn that just ran, so the index holds what a reload shows.
// Returns false for a thread without a finished turn.
export async function indexThread(deps: ThreadDeps, threadId: string): Promise<boolean> {
  const thread = await readThread(deps, threadId, false);
  return thread !== undefined && writeThreadIndex(deps.db, threadId, thread);
}

// For api startup: the threads from before the index existed. Only the ones without a row, so a
// restart with everything indexed reads no thread at all. Returns how many were added.
export async function backfillThreadIndex(deps: ThreadDeps): Promise<number> {
  const indexed = new Set(listIndexedThreadIds(deps.db));
  let added = 0;
  for (const threadId of listThreadIds(deps.db)) {
    if (indexed.has(threadId)) continue;
    if (await indexThread(deps, threadId)) added += 1;
  }
  return added;
}
