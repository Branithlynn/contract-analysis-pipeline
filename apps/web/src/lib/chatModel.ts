import {
  AskTimeoutDetailsSchema,
  type AskCitation,
  type AskStep,
  type AskStreamEvent,
  type ModelSelection,
  type ThreadDetail,
} from "@nexus/shared";

// What the chat shows, worked out from what the api sends. No react in here.

// One line of the trace: what the agent did, and what came back once it has.
export interface StepLine {
  label: string;
  // Null while the tool is still running.
  result: string | null;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

// A tool call in words. The names are the agent's tools, anything else is shown by its name so
// a tool added on the api is still visible here.
export function stepLabel(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case "search_clauses": {
      const query = text(input["query"]);
      const scoped = text(input["document_id"]) !== null;
      const where = scoped ? " in one contract" : "";
      return query === null
        ? `Searching clauses${where}`
        : `Searching clauses${where} for "${query}"`;
    }
    case "find_contracts":
      return "Checking the contracts";
    case "get_contract":
      return "Reading a contract";
    default:
      return `Running ${tool}`;
  }
}

export function stepLines(steps: readonly AskStep[]): StepLine[] {
  return steps.map((step) => ({ label: stepLabel(step.tool, step.input), result: step.result }));
}

export interface Failure {
  // http status, 0 when no response arrived.
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

export type ChatMessage =
  | { id: number; role: "user"; text: string }
  // The agent is working. progress grows with every step event.
  | { id: number; role: "assistant"; phase: "running"; progress: StepLine[] }
  | {
      id: number;
      role: "assistant";
      phase: "answered";
      text: string;
      citations: AskCitation[];
      steps: StepLine[];
      model: ModelSelection | null;
    }
  // It ran and ended without an answer: the step limit or the time limit.
  | { id: number; role: "assistant"; phase: "stopped"; reason: string; steps: StepLine[] }
  // It did not run, or broke. question: what to ask again.
  | { id: number; role: "assistant"; phase: "failed"; reason: string; question: string };

export interface ChatState {
  // Null until the api has named the thread of a new chat.
  threadId: string | null;
  // The contract the chat is about, when it was opened from one.
  documentId: string | null;
  messages: ChatMessage[];
  // An answer is on its way. The input is off while it is.
  running: boolean;
  nextId: number;
}

export type ChatAction =
  | { type: "ask"; question: string }
  | { type: "event"; event: AskStreamEvent }
  // The request failed before or instead of a stream.
  | { type: "failed"; failure: Failure }
  // The user stopped the answer.
  | { type: "stopped" }
  // Takes a failed question out again, before it is asked once more.
  | { type: "dropFailed" }
  | { type: "loaded"; thread: ThreadDetail }
  | { type: "reset"; documentId: string | null };

export function emptyChat(documentId: string | null = null): ChatState {
  return { threadId: null, documentId, messages: [], running: false, nextId: 1 };
}

// Every state in words, without blame and with what to do next.
export function failureText(failure: Failure): string {
  switch (failure.code) {
    case "MODEL_BUSY":
      // The api says which of the two it is: an extraction or another question.
      return failure.message;
    case "THREAD_BUSY":
      return "This conversation is still answering the previous question. Wait for it to finish.";
    case "MODEL_UNAVAILABLE":
      return `This model cannot be used right now: ${failure.message}. Pick another one in the sidebar.`;
    case "MODEL_NOT_RESPONDING":
      return "The model did not respond. Try again in a moment.";
    case "MODEL_FAILED":
      return "The model call did not work. Try again, or pick another model.";
    case "NOT_FOUND":
      return "The contract this chat is about no longer exists. Start a new chat.";
    case "VALIDATION_ERROR":
      return "The question could not be sent as it is. Shorten it and try again.";
    case "NETWORK_ERROR":
    case "STREAM_ENDED":
      return "The connection to the server was lost before the answer arrived. Try again.";
    default:
      return failure.message;
  }
}

export const STOPPED_BY_USER = "Stopped. Nothing of this question was kept.";

function stepLimitText(steps: number): string {
  return `Stopped after ${String(steps)} ${steps === 1 ? "step" : "steps"} without reaching an answer. A more specific question usually needs fewer.`;
}

const TIMEOUT_TEXT =
  "Stopped: no answer within the time limit. A hosted model answers faster than a local one.";

function replaceLast(messages: ChatMessage[], next: (id: number) => ChatMessage): ChatMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant" || last.phase !== "running") return messages;
  return [...messages.slice(0, -1), next(last.id)];
}

