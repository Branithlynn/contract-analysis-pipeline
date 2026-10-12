import { describe, expect, it } from "vitest";
import type { AskCitation, AskResponse, AskStreamEvent, ThreadDetail } from "@nexus/shared";
import {
  answerParts,
  chatReducer,
  citationTarget,
  citationTitle,
  emptyChat,
  failureText,
  highlightQuote,
  stepLabel,
  stepLines,
  STOPPED_BY_USER,
  unverifiedCount,
  type ChatAction,
  type ChatState,
} from "./chatModel.js";
import { readRoute, routeHref } from "./route.js";

const MODEL = { provider: "ollama", model: "qwen2.5:7b-instruct" } as const;
const DOC = "00000000-0000-4000-8000-000000000001";

function citation(overrides: Partial<AskCitation> = {}): AskCitation {
  return {
    marker: "[chunk:7]",
    start: 0,
    kind: "chunk",
    id: "7",
    status: "verified",
    document_id: DOC,
    file_name: "msa.pdf",
    page_start: 5,
    page_end: 5,
    quotes: [],
    ...overrides,
  };
}

function done(overrides: Partial<AskResponse> = {}): AskStreamEvent {
  return {
    event: "done",
    data: {
      thread_id: "t1",
      model: MODEL,
      stopped: "done",
      answer: "The cap is the fees of 12 months [chunk:7].",
      citations: [citation({ start: 33 })],
      steps: [{ tool: "search_clauses", input: { query: "liability" }, result: "4 passages" }],
      ...overrides,
    },
  };
}

const started: AskStreamEvent = { event: "started", data: { thread_id: "t1", model: MODEL } };
const call = (tool: string, input: Record<string, unknown> = {}): AskStreamEvent => ({
  event: "step",
  data: { type: "tool_call", tool, input },
});
const result = (tool: string, text: string): AskStreamEvent => ({
  event: "step",
  data: { type: "tool_result", tool, result: text },
});

function run(actions: ChatAction[], from: ChatState = emptyChat()): ChatState {
  return actions.reduce(chatReducer, from);
}

const events = (...list: AskStreamEvent[]): ChatAction[] =>
  list.map((event) => ({ type: "event", event }));

describe("stepLabel", () => {
  it("says what each tool is doing in words", () => {
    expect(stepLabel("search_clauses", { query: "liability limited to fees" })).toBe(
      'Searching clauses for "liability limited to fees"',
    );
    expect(stepLabel("search_clauses", { query: "notice", document_id: DOC })).toBe(
      'Searching clauses in one contract for "notice"',
    );
    expect(stepLabel("search_clauses", {})).toBe("Searching clauses");
    expect(stepLabel("find_contracts", { auto_renewal: true })).toBe("Checking the contracts");
    expect(stepLabel("get_contract", { id: DOC })).toBe("Reading a contract");
  });

  it("shows a tool it does not know by name", () => {
    expect(stepLabel("compare_contracts", {})).toBe("Running compare_contracts");
  });
});

