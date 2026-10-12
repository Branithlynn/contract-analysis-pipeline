import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger, FastifyPluginCallback } from "fastify";
import { z } from "zod";
import {
  AskRequestSchema,
  type AskProgress,
  type AskRequest,
  type AskResponse,
  type AskStreamEvent,
  type SearchHit,
  type ThreadDetail,
  type ThreadSummary,
} from "@nexus/shared";
import {
  defaultModelSelection,
  getDocument,
  getRetrievalChunk,
  LlmError,
  type Config,
  type ModelSelection,
} from "@nexus/shared/node";
import { AskTimeoutError, readThread, runAsk, type AskDeps } from "../ask/agent.js";
import type { OllamaGate } from "../ask/busy.js";
import { ASK_PROMPT_VERSION } from "../ask/prompt.js";
import { listThreadIds } from "../ask/threads.js";
import { HttpError } from "../errors.js";
import { readContext } from "../services/dto.js";
import type { ModelCatalog } from "../services/models.js";

export interface AskRouteDeps extends Omit<AskDeps, "maxSteps"> {
  config: Pick<
    Config,
    "LLM_PROVIDER" | "LLM_MODEL" | "GROUNDING_REVIEW_THRESHOLD" | "ASK_TIMEOUT_MS" | "ASK_MAX_STEPS"
  >;
  models: ModelCatalog;
  ollamaGate: OllamaGate;
  clock: () => Date;
  // How often the stream sends a comment line while nothing else happens.
  heartbeatMs?: number;
}

interface Prepared {
  body: AskRequest;
  model: ModelSelection;
  threadId: string;
}

// A proxy drops a connection that stays silent for too long (nginx after proxy_read_timeout),
// and a local model can think for a minute between two steps.
const DEFAULT_HEARTBEAT_MS = 15_000;
const MAX_THREADS = 50;
const TITLE_CHARS = 80;

const ThreadParams = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) });
const ChunkParams = z.object({ id: z.coerce.number().int().positive() });

function titleOf(question: string): string {
  const line = question.replace(/\s+/g, " ").trim();
  return line.length <= TITLE_CHARS ? line : `${line.slice(0, TITLE_CHARS - 1).trimEnd()}…`;
}