function lastQuestion(messages: readonly ChatMessage[]): string {
  const last = messages.findLast((message) => message.role === "user");
  return last?.role === "user" ? last.text : "";
}

function withProgress(lines: StepLine[], event: AskStreamEvent & { event: "step" }): StepLine[] {
  const step = event.data;
  if (step.type === "tool_call") {
    return [...lines, { label: stepLabel(step.tool, step.input), result: null }];
  }
  // Results arrive in the order of their calls, so the first open line is the one.
  const open = lines.findIndex((line) => line.result === null);
  if (open < 0) return lines;
  return lines.map((line, i) => (i === open ? { ...line, result: step.result } : line));
}

function fail(state: ChatState, failure: Failure): ChatState {
  const timeout =
    failure.code === "ASK_TIMEOUT" ? AskTimeoutDetailsSchema.safeParse(failure.details) : null;
  const question = lastQuestion(state.messages);
  return {
    ...state,
    running: false,
    messages: replaceLast(state.messages, (id) =>
      failure.code === "ASK_TIMEOUT"
        ? {
            id,
            role: "assistant",
            phase: "stopped",
            reason: TIMEOUT_TEXT,
            steps: timeout?.success ? stepLines(timeout.data.steps) : [],
          }
        : { id, role: "assistant", phase: "failed", reason: failureText(failure), question },
    ),
  };
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "ask":
      if (state.running) return state;
      return {
        ...state,
        running: true,
        nextId: state.nextId + 2,
        messages: [
          ...state.messages,
          { id: state.nextId, role: "user", text: action.question },
          { id: state.nextId + 1, role: "assistant", phase: "running", progress: [] },
        ],
      };

    case "event": {
      const { event } = action;
      if (event.event === "started") return { ...state, threadId: event.data.thread_id };
      if (event.event === "step") {
        return {
          ...state,
          messages: replaceLast(state.messages, (id) => {
            const last = state.messages.at(-1);
            const progress =
              last?.role === "assistant" && last.phase === "running" ? last.progress : [];
            return {
              id,
              role: "assistant",
              phase: "running",
              progress: withProgress(progress, event),
            };
          }),
        };
      }
      if (event.event === "error")
        return fail(state, { ...event.data.error, status: event.data.status });
      const { data } = event;
      return {
        ...state,
        threadId: data.thread_id,
        running: false,
        messages: replaceLast(state.messages, (id) =>
          data.stopped === "step_limit" || data.answer === null
            ? {
                id,
                role: "assistant",
                phase: "stopped",
                reason: stepLimitText(data.steps.length),
                steps: stepLines(data.steps),
              }
            : {
                id,
                role: "assistant",
                phase: "answered",
                text: data.answer,
                citations: data.citations,
                steps: stepLines(data.steps),
                model: data.model,
              },
        ),
      };
    }

    case "failed":
      return fail(state, action.failure);

    case "stopped":
      return {
        ...state,
        running: false,
        messages: replaceLast(state.messages, (id) => ({
          id,
          role: "assistant",
          phase: "failed",
          reason: STOPPED_BY_USER,
          question: lastQuestion(state.messages),
        })),
      };

    case "dropFailed": {
      const last = state.messages.at(-1);
      if (last?.role !== "assistant" || last.phase !== "failed") return state;
      return { ...state, messages: state.messages.slice(0, -2) };
    }

    case "loaded": {
      let nextId = 1;
      return {
        threadId: action.thread.thread_id,
        documentId: action.thread.document_id,
        running: false,
        messages: action.thread.messages.map((message): ChatMessage =>
          message.role === "user"
            ? { id: nextId++, role: "user", text: message.text }
            : {
                id: nextId++,
                role: "assistant",
                phase: "answered",
                text: message.text,
                citations: message.citations,
                steps: stepLines(message.steps),
                model: message.model,
              },
        ),
        nextId,
      };
    }

    case "reset":
      return emptyChat(action.documentId);
  }
}