describe("chatReducer: asking", () => {
  it("adds the question and a running answer, and turns the input off", () => {
    const state = run([{ type: "ask", question: "Which contracts renew?" }]);

    expect(state.running).toBe(true);
    expect(state.messages).toEqual([
      { id: 1, role: "user", text: "Which contracts renew?" },
      { id: 2, role: "assistant", phase: "running", progress: [] },
    ]);
  });

  it("ignores a second question while one is running", () => {
    const first = run([{ type: "ask", question: "One" }]);

    expect(chatReducer(first, { type: "ask", question: "Two" })).toBe(first);
  });

  it("takes the thread id from the started event", () => {
    const state = run([{ type: "ask", question: "Q" }, ...events(started)]);

    expect(state.threadId).toBe("t1");
    expect(state.running).toBe(true);
  });

  it("shows each step as it starts and fills in its result when it comes", () => {
    const asked = run([{ type: "ask", question: "Q" }, ...events(started)]);
    const searching = run(events(call("find_contracts")), asked);
    expect(searching.messages.at(-1)).toMatchObject({
      phase: "running",
      progress: [{ label: "Checking the contracts", result: null }],
    });

    const more = run(
      events(result("find_contracts", "3 of 5 contracts match"), call("get_contract")),
      searching,
    );
    expect(more.messages.at(-1)).toMatchObject({
      progress: [
        { label: "Checking the contracts", result: "3 of 5 contracts match" },
        { label: "Reading a contract", result: null },
      ],
    });
  });

  it("gives two tools asked for at once their results in order", () => {
    const state = run([
      { type: "ask", question: "Q" },
      ...events(
        call("search_clauses", { query: "a" }),
        call("search_clauses", { query: "b" }),
        result("search_clauses", "1 passage"),
        result("search_clauses", "2 passages"),
      ),
    ]);

    expect(state.messages.at(-1)).toMatchObject({
      progress: [{ result: "1 passage" }, { result: "2 passages" }],
    });
  });

  it("replaces the running answer with the answer, its citations and its trace", () => {
    const state = run([
      { type: "ask", question: "Q" },
      ...events(started, call("search_clauses"), result("search_clauses", "4 passages"), done()),
    ]);

    expect(state.running).toBe(false);
    expect(state.messages).toHaveLength(2);
    expect(state.messages.at(-1)).toEqual({
      id: 2,
      role: "assistant",
      phase: "answered",
      text: "The cap is the fees of 12 months [chunk:7].",
      citations: [citation({ start: 33 })],
      steps: [{ label: 'Searching clauses for "liability"', result: "4 passages" }],
      model: MODEL,
    });
  });

  it("numbers the messages of a follow-up after the ones before it", () => {
    const state = run([
      { type: "ask", question: "One" },
      ...events(done()),
      { type: "ask", question: "Two" },
    ]);

    expect(state.messages.map((m) => m.id)).toEqual([1, 2, 3, 4]);
    expect(state.threadId).toBe("t1");
  });
});

describe("chatReducer: answers that did not come", () => {
  const asked = run([{ type: "ask", question: "Which contracts renew?" }, ...events(started)]);

  it("shows the steps that ran and says it stopped at the step limit", () => {
    const state = run(
      events(
        done({
          stopped: "step_limit",
          answer: null,
          citations: [],
          steps: [
            { tool: "find_contracts", input: {}, result: "5 of 5 contracts match" },
            { tool: "get_contract", input: {}, result: "not run" },
          ],
        }),
      ),
      asked,
    );

    expect(state.running).toBe(false);
    expect(state.messages.at(-1)).toEqual({
      id: 2,
      role: "assistant",
      phase: "stopped",
      reason:
        "Stopped after 2 steps without reaching an answer. A more specific question usually needs fewer.",
      steps: [
        { label: "Checking the contracts", result: "5 of 5 contracts match" },
        { label: "Reading a contract", result: "not run" },
      ],
    });
  });

  it("shows the steps that ran and says it stopped at the time limit", () => {
    const timeout: AskStreamEvent = {
      event: "error",
      data: {
        status: 504,
        error: {
          code: "ASK_TIMEOUT",
          message: "No answer within 180000ms",
          details: {
            thread_id: "t1",
            steps: [{ tool: "get_contract", input: {}, result: "fields of msa.pdf" }],
          },
        },
      },
    };

    const state = run(events(timeout), asked);

    expect(state.running).toBe(false);
    expect(state.messages.at(-1)).toMatchObject({
      phase: "stopped",
      reason: expect.stringMatching(/^Stopped: no answer within the time limit/) as string,
      steps: [{ label: "Reading a contract", result: "fields of msa.pdf" }],
    });
  });

  it("still says it stopped when the timeout carries no steps it can read", () => {
    const state = run(
      [{ type: "failed", failure: { status: 504, code: "ASK_TIMEOUT", message: "x" } }],
      asked,
    );

    expect(state.messages.at(-1)).toMatchObject({ phase: "stopped", steps: [] });
  });

  it("keeps the question and says why when the api refused it", () => {
    const state = run(
      [
        {
          type: "failed",
          failure: {
            status: 503,
            code: "MODEL_BUSY",
            message:
              "The local model is busy with an extraction. Try again in a moment, or pick a hosted model.",
          },
        },
      ],
      asked,
    );

    expect(state.running).toBe(false);
    expect(state.messages).toEqual([
      { id: 1, role: "user", text: "Which contracts renew?" },
      {
        id: 2,
        role: "assistant",
        phase: "failed",
        reason:
          "The local model is busy with an extraction. Try again in a moment, or pick a hosted model.",
        question: "Which contracts renew?",
      },
    ]);
  });

  it("treats an error event of the stream like a failed request", () => {
    const state = run(
      events({
        event: "error",
        data: { status: 502, error: { code: "MODEL_FAILED", message: "The model call failed" } },
      }),
      asked,
    );

    expect(state.messages.at(-1)).toMatchObject({
      phase: "failed",
      reason: "The model call did not work. Try again, or pick another model.",
    });
  });

  it("says so when the user stopped the answer", () => {
    const state = run([{ type: "stopped" }], asked);

    expect(state.running).toBe(false);
    expect(state.messages.at(-1)).toMatchObject({
      phase: "failed",
      reason: STOPPED_BY_USER,
      question: "Which contracts renew?",
    });
  });

  it("takes a failed question out before it is asked again", () => {
    const failed = run(
      [{ type: "failed", failure: { status: 0, code: "NETWORK_ERROR", message: "x" } }],
      run(
        [{ type: "ask", question: "Two" }],
        run([{ type: "ask", question: "One" }, ...events(done())]),
      ),
    );

    const dropped = chatReducer(failed, { type: "dropFailed" });

    expect(dropped.messages.map((m) => m.id)).toEqual([1, 2]);
    // Nothing to drop after an answer.
    expect(chatReducer(dropped, { type: "dropFailed" })).toBe(dropped);
  });

  it("leaves the conversation alone when a late event has no running answer to land in", () => {
    const answered = run([{ type: "ask", question: "Q" }, ...events(done())]);

    expect(run(events(call("find_contracts")), answered).messages).toEqual(answered.messages);
  });
});