export const askRoutes: FastifyPluginCallback<AskRouteDeps> = (app, deps, done) => {
  const { db, config, models, ollamaGate, clock, threads } = deps;
  const defaultModel = defaultModelSelection(config);
  const heartbeatMs = deps.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const context = () => readContext(clock(), config.GROUNDING_REVIEW_THRESHOLD);
  // Two questions on one thread at the same time would write into each other's history.
  const threadsInUse = new Set<string>();

  // Everything that can be refused before any work starts.
  async function prepare(requestBody: unknown): Promise<Prepared> {
    const body = AskRequestSchema.parse(requestBody);
    const model =
      body.provider !== undefined && body.model !== undefined
        ? { provider: body.provider, model: body.model }
        : defaultModel;
    // Unlike an upload, the default is checked too. An upload with ollama down is queued and
    // retried, a question has nothing behind it that retries, so it should say why right away.
    const check = await models.check(model);
    if (!check.ok) throw new HttpError(400, "MODEL_UNAVAILABLE", check.reason);
    if (body.document_id !== undefined && getDocument(db, body.document_id) === undefined) {
      throw new HttpError(404, "NOT_FOUND", "Document not found");
    }
    return { body, model, threadId: body.thread_id ?? randomUUID() };
  }

  // Takes the thread, and for an ollama model the gpu. Returns what gives both back.
  async function begin({ model, threadId }: Prepared): Promise<() => void> {
    if (threadsInUse.has(threadId)) {
      throw new HttpError(409, "THREAD_BUSY", "This conversation is still answering a question");
    }
    threadsInUse.add(threadId);
    try {
      // Only ollama shares one gpu with the worker.
      const release = model.provider === "ollama" ? await ollamaGate.acquire() : undefined;
      return () => {
        release?.();
        threadsInUse.delete(threadId);
      };
    } catch (err) {
      threadsInUse.delete(threadId);
      throw err;
    }
  }

  interface Watch {
    onProgress?: (progress: AskProgress) => void;
    // Aborted when the client of a stream went away.
    client?: AbortSignal;
  }

  // Runs the agent and turns every way it can end into a response or an HttpError.
  async function answer(
    { body, model, threadId }: Prepared,
    log: FastifyBaseLogger,
    watch: Watch = {},
  ): Promise<AskResponse> {
    const started = Date.now();
    const fields = { threadId, ...model, prompt: ASK_PROMPT_VERSION };
    const timeout = AbortSignal.timeout(config.ASK_TIMEOUT_MS);
    try {
      const result = await runAsk(
        { ...deps, maxSteps: config.ASK_MAX_STEPS },
        {
          question: body.question,
          threadId,
          model,
          documentId: body.document_id,
          signal: watch.client ? AbortSignal.any([timeout, watch.client]) : timeout,
          log,
          context: context(),
          onProgress: watch.onProgress,
        },
      );
      log.info(
        {
          ...fields,
          ...(body.document_id === undefined ? {} : { documentId: body.document_id }),
          stopped: result.stopped,
          steps: result.steps.length,
          citations: result.citations.length,
          unverified: result.citations.filter((c) => c.status !== "verified").length,
          ms: Date.now() - started,
        },
        "question answered",
      );
      return { thread_id: threadId, model, ...result };
    } catch (err) {
      const ms = Date.now() - started;
      if (err instanceof AskTimeoutError) {
        if (watch.client?.aborted === true && !timeout.aborted) {
          // Nobody is waiting for the answer any more, and on ollama the gpu is free again.
          log.info({ ...fields, steps: err.steps.length, ms }, "client left, question stopped");
          throw new HttpError(499, "CLIENT_CLOSED", "The client closed the connection");
        }
        log.warn({ ...fields, steps: err.steps.length, ms }, "question timed out");
        throw new HttpError(
          504,
          "ASK_TIMEOUT",
          `No answer within ${String(config.ASK_TIMEOUT_MS)}ms`,
          { thread_id: threadId, steps: err.steps },
        );
      }
      log.warn({ ...fields, err, ms }, "question failed");
      // Retryable means the provider is slow or down right now. Everything else, the sdk errors
      // of the hosted providers included, stays broken until someone changes the setup.
      throw err instanceof LlmError && err.retryable
        ? new HttpError(503, "MODEL_NOT_RESPONDING", err.message)
        : new HttpError(
            502,
            "MODEL_FAILED",
            err instanceof LlmError ? err.message : "The model call failed",
          );
    }
  }

  app.post("/ask", async (request): Promise<AskResponse> => {
    const prepared = await prepare(request.body);
    const release = await begin(prepared);
    try {
      return await answer(prepared, request.log);
    } finally {
      release();
    }
  });

  // The same question, with the agent's steps sent as server-sent events while it works. A local
  // model can take a minute, and a spinner that long says nothing. What can be refused up front
  // (a bad request, a model that is not there, MODEL_BUSY, THREAD_BUSY) is an ordinary error
  // response. Once the stream is open, a failure is its last event.
  app.post("/ask/stream", async (request, reply) => {
    const prepared = await prepare(request.body);
    const release = await begin(prepared);

    // From here on the response is written by hand, fastify no longer sends anything.
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      // For any buffering proxy between here and the browser, nginx first of all.
      "x-accel-buffering": "no",
      "x-request-id": request.id,
    });
    const send = ({ event, data }: AskStreamEvent) => {
      raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const client = new AbortController();
    raw.on("close", () => {
      if (!raw.writableEnded) client.abort();
    });
    const heartbeat = setInterval(() => raw.write(": waiting\n\n"), heartbeatMs);

    try {
      send({ event: "started", data: { thread_id: prepared.threadId, model: prepared.model } });
      const result = await answer(prepared, request.log, {
        onProgress: (progress) => {
          send({ event: "step", data: progress });
        },
        client: client.signal,
      });
      send({ event: "done", data: result });
    } catch (err) {
      if (!(err instanceof HttpError)) request.log.error({ err }, "ask stream failed");
      const error =
        err instanceof HttpError
          ? {
              status: err.status,
              error: {
                code: err.code,
                message: err.message,
                ...(err.details === undefined ? {} : { details: err.details }),
              },
            }
          : { status: 500, error: { code: "INTERNAL", message: "Internal error" } };
      if (!client.signal.aborted) send({ event: "error", data: error });
    } finally {
      clearInterval(heartbeat);
      release();
      raw.end();
    }
  });

  // The conversations the checkpointer holds, so the chat is still there after a reload.
  app.get("/threads", async (request): Promise<ThreadSummary[]> => {
    const summaries: ThreadSummary[] = [];
    for (const id of listThreadIds(db, MAX_THREADS)) {
      const thread = await readThread(
        { db, threads, log: request.log, context: context() },
        id,
        false,
      );
      const first = thread?.messages.find((message) => message.role === "user");
      if (!thread || !first) continue;
      summaries.push({
        thread_id: id,
        title: titleOf(first.text),
        document_id: thread.document_id,
        updated_at: thread.updated_at,
      });
    }
    return summaries;
  });

  app.get("/threads/:id", async (request): Promise<ThreadDetail> => {
    const { id } = ThreadParams.parse(request.params);
    const thread = await readThread({ db, threads, log: request.log, context: context() }, id);
    const first = thread?.messages.find((message) => message.role === "user");
    if (!thread || !first) throw new HttpError(404, "NOT_FOUND", "Conversation not found");
    return {
      thread_id: id,
      title: titleOf(first.text),
      document_id: thread.document_id,
      updated_at: thread.updated_at,
      messages: thread.messages,
    };
  });

  // The passage behind a [chunk:<id>] citation. Not found for a flagged chunk, like everywhere.
  app.get("/chunks/:id", (request): SearchHit => {
    const { id } = ChunkParams.parse(request.params);
    const chunk = getRetrievalChunk(db, id);
    if (!chunk) {
      throw new HttpError(404, "NOT_FOUND", "This passage is no longer in the search index");
    }
    return chunk;
  });

  done();
};
