import {
  CircleStop,
  CornerDownLeft,
  FileText,
  Plus,
  RotateCw,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { AskCitation, ThreadSummary } from "@nexus/shared";
import { useDocuments, useThreads } from "../api/hooks.js";
import { useChat } from "../lib/chat.js";
import {
  answerParts,
  citationTarget,
  citationTitle,
  unverifiedCount,
  type AnswerPart,
  type ChatMessage,
  type CitationTarget,
  type StepLine,
} from "../lib/chatModel.js";
import { formatDateTime, plural } from "../lib/format.js";
import { useModelChoice } from "../lib/modelChoice.js";
import { resultModelLabel } from "../lib/modelPicker.js";
import { readRoute, routeHref, useRoute } from "../lib/route.js";
import { isPlainClick } from "../lib/selection.js";
import { SearchField, useDebounced } from "./SearchField.js";
import { useToast } from "./Toasts.js";

interface Props {
  // Opens the document a citation points at, with the cited passage when there is one.
  onOpenCitation: (target: CitationTarget) => void;
}

// Questions that the three tools can answer, to start from.
const STARTERS = [
  "Which contracts renew automatically?",
  "Which notice deadlines come up in the next 90 days?",
  "Which contracts have no cap on liability?",
];
const STARTERS_ABOUT = [
  "How can this contract be terminated?",
  "What is the most the vendor can be made to pay?",
  "What are the payment terms?",
];

function Steps({ lines, working }: { lines: readonly StepLine[]; working?: boolean }) {
  return (
    <ol className="plain-list chat-steps">
      {lines.map((line, index) => (
        <li key={index} className={line.result === null ? "chat-step chat-step-open" : "chat-step"}>
          <span>{line.label}</span>
          {line.result === null ? (
            working && <span className="tone-muted">…</span>
          ) : (
            <span className="tone-muted">{line.result}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

function Citation({
  part,
  onOpen,
}: {
  part: Extract<AnswerPart, { kind: "citation" }>;
  onOpen: Props["onOpenCitation"];
}) {
  const { citation, number } = part;
  const target = citationTarget(citation);
  const verified = citation.status === "verified";
  const title = citationTitle(citation);
  return (
    // aria-disabled and not disabled: a citation with nothing to open still says why on focus.
    <button
      type="button"
      className={verified ? "cite" : "cite cite-unverified"}
      title={title}
      aria-label={`Source ${String(number)}: ${title}`}
      aria-disabled={target === null}
      onClick={() => {
        if (target !== null) onOpen(target);
      }}
    >
      {!verified && <TriangleAlert size={11} aria-hidden="true" />}
      {number}
    </button>
  );
}

// Each source once, under the number it has in the text.
function Sources({
  parts,
  onOpen,
}: {
  parts: readonly AnswerPart[];
  onOpen: Props["onOpenCitation"];
}) {
  const sources = new Map<number, AskCitation[]>();
  for (const part of parts) {
    if (part.kind !== "citation") continue;
    sources.set(part.number, [...(sources.get(part.number) ?? []), part.citation]);
  }
  if (sources.size === 0) return null;
  return (
    <ol className="plain-list chat-sources" aria-label="Sources">
      {[...sources].map(([number, citations]) => {
        // The same source cited twice is unverified as soon as one of the two is.
        const citation = citations.find((c) => c.status !== "verified") ?? citations[0];
        if (!citation) return null;
        const target = citationTarget(citation);
        const verified = citation.status === "verified";
        return (
          <li
            key={number}
            className={verified ? "chat-source" : "chat-source chat-source-unverified"}
          >
            <span className="chat-source-number">{number}</span>
            {target === null ? (
              <span>{citationTitle(citation)}</span>
            ) : (
              <button type="button" className="link-button" onClick={() => onOpen(target)}>
                {citationTitle(citation)}
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Answer({
  message,
  onOpen,
}: {
  message: Extract<ChatMessage, { phase: "answered" }>;
  onOpen: Props["onOpenCitation"];
}) {
  const parts = answerParts(message.text, message.citations);
  const unverified = unverifiedCount(message.citations);
  const cited = message.citations.length;
  return (
    <>
      <p className="chat-text">
        {parts.map((part, index) =>
          part.kind === "text" ? (
            <span key={index}>{part.text}</span>
          ) : (
            <Citation key={index} part={part} onOpen={onOpen} />
          ),
        )}
      </p>
      {unverified > 0 && (
        <p className="notice notice-warn">
          <TriangleAlert size={15} aria-hidden="true" />
          {unverified === cited
            ? "None of the citations in this answer could be verified. Check it against the contracts before relying on it."
            : `${String(unverified)} of ${String(cited)} citations could not be verified. They are marked in the text.`}
        </p>
      )}
      {cited === 0 && (
        <p className="chat-note">This answer cites no source, so nothing in it was checked.</p>
      )}
      <Sources parts={parts} onOpen={onOpen} />
      <details className="chat-trace">
        <summary>
          {message.steps.length === 0
            ? "Answered without looking anything up"
            : `How this was answered (${plural(message.steps.length, "step")})`}
          {message.model !== null && (
            <span className="tag">
              {resultModelLabel(message.model.provider, message.model.model)}
            </span>
          )}
        </summary>
        {message.steps.length > 0 && <Steps lines={message.steps} />}
      </details>
    </>
  );
}

function Turn({
  message,
  onOpen,
  onAskAgain,
}: {
  message: ChatMessage;
  onOpen: Props["onOpenCitation"];
  onAskAgain: (() => void) | null;
}) {
  if (message.role === "user") {
    return (
      <li className="chat-turn chat-user">
        <span className="visually-hidden">You asked: </span>
        <p className="chat-text">{message.text}</p>
      </li>
    );
  }
  return (
    <li className="chat-turn chat-assistant">
      <span className="visually-hidden">Answer: </span>
      {message.phase === "running" && (
        // Read out as it grows, without interrupting.
        <div role="status" className="chat-working">
          <Steps lines={message.progress} working />
          <p className="chat-working-line">
            <RotateCw size={14} aria-hidden="true" className="spin" />
            {message.progress.length === 0
              ? "Reading the question"
              : message.progress.every((line) => line.result !== null)
                ? "Working on the answer"
                : "Looking it up"}
          </p>
        </div>
      )}
      {message.phase === "answered" && <Answer message={message} onOpen={onOpen} />}
      {message.phase === "stopped" && (
        <>
          <p className="notice notice-warn">
            <TriangleAlert size={15} aria-hidden="true" />
            {message.reason}
          </p>
          {message.steps.length > 0 && (
            <>
              <p className="chat-note">What it did before it stopped:</p>
              <Steps lines={message.steps} />
            </>
          )}
        </>
      )}
      {message.phase === "failed" && (
        <div className="chat-failed">
          <p>{message.reason}</p>
          {onAskAgain !== null && (
            <button type="button" className="button" onClick={onAskAgain}>
              <RotateCw size={14} aria-hidden="true" />
              Ask again
            </button>
          )}
        </div>
      )}
    </li>
  );
}

// Longer than the documents search waits: every settled value here is a request.
const THREAD_SEARCH_DEBOUNCE_MS = 250;

function Threads({
  currentId,
  onOpen,
}: {
  currentId: string | null;
  onOpen: (thread: ThreadSummary) => void;
}) {
  const headingId = useId();
  const [text, setText] = useState("");
  const query = useDebounced(text, THREAD_SEARCH_DEBOUNCE_MS).trim();
  const threads = useThreads(query);
  const searchRef = useRef<HTMLInputElement>(null);
  return (
    <aside className="chat-threads" aria-labelledby={headingId}>
      <h2 id={headingId}>Earlier chats</h2>
      <SearchField label="Search chats" value={text} onChange={setText} inputRef={searchRef} />
      {threads.data === undefined ? (
        threads.error ? (
          <p className="tone-error small">Could not load them: {threads.error.message}</p>
        ) : (
          <div className="skeleton-stack" aria-label="Loading earlier chats">
            <span className="skeleton" />
            <span className="skeleton" />
          </div>
        )
      ) : threads.data.length === 0 ? (
        query === "" ? (
          <p className="tone-muted small">None yet. A chat shows up here after its first answer.</p>
        ) : (
          <div className="chat-threads-empty" role="status">
            <p className="small">No chats match “{query}”</p>
            <p className="tone-muted small">The search looks at titles and at what was said.</p>
            <button
              type="button"
              className="button"
              onClick={() => {
                setText("");
                searchRef.current?.focus();
              }}
            >
              Clear the search
            </button>
          </div>
        )
      ) : (
        <ul className="plain-list chat-thread-list">
          {threads.data.map((thread) => (
            <li key={thread.thread_id}>
              <a
                className="chat-thread-link"
                href={routeHref("", { view: "chat", threadId: thread.thread_id, aboutId: null })}
                aria-current={thread.thread_id === currentId ? "true" : undefined}
                onClick={(event) => {
                  if (!isPlainClick(event)) return;
                  event.preventDefault();
                  onOpen(thread);
                }}
              >
                <span className="chat-thread-title">{thread.title}</span>
                {thread.snippet != null && (
                  <span className="chat-thread-snippet">
                    {thread.snippet.map((part, index) =>
                      part.match ? (
                        <mark key={index}>{part.text}</mark>
                      ) : (
                        <span key={index}>{part.text}</span>
                      ),
                    )}
                  </span>
                )}
                <span className="chat-thread-when">{formatDateTime(thread.updated_at)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

export function ChatView({ onOpenCitation }: Props) {
  const { state, ask, stop, askAgain, newChat, openThread } = useChat();
  const [, navigate] = useRoute();
  const { selected, picker } = useModelChoice();
  const documents = useDocuments();
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLLIElement>(null);
  const inputId = useId();

  // What the address asks for when the page is opened or reloaded: a thread, or a new chat
  // about one contract. Once only: after that the chat decides and the address follows it.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    const initial = readRoute(window.location.search);
    if (initial.threadId !== null && initial.threadId !== state.threadId) {
      openThread(initial.threadId).catch(() => {
        toast("That chat could not be loaded, so this is a new one", "error");
        newChat(null);
      });
    } else if (initial.aboutId !== null && state.messages.length === 0) {
      newChat(initial.aboutId);
    }
  }, [openThread, newChat, toast, state.threadId, state.messages.length]);

  // The address follows the chat. replace: a new chat getting its thread id is not a page to go
  // back to.
  const { threadId, documentId } = state;
  useEffect(() => {
    if (!opened.current) return;
    navigate(
      { view: "chat", threadId, aboutId: threadId === null ? documentId : null },
      { replace: true },
    );
  }, [threadId, documentId, navigate]);

  // Keeps the newest step or answer in view. Instant: a smooth scroll on every step of a long
  // answer is motion nobody asked for.
  const last = state.messages.at(-1);
  const progress = last?.role === "assistant" && last.phase === "running" ? last.progress : null;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [state.messages.length, progress, last]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (state.running || draft.trim() === "") return;
    ask(draft);
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, shift+enter is a new line. Not while an input method is composing a character.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  function startNew() {
    newChat(null);
    setDraft("");
    inputRef.current?.focus();
  }

  const about = documentId === null ? null : documents.data?.find((doc) => doc.id === documentId);
  const aboutName = documentId === null ? null : (about?.original_name ?? "one contract");
  const empty = state.messages.length === 0;
  const noModel = picker !== undefined && selected === null;
  const lastFailed = last?.role === "assistant" && last.phase === "failed";

  return (
    <div className="chat">
      <div className="chat-head">
        <h1>Chat</h1>
        <button type="button" className="button" onClick={startNew}>
          <Plus size={14} aria-hidden="true" />
          New chat
        </button>
      </div>

      <div className="chat-layout">
        <section className="chat-thread" aria-label="Conversation">
          {aboutName !== null && (
            <p className="chat-scope">
              <FileText size={14} aria-hidden="true" />
              <span>
                About <strong>{aboutName}</strong>. Searches only look in this contract.
              </span>
              {empty && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Ask about all contracts instead"
                  title="Ask about all contracts instead"
                  onClick={() => newChat(null)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </p>
          )}

          {/* The one part of the conversation that scrolls. The composer under it stays put. */}
          <div className="chat-scroll">
            {empty ? (
              <div className="chat-empty">
                <p className="empty-title">
                  {aboutName === null ? "Ask about the contracts" : "Ask about this contract"}
                </p>
                <p className="tone-muted">
                  Answers come from the analyzed contracts and say where each statement is from.
                  Every citation is checked against its source before you see it.
                </p>
                <ul className="plain-list chat-starters">
                  {(aboutName === null ? STARTERS : STARTERS_ABOUT).map((question) => (
                    <li key={question}>
                      <button
                        type="button"
                        className="button"
                        disabled={state.running}
                        onClick={() => ask(question)}
                      >
                        {question}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <ol className="plain-list chat-messages">
                {state.messages.map((message, index) => (
                  <Turn
                    key={message.id}
                    message={message}
                    onOpen={onOpenCitation}
                    onAskAgain={lastFailed && index === state.messages.length - 1 ? askAgain : null}
                  />
                ))}
                <li ref={endRef} aria-hidden="true" />
              </ol>
            )}
          </div>

          <form className="chat-composer" onSubmit={submit}>
            <label htmlFor={inputId} className="visually-hidden">
              Question
            </label>
            <textarea
              id={inputId}
              ref={inputRef}
              rows={2}
              maxLength={2000}
              placeholder={
                state.running
                  ? "Waiting for the answer"
                  : empty
                    ? "Ask a question"
                    : "Ask a follow-up"
              }
              value={draft}
              // Off while an answer is running: a thread takes one question at a time.
              disabled={state.running}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
            />
            <div className="chat-composer-row">
              <span className={noModel ? "tone-warn small" : "tone-muted small"}>
                {noModel
                  ? "No model is available. Start ollama or set an api key, then check again in the sidebar."
                  : selected === null
                    ? "Answers use the default model"
                    : `Answers use ${resultModelLabel(selected.provider, selected.model)}`}
              </span>
              {state.running ? (
                <button type="button" className="button" onClick={stop}>
                  <CircleStop size={14} aria-hidden="true" />
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={draft.trim() === ""}
                >
                  <CornerDownLeft size={14} aria-hidden="true" />
                  Ask
                </button>
              )}
            </div>
          </form>
        </section>

        <Threads
          currentId={state.threadId}
          onOpen={(thread) => {
            openThread(thread.thread_id).catch(() => {
              toast("That chat could not be loaded", "error");
            });
          }}
        />
      </div>
    </div>
  );
}