describe("failureText", () => {
  const text = (code: string, message = "server text") =>
    failureText({ status: 400, code, message });

  it("has calm words for every state the api can answer with", () => {
    expect(text("MODEL_BUSY", "The local model is answering another question.")).toBe(
      "The local model is answering another question.",
    );
    expect(text("THREAD_BUSY")).toMatch(/still answering the previous question/);
    expect(text("MODEL_UNAVAILABLE", "OPENAI_API_KEY is not set")).toBe(
      "This model cannot be used right now: OPENAI_API_KEY is not set. Pick another one in the sidebar.",
    );
    expect(text("MODEL_NOT_RESPONDING")).toBe("The model did not respond. Try again in a moment.");
    expect(text("NETWORK_ERROR")).toMatch(/connection to the server was lost/);
    expect(text("STREAM_ENDED")).toMatch(/connection to the server was lost/);
    expect(text("NOT_FOUND")).toMatch(/no longer exists/);
  });

  it("falls back to what the api said for a code it does not know", () => {
    expect(text("SOMETHING_NEW", "A new kind of problem")).toBe("A new kind of problem");
  });

  it("never shouts or blames", () => {
    for (const code of ["MODEL_BUSY", "THREAD_BUSY", "MODEL_UNAVAILABLE", "MODEL_FAILED", "X"]) {
      expect(text(code)).not.toMatch(/!|error|invalid|failed to/i);
    }
  });
});

