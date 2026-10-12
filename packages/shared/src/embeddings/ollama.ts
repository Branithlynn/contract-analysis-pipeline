import { z } from "zod";
import { LlmError } from "../llm/errors.js";
import {
  createOllamaAgent,
  nodeFetch,
  ollamaFetchFailure,
  ollamaStatusError,
  type OllamaFetch,
} from "../llm/ollama-transport.js";
import { toVectors, type EmbedKind, type Embedder, type EmbedOptions } from "./types.js";

export interface OllamaEmbedderOptions {
  baseUrl: string;
  model: string;
  // EMBED_OLLAMA_NUM_GPU.
  numGpu: number;
  // LLM_TIMEOUT_MS, the same connection limit the chat provider's agent gets.
  timeoutMs: number;
  fetch?: OllamaFetch;
}

const EmbedBody = z.object({
  embeddings: z.array(z.array(z.number())),
  // Nanoseconds. Left out by ollama when it is zero.
  load_duration: z.number().optional(),
});

const NS_PER_MS = 1_000_000;

// nomic-embed-text is trained with a task prefix on every input and its model card asks for it:
// stored text and questions get different ones. Other models get the text as it is.
const NOMIC_PREFIX: Record<EmbedKind, string> = {
  document: "search_document: ",
  query: "search_query: ",
};

// Exported so a test can check exactly what gets sent.
export function buildEmbedBody(
  model: string,
  texts: readonly string[],
  kind: EmbedKind,
  numGpu: number,
) {
  const prefix = model.startsWith("nomic-embed-text") ? NOMIC_PREFIX[kind] : "";
  return {
    model,
    input: texts.map((text) => prefix + text),
    // The default cuts an overlong input to the context size without saying so. A chunk that does
    // not fit should fail, not get the embedding of its first half.
    truncate: false,
    // Like chat: the batches of one document arrive back to back.
    keep_alive: "10m",
    // With 0 the model runs on the cpu and ollama places it in system ram: it does not have to
    // fit in vram next to the chat model, so neither gets unloaded for the other. Every request
    // has to send the same value, a different one makes ollama reload the model.
    options: { num_gpu: numGpu },
  };
}

export function createOllamaEmbedder(opts: OllamaEmbedderOptions): Embedder {
  const { model } = opts;
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  const doFetch: OllamaFetch = opts.fetch ?? nodeFetch;
  const agent = createOllamaAgent(opts.timeoutMs);

  // One call at a time, whoever asks. The worker already runs one job at a time when chat is on
  // ollama, but with chat on a hosted provider two jobs can reach their indexing stage together.
  // A call waiting here has not started its timeout yet.
  let last: Promise<unknown> = Promise.resolve();
  function inTurn<T>(fn: () => Promise<T>): Promise<T> {
    const run = last.then(fn, fn);
    last = run.catch(() => undefined);
    return run;
  }

  async function send(
    texts: readonly string[],
    kind: EmbedKind,
    timeoutMs: number,
    onCall: EmbedOptions["onCall"],
  ): Promise<Float32Array[]> {
    const started = performance.now();
    let status: number;
    let body: string;
    try {
      const res = await doFetch(`${baseUrl}/api/embed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildEmbedBody(model, texts, kind, opts.numGpu)),
        signal: AbortSignal.timeout(timeoutMs),
        dispatcher: agent,
      });
      status = res.status;
      body = await res.text();
    } catch (err) {
      throw ollamaFetchFailure(err, baseUrl, timeoutMs, opts.timeoutMs);
    }
    if (status !== 200) throw ollamaStatusError(status, body, model);

    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch (err) {
      throw new LlmError("bad_output", "Ollama embed response is not json", body.slice(0, 500), {
        cause: err,
      });
    }
    const parsed = EmbedBody.safeParse(json);
    if (!parsed.success) {
      throw new LlmError("bad_output", "Ollama embed response has no embeddings", undefined, {
        cause: parsed.error,
      });
    }
    const vectors = toVectors(parsed.data.embeddings, texts.length, "Ollama");
    onCall?.({
      texts: texts.length,
      durationMs: Math.round(performance.now() - started),
      loadMs: Math.round((parsed.data.load_duration ?? 0) / NS_PER_MS),
    });
    return vectors;
  }

  return {
    name: "ollama",
    model,
    close: () => agent.close(),
    embed(texts, kind, { timeoutMs, onCall }: EmbedOptions) {
      if (texts.length === 0) return Promise.resolve([]);
      return inTurn(() => send(texts, kind, timeoutMs, onCall));
    },
  };
}
