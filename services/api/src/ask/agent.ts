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
  type AskPromptVersion,
  type Db,
  type Embedder,
  type ModelSelection,
} from "@nexus/shared/node";
import type { ReadContext } from "../services/dto.js";
import type { ChatModels } from "./chat-models.js";
import { verifyCitations, type CitationSources } from "./citations.js";
import { askPrompt } from "./prompt.js";
import {
  answerFromResults,
  CODE_LOOKUP_NOTE,
  codeLookupMessages,
  isAgentNote,
  isCodeLookup,
  isCodeLookupId,
  isLookupReminder,
  lookupReminder,
  LOOKUP_REMINDER_STEP,
} from "./reminder.js";
import { writeThreadIndex } from "./thread-index.js";
import { listThreadIds } from "./threads.js";
import {
  createAskTools,
  loadContract,
  MAX_QUERY_CHARS,
  prepareToolArgs,
  summaryOf,
} from "./tools.js";

export interface AskDeps {
  db: Db;
  embedder: Embedder;
  chatModels: ChatModels;
  // One checkpoint history per thread_id.
  threads: BaseCheckpointSaver;
  // Model calls per question.
  maxSteps: number;
  promptVersion: AskPromptVersion;
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

// What a question cost. Read from the messages of the question, not from callbacks on the model:
// a callback set on a ChatOpenAI is gone once tools are bound, because bindTools builds a new
// model from the constructor arguments. The first ask eval on gpt-5-mini reported 0 calls and no
// tokens for that reason.
export interface AskUsage {
  // How often the model was called, which is what ASK_MAX_STEPS counts.
  model_calls: number;
  // Null when no call reported usage (the mock).
  tokens: { input: number; output: number } | null;
}

export interface AskResult {
  stopped: "done" | "step_limit";
  answer: string | null;
  citations: AskCitation[];
  steps: AskStep[];
  usage: AskUsage;
}

// The question ran into its time limit. Carries what the agent had done until then.
export class AskTimeoutError extends Error {
  constructor(
    readonly steps: AskStep[],
    readonly usage: AskUsage,
  ) {
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

// Whether a tool has returned something for the question that is being answered. A call that did
// not run because of its arguments is not a lookup.
function lookedUp(messages: readonly BaseMessage[]): boolean {
  const question = messages.findLastIndex((m) => m instanceof HumanMessage && !isAgentNote(m));
  return messages.slice(question + 1).some((m) => m instanceof ToolMessage && m.status !== "error");
}

interface RunRules {
  maxSteps: number;
  // Makes the search the model did not make and returns it as messages.
  lookup: () => Promise<BaseMessage[]>;
}

// The rules of a run that the model does not get a say in:
// - No lookup, no answer. A reply without a tool call, when no tool has returned anything for
//   the question yet, is sent back once with the lookup reminder. When the next reply has no
//   lookup behind it either, the code searches with the question as the query and asks once more
//   for an answer from those results. So an answer either has a tool result in front of it or
//   comes from a run that had no call left to ask again. The price is a search and a third call
//   for a question that needs no lookup ("thanks").
// - A tool call with wrong arguments does not run. The model gets a short message that says what
//   to fix, see prepareToolArgs.
// - The model calls of one question are counted, the ones that were sent back included. When the
//   last allowed call asks for tools again, the run ends there: running them would be work nobody
//   reads.
// The agent is built per question, so the count is too. langchain ships a
// modelCallLimitMiddleware for the last rule, but its types do not compile under
// exactOptionalPropertyTypes and it keeps its count in the thread, where a run that was cut short
// leaves it behind.
function runRules({ maxSteps, lookup }: RunRules) {
  let calls = 0;
  let reminded = false;
  return createMiddleware({
    name: "RunRules",
    wrapToolCall: async (request, handler) => {
      const { toolCall } = request;
      const prepared = prepareToolArgs(toolCall.name, toolCall.args);
      if (prepared.ok) {
        const result = await handler({
          ...request,
          toolCall: { ...toolCall, args: prepared.args },
        });
        if (prepared.note === undefined || !(result instanceof ToolMessage)) return result;
        // After the result, like every note of a tool: outside the <document> block.
        return new ToolMessage({
          content: `${result.text}
${prepared.note}`,
          tool_call_id: result.tool_call_id,
          ...(result.name === undefined ? {} : { name: result.name }),
          ...(result.status === undefined ? {} : { status: result.status }),
        });
      }
      return new ToolMessage({
        content: prepared.message,
        tool_call_id: toolCall.id ?? "",
        name: toolCall.name,
        status: "error",
      });
    },
    afterModel: {
      canJumpTo: ["model"],
      hook: async (state) => {
        calls += 1;
        const last = state.messages.at(-1);
        const wantsTools = last instanceof AIMessage && (last.tool_calls?.length ?? 0) > 0;
        if (calls >= maxSteps && wantsTools) throw new StepLimitError(maxSteps);
        // Not when this was the last call there is: whatever is sent back would have nobody to
        // go to.
        if (wantsTools || calls >= maxSteps || lookedUp(state.messages)) return undefined;
        if (!reminded) {
          reminded = true;
          return { messages: [lookupReminder()], jumpTo: "model" as const };
        }
        return { messages: [answerFromResults(), ...(await lookup())], jumpTo: "model" as const };
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
      const note = isCodeLookupId(call.id) ? CODE_LOOKUP_NOTE : "";
      steps.push({
        tool: call.name,
        input: call.args,
        result: result === undefined ? "not run" : `${note}${summaryOf(result)}`,
      });
    }
  }
  return steps;
}

// What a provider puts on an ai message about the call that made it. The mock leaves it out.
const ReportedUsage = z.object({ input_tokens: z.number(), output_tokens: z.number() });

// The model calls of one question and what they reported. Every ai message is one call, except
// the one that stands for a search the code made.
// Given the messages as the graph produced them, not as the thread stores them: a provider that
// sets the usage on the message after building it (ChatOpenAI on the completions api) loses it
// when the checkpointer writes the message down.
export function usageOf(produced: readonly unknown[]): AskUsage {
  const usage: AskUsage = { model_calls: 0, tokens: null };
  for (const message of produced) {
    if (!(message instanceof AIMessage) || isCodeLookup(message)) continue;
    usage.model_calls += 1;
    const used = ReportedUsage.safeParse(message.usage_metadata);
    if (!used.success) continue;
    usage.tokens = {
      input: (usage.tokens?.input ?? 0) + used.data.input_tokens,
      output: (usage.tokens?.output ?? 0) + used.data.output_tokens,
    };
  }
  return usage;
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
    const note = isCodeLookupId(message.tool_call_id) ? CODE_LOOKUP_NOTE : "";
    return [
      {
        type: "tool_result",
        tool: message.name ?? "tool",
        result: `${note}${summaryOf(message.text)}`,
      },
    ];
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
  const prompt = askPrompt(deps.promptVersion);
  const tools = createAskTools({
    db,
    embedder: deps.embedder,
    log,
    context,
    documentId: input.documentId,
    descriptions: prompt.tools,
  });
  const [, searchClauses] = tools;

  // A search the code makes itself, with the question as the query: the same tool the model
  // would call, so the result counts against the same budget and is limited to the same contract.
  async function codeLookup(): Promise<BaseMessage[]> {
    const args = {
      query: input.question.slice(0, MAX_QUERY_CHARS),
      ...(input.documentId === undefined ? {} : { document_id: input.documentId }),
    };
    const result: unknown = await searchClauses.invoke(args);
    return codeLookupMessages(
      searchClauses.name,
      args,
      typeof result === "string" ? result : JSON.stringify(result),
    );
  }

  const agent = createAgent({
    model: deps.chatModels.create(input.model, input.signal),
    tools,
    systemPrompt: prompt.system(context.today, input.documentId),
    checkpointer: deps.threads,
    middleware: [runRules({ maxSteps: deps.maxSteps, lookup: codeLookup })],
  });
  const thread = { configurable: { thread_id: input.threadId } };

  async function threadMessages(): Promise<BaseMessage[]> {
    const state = await agent.graph.getState(thread);
    return state.values.messages ?? [];
  }
  const before = (await threadMessages()).length;

  // A question about one contract does not wait for the model to ask for a search. The 7b wrote
  // its call as text, "[search_clauses(...)]", and that was the whole answer. So the contract is
  // searched before the first model call and the passages are there when the model first reads
  // the question. Text that looks like a call is never parsed.
  const searched = input.documentId === undefined ? [] : await codeLookup();
  if (input.onProgress !== undefined) searched.flatMap(progressOf).forEach(input.onProgress);

  // Every message a node of the graph added while the question ran.
  const produced: unknown[] = [];
  try {
    // The same run for both endpoints: the stream is read here either way, and whoever wants
    // to watch passes onProgress.
    const stream = await agent.stream(
      { messages: [new HumanMessage(input.question), ...searched] },
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
      if (!update.success) continue;
      for (const node of Object.values(update.data)) {
        for (const message of node?.messages ?? []) {
          produced.push(message);
          if (input.onProgress !== undefined) progressOf(message).forEach(input.onProgress);
        }
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
    const usage = usageOf(produced);
    if (err instanceof StepLimitError)
      return { stopped: "step_limit", answer: null, citations: [], steps, usage };
    if (input.signal.aborted) throw new AskTimeoutError(steps, usage);
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
    usage: usageOf(produced),
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