describe("chatReducer: threads", () => {
  const thread: ThreadDetail = {
    thread_id: "t9",
    title: "Which contracts renew?",
    document_id: DOC,
    updated_at: "2026-06-01T12:00:00.000Z",
    messages: [
      { role: "user", text: "Which contracts renew?" },
      {
        role: "assistant",
        text: "Only the msa [chunk:7].",
        citations: [citation({ start: 13 })],
        steps: [{ tool: "find_contracts", input: {}, result: "1 of 2 contracts match" }],
        model: MODEL,
      },
    ],
  };

  it("shows a stored thread like one that was just asked", () => {
    const state = run([{ type: "loaded", thread }]);

    expect(state).toMatchObject({ threadId: "t9", documentId: DOC, running: false, nextId: 3 });
    expect(state.messages).toEqual([
      { id: 1, role: "user", text: "Which contracts renew?" },
      {
        id: 2,
        role: "assistant",
        phase: "answered",
        text: "Only the msa [chunk:7].",
        citations: [citation({ start: 13 })],
        steps: [{ label: "Checking the contracts", result: "1 of 2 contracts match" }],
        model: MODEL,
      },
    ]);
  });

  it("continues a loaded thread with the next ids", () => {
    const state = run([
      { type: "loaded", thread },
      { type: "ask", question: "And when?" },
    ]);

    expect(state.messages.map((m) => m.id)).toEqual([1, 2, 3, 4]);
    expect(state.threadId).toBe("t9");
  });

  it("starts over on reset, about one contract or about all", () => {
    const loaded = run([{ type: "loaded", thread }]);

    expect(chatReducer(loaded, { type: "reset", documentId: null })).toEqual(emptyChat());
    expect(chatReducer(loaded, { type: "reset", documentId: DOC })).toEqual(emptyChat(DOC));
  });
});

describe("answerParts", () => {
  it("cuts the answer at its citations and numbers the sources", () => {
    const answer = "The cap is fees [chunk:7]. Notice is 60 days [contract:abc] and [chunk:7].";
    const parts = answerParts(answer, [
      citation({ start: 16 }),
      citation({ marker: "[contract:abc]", start: 45, kind: "contract", id: "abc" }),
      citation({ start: 64 }),
    ]);

    expect(parts.map((p) => (p.kind === "text" ? p.text : p.number))).toEqual([
      "The cap is fees ",
      1,
      ". Notice is 60 days ",
      2,
      " and ",
      // The same source again has the same number.
      1,
      ".",
    ]);
  });

  it("returns the whole text when there are no citations", () => {
    expect(answerParts("Nothing found.", [])).toEqual([{ kind: "text", text: "Nothing found." }]);
  });

  it("does not cut where a citation is not where it says it is", () => {
    const answer = "The cap is fees [chunk:7].";

    expect(answerParts(answer, [citation({ start: 3 })])).toEqual([{ kind: "text", text: answer }]);
    expect(answerParts(answer, [citation({ start: 400 })])).toEqual([
      { kind: "text", text: answer },
    ]);
  });

  it("handles citations given out of order and one at the very start or end", () => {
    const answer = "[chunk:7] says so [chunk:8]";
    const parts = answerParts(answer, [
      citation({ marker: "[chunk:8]", start: 18, id: "8" }),
      citation({ start: 0 }),
    ]);

    expect(parts.map((p) => (p.kind === "text" ? p.text : p.citation.id))).toEqual([
      "7",
      " says so ",
      "8",
    ]);
  });
});

