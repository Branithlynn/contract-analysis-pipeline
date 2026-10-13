import { AIMessage } from "@langchain/core/messages";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AskResponseSchema,
  ErrorBodySchema,
  SearchHitSchema,
  ThreadDetailSchema,
  ThreadSummarySchema,
} from "@nexus/shared";
import { currentTurn, toolCall, type ChatScript } from "../ask/scripted-model.js";
import {
  chunkIdOf,
  INJECTED,
  MSA,
  MSA_LIABILITY,
  ORDER,
  ORDER_LIABILITY,
} from "../test-support/ask.js";
import {
  closeAskServers,
  parseStream,
  questionCall,
  setupAskServer as setup,
} from "../test-support/ask-server.js";
import { docId, okQueue } from "../test-support/fixtures.js";

afterEach(closeAskServers);

// Finds the renewing contract, then answers with a citation of it.
const renewals: ChatScript = (messages) =>
  currentTurn(messages).toolResults.length === 0
    ? toolCall("find_contracts", { auto_renewal: true })
    : new AIMessage(`Only msa.pdf renews [contract:${MSA}].`);

describe("POST /api/ask/stream", () => {
  it("sends the steps while the agent works and the answer at the end", async () => {
    const { askStream } = await setup({ script: renewals });

    const res = await askStream({ question: "Which contracts renew?", thread_id: "stream-1" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(res.headers["cache-control"]).toBe("no-cache, no-transform");
    expect(res.headers["x-accel-buffering"]).toBe("no");
    const events = parseStream(res.payload);
    expect(events.map((e) => e.event)).toEqual(["started", "step", "step", "done"]);
    expect(events.slice(0, 3)).toEqual([
      {
        event: "started",
        data: { thread_id: "stream-1", model: { provider: "mock", model: "mock" } },
      },
      {
        event: "step",
        data: { type: "tool_call", tool: "find_contracts", input: { auto_renewal: true } },
      },
      {
        event: "step",
        data: { type: "tool_result", tool: "find_contracts", result: "1 of 2 contracts match" },
      },
    ]);
    const done = events.at(-1);
    expect(done).toMatchObject({
      event: "done",
      data: {
        thread_id: "stream-1",
        stopped: "done",
        answer: `Only msa.pdf renews [contract:${MSA}].`,
        citations: [{ kind: "contract", id: MSA, status: "verified" }],
        steps: [{ tool: "find_contracts", result: "1 of 2 contracts match" }],
      },
    });
  });

  it("gives the same answer as POST /api/ask", async () => {
    const { askStream, answer } = await setup({ script: renewals });

    const plain = await answer({ question: "Which contracts renew?", thread_id: "a" });
    const res = await askStream({ question: "Which contracts renew?", thread_id: "b" });

    const done = parseStream(res.payload).at(-1);
    expect(done?.event).toBe("done");
    expect({ ...AskResponseSchema.parse(done?.data), thread_id: "a" }).toEqual(plain);
  });

  it("refuses what can be refused up front with an ordinary error response", async () => {
    const { askStream } = await setup({ script: renewals });

    const invalid = await askStream({ question: "" });
    const noModel = await askStream({ question: "Hi", provider: "openai", model: "gpt-5-mini" });

    expect(invalid.statusCode).toBe(400);
    expect(invalid.headers["content-type"]).toMatch(/application\/json/);
    expect(ErrorBodySchema.parse(invalid.json()).error.code).toBe("VALIDATION_ERROR");
    expect(noModel.statusCode).toBe(400);
    expect(ErrorBodySchema.parse(noModel.json()).error).toEqual({
      code: "MODEL_UNAVAILABLE",
      message: "OPENAI_API_KEY is not set",
    });
  });

  it("answers MODEL_BUSY before the stream opens", async () => {
    const { askStream, created } = await setup({
      env: { ASK_BUSY_WAIT_MS: "100" },
      queue: { ...okQueue, activeLocalJobs: () => Promise.resolve(1) },
      models: {
        list: () => Promise.reject(new Error("not used")),
        check: () => Promise.resolve({ ok: true }),
        close: () => Promise.resolve(),
      },
      script: renewals,
    });

    const res = await askStream({
      question: "Hi",
      provider: "ollama",
      model: "qwen2.5:7b-instruct",
    });

    expect(res.statusCode).toBe(503);
    expect(ErrorBodySchema.parse(res.json()).error.code).toBe("MODEL_BUSY");
    expect(created).toEqual([]);
  });

  it("ends with the step limit as a done event that has no answer", async () => {
    const { askStream } = await setup({
      env: { ASK_MAX_STEPS: "3" },
      script: () => toolCall("find_contracts", {}),
    });

    const events = parseStream((await askStream({ question: "Loop" })).payload);

    // Two calls with their results, and the third call, which was not carried out.
    expect(events.map((e) => e.event)).toEqual([
      "started",
      "step",
      "step",
      "step",
      "step",
      "step",
      "done",
    ]);
    expect(events.at(-1)).toMatchObject({
      event: "done",
      data: { stopped: "step_limit", answer: null, steps: [{}, {}, { result: "not run" }] },
    });
  });

  it("ends with an error event that carries the steps when the question times out", async () => {
    const { askStream } = await setup({
      env: { ASK_TIMEOUT_MS: "150" },
      script: (messages, signal) =>
        currentTurn(messages).toolResults.length === 0
          ? toolCall("get_contract", { id: MSA })
          : new Promise<AIMessage>((_resolve, reject) => {
              signal?.addEventListener("abort", () => {
                reject(signal.reason as Error);
              });
            }),
    });

    const res = await askStream({ question: "Slow", thread_id: "slow" });

    // The stream was open already, so the status says nothing: the last event does.
    expect(res.statusCode).toBe(200);
    const events = parseStream(res.payload);
    expect(events.map((e) => e.event)).toEqual(["started", "step", "step", "error"]);
    expect(events.at(-1)).toEqual({
      event: "error",
      data: {
        status: 504,
        error: {
          code: "ASK_TIMEOUT",
          message: "No answer within 150ms",
          details: {
            thread_id: "slow",
            steps: [
              {
                tool: "get_contract",
                input: { id: MSA },
                result: "fields, 1 risks and dates of msa.pdf",
              },
            ],
          },
        },
      },
    });
  });

  it("ends with an error event when the model call fails", async () => {
    const { askStream } = await setup({
      script: () => {
        throw new Error("401 invalid x-api-key");
      },
    });

    const events = parseStream((await askStream({ question: "Hi" })).payload);

    expect(events.at(-1)).toEqual({
      event: "error",
      data: { status: 502, error: { code: "MODEL_FAILED", message: "The model call failed" } },
    });
  });

  it("frees the thread after a stream, so the follow-up is accepted", async () => {
    const { askStream } = await setup({ script: renewals });

    await askStream({ question: "Which contracts renew?", thread_id: "again" });
    const second = await askStream({ question: "And the other one?", thread_id: "again" });

    expect(parseStream(second.payload).at(-1)?.event).toBe("done");
  });

  it("sends a comment line while nothing else happens, so a proxy keeps the connection", async () => {
    let finish: (message: AIMessage) => void = () => undefined;
    let held = false;
    // The default is 15s.
    const fast = await setup({
      script: () =>
        held
          ? new AIMessage("Done.")
          : new Promise<AIMessage>((resolve) => ((held = true), (finish = resolve))),
      heartbeatMs: 20,
    });
    const pending = fast.askStream({ question: "Slow" });
    await new Promise((resolve) => setTimeout(resolve, 120));
    finish(new AIMessage("Done."));
    const res = await pending;

    expect(res.payload).toContain(": waiting\n\n");
    expect(parseStream(res.payload).at(-1)?.event).toBe("done");
  });
});

describe("POST /api/ask/stream over a real connection", () => {
  it("stops the model when the client goes away, and forgets the question", async () => {
    let modelAborted: () => void = () => undefined;
    const aborted = new Promise<void>((resolve) => (modelAborted = resolve));
    const ctx = await setup({
      script: (messages, signal) =>
        currentTurn(messages).question === "Still there?"
          ? new AIMessage("Yes.")
          : new Promise<AIMessage>((_resolve, reject) => {
              signal?.addEventListener("abort", () => {
                modelAborted();
                reject(signal.reason as Error);
              });
            }),
    });
    // inject() has no connection to drop, so this one listens on 127.0.0.1.
    await ctx.app.listen({ host: "127.0.0.1", port: 0 });
    const { port } = ctx.app.server.address() as AddressInfo;
    const client = new AbortController();

    const res = await fetch(`http://127.0.0.1:${String(port)}/api/ask/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "Slow", thread_id: "left" }),
      signal: client.signal,
    });
    const reader = res.body?.getReader();
    const first = new TextDecoder().decode((await reader?.read())?.value);
    expect(first).toContain("event: started");
    client.abort();

    // The model call was cancelled, which on ollama is what frees the gpu.
    await aborted;
    await vi.waitFor(() => {
      expect(ctx.lines).toContainEqual(
        expect.objectContaining({ msg: "client left, question stopped", threadId: "left" }),
      );
    });
    // Not a timeout, and the thread is free and empty again.
    expect(ctx.lines.some((line) => line["msg"] === "question timed out")).toBe(false);
    const next = await ctx.answer({ question: "Still there?", thread_id: "left" });
    expect(next.answer).toBe("Yes.");
    expect(questionCall(ctx.model).map((m) => m.getType())).toEqual(["system", "human"]);
    await ctx.app.close();
  });
});

describe("POST /api/ask with document_id", () => {
  it("limits every search to that contract, whatever the model asks for", async () => {
    const { answer, model, db } = await setup({
      script: (messages) => {
        const { toolResults } = currentTurn(messages);
        // The first result is the search the agent made before the model was called. The model
        // then names the other contract, and then none at all.
        if (toolResults.length === 1) {
          return toolCall("search_clauses", {
            query: "liability limited to fees",
            document_id: MSA,
          });
        }
        if (toolResults.length === 2) {
          return toolCall("search_clauses", { query: "liability limited to fees", k: 6 });
        }
        return new AIMessage("Done.");
      },
    });

    const body = await answer({ question: "What is the liability cap?", document_id: ORDER });

    const results = currentTurn(model?.seen.at(-1) ?? []).toolResults;
    expect(results).toHaveLength(3);
    for (const result of results) {
      expect(result).toContain(`"chunk_id":${String(chunkIdOf(db, ORDER_LIABILITY))}`);
      expect(result).not.toContain(`"chunk_id":${String(chunkIdOf(db, MSA_LIABILITY))}`);
      expect(result).not.toContain(MSA);
    }
    expect(body.steps.map((s) => s.result)).toEqual([
      expect.stringMatching(/from order\.pdf$/),
      expect.stringMatching(/from order\.pdf$/),
      expect.stringMatching(/from order\.pdf$/),
    ]);
  });

  it("searches the contract before the model is first called", async () => {
    // What the 7b did on a scoped question: no tool call, ever. The answer still has the
    // contract's passages behind it.
    const question = "Is liability limited to the fees paid?";
    const { answer, model, db, lines } = await setup({
      script: (messages) => {
        const id = /"chunk_id":(\d+)/.exec(currentTurn(messages).toolResults[0] ?? "")?.[1] ?? "";
        return new AIMessage(`It is "limited to the fees paid for the hardware" [chunk:${id}].`);
      },
    });

    const body = await answer({ question, document_id: ORDER });

    // One call, and it already had the passages. No reminder: the lookup was made.
    expect(model?.seen).toHaveLength(1);
    expect(model?.seen[0]?.map((m) => m.getType())).toEqual(["system", "human", "ai", "tool"]);
    expect(body.steps).toEqual([
      {
        tool: "search_clauses",
        input: { query: question, document_id: ORDER },
        result: expect.stringMatching(
          /^searched by the agent, not asked for by the model: \d passages .* from order\.pdf$/,
        ) as string,
      },
    ]);
    expect(body.citations).toMatchObject([
      { id: String(chunkIdOf(db, ORDER_LIABILITY)), status: "verified", document_id: ORDER },
    ]);
    // The search is not a model call.
    expect(lines).toContainEqual(
      expect.objectContaining({ msg: "question answered", modelCalls: 1, steps: 1 }),
    );
  });

  it("shows that search as the first steps of the stream", async () => {
    const { askStream } = await setup({ script: () => new AIMessage("Done.") });

    const events = parseStream(
      (await askStream({ question: "What is the liability cap?", document_id: ORDER })).payload,
    );

    expect(events.map((e) => e.event)).toEqual(["started", "step", "step", "done"]);
    expect(events.slice(1, 3)).toMatchObject([
      {
        data: {
          type: "tool_call",
          tool: "search_clauses",
          input: { query: "What is the liability cap?", document_id: ORDER },
        },
      },
      { data: { type: "tool_result", tool: "search_clauses" } },
    ]);
  });

  it("keeps that search out of the thread, like any other tool call", async () => {
    const { answer, model } = await setup({ script: () => new AIMessage("Done.") });
    const first = await answer({ question: "What is the liability cap?", document_id: ORDER });

    await answer({ question: "And the term?", document_id: ORDER, thread_id: first.thread_id });

    // The follow-up: the first question and its answer, then the new question with its search.
    expect(model?.seen.at(-1)?.map((m) => m.getType())).toEqual([
      "system",
      "human",
      "ai",
      "human",
      "ai",
      "tool",
    ]);
  });

  it("tells the model which contract the conversation is about, by id only", async () => {
    const { answer, model } = await setup({ script: () => new AIMessage("Done.") });

    await answer({ question: "What is the liability cap?", document_id: ORDER });

    const system = model?.seen.at(-1)?.[0]?.text ?? "";
    expect(system).toContain(`This conversation is about one contract, id ${ORDER}.`);
    // The file name is the uploader's text and stays out of the system prompt.
    expect(system).not.toContain("order.pdf");
  });

  it("leaves the prompt alone without one", async () => {
    const { answer, model } = await setup({ script: () => new AIMessage("Done.") });

    await answer({ question: "Anything" });

    expect(model?.seen.at(-1)?.[0]?.text).not.toContain("This conversation is about one contract");
  });

  it("answers 404 for a document that does not exist", async () => {
    const { ask, created } = await setup({ script: () => new AIMessage("Done.") });

    const res = await ask({ question: "Anything", document_id: docId(99) });

    expect(res.statusCode).toBe(404);
    expect(created).toEqual([]);
  });
});

describe("GET /api/threads", () => {
  it("lists the conversations, the one asked in last first", async () => {
    const { answer, get } = await setup({ script: renewals });
    await answer({ question: "Which contracts renew?", thread_id: "first" });
    await answer({
      question: "  What does the order\nsay about delivery?  ",
      thread_id: "second",
      document_id: ORDER,
    });
    await answer({ question: "And when is notice due?", thread_id: "first" });

    const res = await get("/api/threads");

    expect(res.statusCode).toBe(200);
    const threads = ThreadSummarySchema.array().parse(res.json());
    expect(threads.map((t) => [t.thread_id, t.title, t.document_id])).toEqual([
      ["first", "Which contracts renew?", null],
      ["second", "What does the order say about delivery?", ORDER],
    ]);
  });

  it("shortens a long first question to a title", async () => {
    const { answer, get } = await setup({ script: () => new AIMessage("Done.") });
    await answer({ question: "word ".repeat(60), thread_id: "long" });

    const [thread] = ThreadSummarySchema.array().parse((await get("/api/threads")).json());

    expect(thread?.title.length).toBeLessThanOrEqual(80);
    expect(thread?.title.endsWith("…")).toBe(true);
  });

  it("does not list a thread whose only question never finished", async () => {
    const { answer, get } = await setup({
      env: { ASK_MAX_STEPS: "3" },
      script: () => toolCall("find_contracts", {}),
    });
    const stopped = await answer({ question: "Loop", thread_id: "stopped" });
    expect(stopped.stopped).toBe("step_limit");

    expect((await get("/api/threads")).json()).toEqual([]);
    expect((await get("/api/threads/stopped")).statusCode).toBe(404);
  });

  it("is empty before anyone asked", async () => {
    const { get } = await setup({ script: renewals });

    expect((await get("/api/threads")).json()).toEqual([]);
  });
});

describe("GET /api/threads?q=", () => {
  // Answers each question with a sentence of its own, so a word can be in an answer only.
  const talks: ChatScript = (messages) => {
    const { question } = currentTurn(messages);
    if (question.includes("renew")) return new AIMessage(`Only msa.pdf renews [contract:${MSA}].`);
    if (question.includes("order")) return new AIMessage("Delivery is to the site in Hamburg.");
    return new AIMessage("Notice is due sixty days before the term ends.");
  };

  async function chats() {
    const server = await setup({ script: talks });
    await server.answer({ question: "Which contracts renew?", thread_id: "first" });
    await server.answer({
      question: "What does the order say?",
      thread_id: "second",
      document_id: ORDER,
    });
    await server.answer({ question: "And when is notice due?", thread_id: "first" });
    const search = async (q: string) =>
      ThreadSummarySchema.array().parse(
        (await server.get(`/api/threads?q=${encodeURIComponent(q)}`)).json(),
      );
    return { ...server, search };
  }

  it("finds a chat by its title", async () => {
    const { search } = await chats();

    const hits = await search("contracts renew");

    expect(hits.map((t) => [t.thread_id, t.title, t.document_id])).toEqual([
      ["first", "Which contracts renew?", null],
    ]);
  });

  it("finds a chat by what was said in it and shows the text around the match", async () => {
    const { search } = await chats();

    const [hit, ...rest] = await search("hamburg");

    expect(rest).toEqual([]);
    expect(hit).toMatchObject({
      thread_id: "second",
      title: "What does the order say?",
      document_id: ORDER,
    });
    expect(hit?.snippet?.filter((part) => part.match)).toEqual([{ text: "Hamburg", match: true }]);
    expect(hit?.snippet?.map((part) => part.text).join("")).toContain(
      "Delivery is to the site in Hamburg.",
    );
  });

  it("finds a later question of a chat, not only its first", async () => {
    const { search } = await chats();

    expect((await search("sixty days")).map((t) => t.thread_id)).toEqual(["first"]);
  });

  it("lists the matches newest first", async () => {
    const { search } = await chats();

    // "say" is in the second chat's question, "the" in both. The first chat was asked in last.
    expect((await search("the")).map((t) => t.thread_id)).toEqual(["first", "second"]);
  });

  it("is empty when nothing matches, and for a query without words", async () => {
    const { search } = await chats();

    expect(await search("unicorn")).toEqual([]);
    expect(await search("?!")).toEqual([]);
  });

  it("lists everything, without snippets, for an empty query", async () => {
    const { get } = await chats();

    const all = ThreadSummarySchema.array().parse((await get("/api/threads?q=%20")).json());

    expect(all.map((t) => t.thread_id)).toEqual(["first", "second"]);
    expect(all.every((t) => t.snippet === undefined)).toBe(true);
  });

  it("does not find the question of a turn that never finished", async () => {
    const { answer, get } = await setup({
      env: { ASK_MAX_STEPS: "3" },
      script: () => toolCall("find_contracts", {}),
    });
    await answer({ question: "Does the unicorn clause apply?", thread_id: "stopped" });

    expect((await get("/api/threads?q=unicorn")).json()).toEqual([]);
  });

  it("refuses a query that is too long", async () => {
    const { get } = await chats();

    const res = await get(`/api/threads?q=${"a".repeat(201)}`);

    expect(res.statusCode).toBe(400);
    expect(ErrorBodySchema.parse(res.json()).error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/threads/:id", () => {
  it("returns the questions and answers with trace, model and checked citations", async () => {
    const { answer, get } = await setup({ script: renewals });
    const asked = await answer({ question: "Which contracts renew?", thread_id: "t1" });
    await answer({ question: "Sure?", thread_id: "t1", provider: "mock", model: "mock-alt" });

    const res = await get("/api/threads/t1");

    expect(res.statusCode).toBe(200);
    const thread = ThreadDetailSchema.parse(res.json());
    expect(thread).toMatchObject({ thread_id: "t1", title: "Which contracts renew?" });
    expect(thread.messages).toEqual([
      { role: "user", text: "Which contracts renew?" },
      {
        role: "assistant",
        text: `Only msa.pdf renews [contract:${MSA}].`,
        // The same as the answer had when it was given.
        citations: asked.citations,
        steps: asked.steps,
        model: { provider: "mock", model: "mock" },
      },
      { role: "user", text: "Sure?" },
      {
        role: "assistant",
        text: `Only msa.pdf renews [contract:${MSA}].`,
        citations: asked.citations,
        steps: asked.steps,
        model: { provider: "mock", model: "mock-alt" },
      },
    ]);
  });

  it("keeps the trace out of what the model is sent on the next question", async () => {
    const { answer, model } = await setup({ script: renewals });
    await answer({ question: "Which contracts renew?", thread_id: "t1" });
    await answer({ question: "Sure?", thread_id: "t1" });

    const history = model?.seen.at(-1) ?? [];
    expect(history.map((m) => m.getType())).toEqual([
      "system",
      "human",
      "ai",
      "human",
      "ai",
      "tool",
    ]);
    expect(history[2]?.additional_kwargs).toEqual({});
  });

  it("answers 404 for a thread nobody asked in, and 400 for an id that cannot be one", async () => {
    const { get } = await setup({ script: renewals });

    expect((await get("/api/threads/unknown")).statusCode).toBe(404);
    expect((await get("/api/threads/a%20b")).statusCode).toBe(400);
  });
});

describe("GET /api/chunks/:id", () => {
  it("returns the passage a citation points at", async () => {
    const { get, db } = await setup({ script: renewals });

    const res = await get(`/api/chunks/${String(chunkIdOf(db, MSA_LIABILITY))}`);

    expect(res.statusCode).toBe(200);
    expect(SearchHitSchema.parse(res.json())).toMatchObject({
      document_id: MSA,
      file_name: "msa.pdf",
      page_start: 5,
      text: MSA_LIABILITY,
    });
  });

  it("does not return a flagged chunk, a missing one or a bad id", async () => {
    const { get, db } = await setup({ script: renewals });

    const flagged = await get(`/api/chunks/${String(chunkIdOf(db, INJECTED))}`);

    expect(flagged.statusCode).toBe(404);
    expect(flagged.body).not.toContain("ignore all previous instructions");
    expect((await get("/api/chunks/424242")).statusCode).toBe(404);
    expect((await get("/api/chunks/abc")).statusCode).toBe(400);
  });
});
