import { randomUUID } from "node:crypto";
import type { FastifyPluginCallback } from "fastify";
import { AskRequestSchema, type AskResponse } from "@nexus/shared";
import { defaultModelSelection, LlmError, type Config } from "@nexus/shared/node";
import { AskTimeoutError, runAsk, type AskDeps } from "../ask/agent.js";
import type { OllamaGate } from "../ask/busy.js";
import { ASK_PROMPT_VERSION } from "../ask/prompt.js";
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
}

export const askRoutes: FastifyPluginCallback<AskRouteDeps> = (app, deps, done) => {
  const { config, models, ollamaGate, clock } = deps;
  const defaultModel = defaultModelSelection(config);
  // Two questions on one thread at the same time would write into each other's history.
  const threadsInUse = new Set<string>();

  app.post("/ask", async (request): Promise<AskResponse> => {
    const body = AskRequestSchema.parse(request.body);
    const model =
      body.provider !== undefined && body.model !== undefined
        ? { provider: body.provider, model: body.model }
        : defaultModel;
    // Unlike an upload, the default is checked too. An upload with ollama down is queued and
    // retried, a question has nothing behind it that retries, so it should say why right away.
    const check = await models.check(model);
    if (!check.ok) throw new HttpError(400, "MODEL_UNAVAILABLE", check.reason);

    const threadId = body.thread_id ?? randomUUID();
    if (threadsInUse.has(threadId)) {
      throw new HttpError(409, "THREAD_BUSY", "This conversation is still answering a question");
    }
    threadsInUse.add(threadId);
    const started = Date.now();
    const fields = { threadId, ...model, prompt: ASK_PROMPT_VERSION };
    let release: (() => void) | undefined;
    try {
      // Only ollama shares one gpu with the worker.
      if (model.provider === "ollama") release = await ollamaGate.acquire();

      const result = await runAsk(
        { ...deps, maxSteps: config.ASK_MAX_STEPS },
        {
          question: body.question,
          threadId,
          model,
          signal: AbortSignal.timeout(config.ASK_TIMEOUT_MS),
          log: request.log,
          context: readContext(clock(), config.GROUNDING_REVIEW_THRESHOLD),
        },
      );
      request.log.info(
        {
          ...fields,
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
      if (err instanceof HttpError) throw err;
      const ms = Date.now() - started;
      if (err instanceof AskTimeoutError) {
        request.log.warn({ ...fields, steps: err.steps.length, ms }, "question timed out");
        throw new HttpError(
          504,
          "ASK_TIMEOUT",
          `No answer within ${String(config.ASK_TIMEOUT_MS)}ms`,
          { thread_id: threadId, steps: err.steps },
        );
      }
      request.log.warn({ ...fields, err, ms }, "question failed");
      // Retryable means the provider is slow or down right now. Everything else, the sdk errors
      // of the hosted providers included, stays broken until someone changes the setup.
      throw err instanceof LlmError && err.retryable
        ? new HttpError(503, "MODEL_NOT_RESPONDING", err.message)
        : new HttpError(
            502,
            "MODEL_FAILED",
            err instanceof LlmError ? err.message : "The model call failed",
          );
    } finally {
      release?.();
      threadsInUse.delete(threadId);
    }
  });

  done();
};