describe("citations", () => {
  it("names the file and page of a verified one", () => {
    expect(citationTitle(citation())).toBe("msa.pdf, page 5");
    expect(citationTitle(citation({ page_end: 6 }))).toBe("msa.pdf, pages 5 to 6");
    expect(
      citationTitle(citation({ page_start: null, page_end: null, file_name: "sow.docx" })),
    ).toBe("sow.docx");
  });

  it("says in words why one is not verified", () => {
    expect(citationTitle(citation({ status: "quote_not_found" }))).toBe(
      "Not verified: the quoted words are not in msa.pdf, page 5",
    );
    expect(citationTitle(citation({ status: "not_found", file_name: null }))).toBe(
      "Not verified: the cited passage does not exist",
    );
    expect(citationTitle(citation({ status: "not_found", kind: "contract" }))).toBe(
      "Not verified: the cited contract does not exist",
    );
  });

  it("opens the document with the passage and the quote that was found for a chunk", () => {
    const quoted = citation({
      quotes: [
        { text: "not in it", found: false, page_start: null, page_end: null },
        { text: "limited to the fees", found: true, page_start: 5, page_end: 5 },
      ],
    });

    expect(citationTarget(quoted)).toEqual({
      documentId: DOC,
      passage: { chunkId: 7, quote: "limited to the fees" },
    });
    expect(citationTarget(citation())).toEqual({
      documentId: DOC,
      passage: { chunkId: 7, quote: null },
    });
  });

  it("opens the passage of an unverified chunk too, so the reader can see what is there", () => {
    expect(citationTarget(citation({ status: "quote_not_found" }))?.passage).toEqual({
      chunkId: 7,
      quote: null,
    });
  });

  it("opens only the document for a contract citation, and nothing for one that was not found", () => {
    expect(citationTarget(citation({ kind: "contract", id: DOC }))).toEqual({
      documentId: DOC,
      passage: null,
    });
    expect(citationTarget(citation({ status: "not_found", document_id: null }))).toBeNull();
  });

  it("counts the ones to warn about", () => {
    expect(
      unverifiedCount([
        citation(),
        citation({ status: "not_found" }),
        citation({ status: "quote_not_found" }),
      ]),
    ).toBe(2);
    expect(stepLines([])).toEqual([]);
  });
});

describe("highlightQuote", () => {
  const passage =
    "The Vendor's total liability is limited to the fees paid\nin the preceding 12 months.";

  it("splits the passage around the quote", () => {
    expect(highlightQuote(passage, "limited to the fees paid")).toEqual({
      before: "The Vendor's total liability is ",
      match: "limited to the fees paid",
      after: "\nin the preceding 12 months.",
    });
  });

  it("finds a quote that lost the passage's line break or its capitals", () => {
    expect(highlightQuote(passage, "THE FEES PAID in  the preceding")?.match).toBe(
      "the fees paid\nin the preceding",
    );
  });

  it("marks the whole passage when all of it was quoted", () => {
    expect(highlightQuote("Net 30.", "Net 30.")).toEqual({
      before: "",
      match: "Net 30.",
      after: "",
    });
  });

  it("returns null without a quote or when the words are not there letter for letter", () => {
    expect(highlightQuote(passage, null)).toBeNull();
    expect(highlightQuote(passage, "   ")).toBeNull();
    expect(highlightQuote(passage, "limited to the fees payable")).toBeNull();
  });
});

describe("route", () => {
  it("reads the documents view from an address without a view", () => {
    expect(readRoute("")).toEqual({ view: "documents", threadId: null, aboutId: null });
    expect(readRoute("?doc=abc&thread=t1")).toEqual({
      view: "documents",
      threadId: null,
      aboutId: null,
    });
  });

  it("reads the chat with its thread or the contract it is about", () => {
    expect(readRoute("?view=chat&thread=t1")).toEqual({
      view: "chat",
      threadId: "t1",
      aboutId: null,
    });
    expect(readRoute(`?view=chat&about=${DOC}`)).toEqual({
      view: "chat",
      threadId: null,
      aboutId: DOC,
    });
  });

  it("writes a route and keeps the open document", () => {
    expect(routeHref("?doc=abc", { view: "chat", threadId: "t1", aboutId: null })).toBe(
      "?doc=abc&view=chat&thread=t1",
    );
    expect(
      routeHref("?doc=abc&view=chat&thread=t1", {
        view: "documents",
        threadId: null,
        aboutId: null,
      }),
    ).toBe("?doc=abc");
    expect(routeHref("?view=chat", { view: "documents", threadId: null, aboutId: null })).toBe(".");
  });

  it("drops the contract once the chat has a thread, which knows its own", () => {
    expect(routeHref("", { view: "chat", threadId: "t1", aboutId: DOC })).toBe(
      "?view=chat&thread=t1",
    );
    expect(routeHref("", { view: "chat", threadId: null, aboutId: DOC })).toBe(
      `?view=chat&about=${DOC}`,
    );
  });

  it("round trips", () => {
    const route = { view: "chat", threadId: "t-1_A", aboutId: null } as const;

    expect(readRoute(routeHref("", route))).toEqual(route);
  });
});