export type AnswerPart =
  | { kind: "text"; text: string }
  // number: the same source has the same number wherever it is cited.
  | { kind: "citation"; citation: AskCitation; number: number };

// The answer cut at its citation markers, so each one can be drawn as a link in place.
export function answerParts(answer: string, citations: readonly AskCitation[]): AnswerPart[] {
  const parts: AnswerPart[] = [];
  const numbers = new Map<string, number>();
  let at = 0;
  for (const citation of [...citations].sort((a, b) => a.start - b.start)) {
    const end = citation.start + citation.marker.length;
    // A citation that is not where it says it is would cut the text in the wrong place.
    if (citation.start < at || answer.slice(citation.start, end) !== citation.marker) continue;
    if (citation.start > at) parts.push({ kind: "text", text: answer.slice(at, citation.start) });
    const key = `${citation.kind}:${citation.id}`;
    const number = numbers.get(key) ?? numbers.size + 1;
    numbers.set(key, number);
    parts.push({ kind: "citation", citation, number });
    at = end;
  }
  if (at < answer.length) parts.push({ kind: "text", text: answer.slice(at) });
  return parts;
}

function pages(citation: AskCitation): string {
  if (citation.page_start === null) return "";
  return citation.page_end === null || citation.page_end === citation.page_start
    ? `, page ${String(citation.page_start)}`
    : `, pages ${String(citation.page_start)} to ${String(citation.page_end)}`;
}

// What a citation says when pointed at or read out.
export function citationTitle(citation: AskCitation): string {
  if (citation.status === "not_found") {
    return citation.kind === "chunk"
      ? "Not verified: the cited passage does not exist"
      : "Not verified: the cited contract does not exist";
  }
  const source = `${citation.file_name ?? "contract"}${pages(citation)}`;
  return citation.status === "verified"
    ? source
    : `Not verified: the quoted words are not in ${source}`;
}

export interface CitationTarget {
  documentId: string;
  // The passage to show in the document, for a citation of a chunk.
  passage: { chunkId: number; quote: string | null } | null;
}

// Where a click on a citation goes. Null when there is nothing to open.
export function citationTarget(citation: AskCitation): CitationTarget | null {
  if (citation.status === "not_found" || citation.document_id === null) return null;
  if (citation.kind === "contract") return { documentId: citation.document_id, passage: null };
  const quote = citation.quotes.find((q) => q.found)?.text ?? null;
  return { documentId: citation.document_id, passage: { chunkId: Number(citation.id), quote } };
}

export function unverifiedCount(citations: readonly AskCitation[]): number {
  return citations.filter((citation) => citation.status !== "verified").length;
}

// The text with every run of whitespace as one space, lowercased, and where each of its
// characters came from. The model copies a quote without the pdf's line breaks.
function loose(value: string): { flat: string; offsets: number[] } {
  let flat = "";
  const offsets: number[] = [];
  let gap = false;
  for (let i = 0; i < value.length; i++) {
    const char = value.charAt(i);
    if (/\s/.test(char)) {
      gap = flat !== "";
      continue;
    }
    if (gap) {
      flat += " ";
      offsets.push(i - 1);
      gap = false;
    }
    // One lowercase character each, so the offsets stay in step.
    flat += char.toLowerCase().charAt(0);
    offsets.push(i);
  }
  return { flat, offsets };
}

export interface Highlight {
  before: string;
  match: string;
  after: string;
}

// The passage split around the quote. Null when the quote is not in it letter for letter (the
// citation check also accepts near matches, and those have no exact place to mark).
export function highlightQuote(passage: string, quote: string | null): Highlight | null {
  if (quote === null) return null;
  const needle = loose(quote).flat;
  if (needle === "") return null;
  const { flat, offsets } = loose(passage);
  const at = flat.indexOf(needle);
  const first = offsets[at];
  const last = offsets[at + needle.length - 1];
  if (at < 0 || first === undefined || last === undefined) return null;
  return {
    before: passage.slice(0, first),
    match: passage.slice(first, last + 1),
    after: passage.slice(last + 1),
  };
}
