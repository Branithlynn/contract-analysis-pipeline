import OpenAI, { APIError } from "openai";
import type { EmbeddingCreateParams } from "openai/resources/embeddings";
import { LlmError } from "../llm/errors.js";
import { openAIErrorKind } from "../llm/openai-errors.js";
import { toVectors, type Embedder, type EmbedOptions } from "./types.js";

interface EmbeddingItem {
  index: number;
  embedding: readonly number[];
}

// Only what we call and read, so tests can pass a fake.
export interface OpenAIEmbeddingsClient {
  embeddings: {
    create(
      body: EmbeddingCreateParams,
      options?: { timeout?: number },
    ): Promise<{ data: readonly EmbeddingItem[] }>;
  };
}

export interface OpenAIEmbedderOptions {
  apiKey: string;
  model: string;
  client?: OpenAIEmbeddingsClient;
}

export function createOpenAIEmbedder(opts: OpenAIEmbedderOptions): Embedder {
  const { model } = opts;
  // Like the chat provider: the caller decides about retries, the sdk does none.
  const client: OpenAIEmbeddingsClient =
    opts.client ?? new OpenAI({ apiKey: opts.apiKey, maxRetries: 0 });

  return {
    name: "openai",
    model,
    // kind is not used: the text-embedding-3 models take stored text and questions the same way.
    async embed(texts, _kind, { timeoutMs, onCall }: EmbedOptions) {
      if (texts.length === 0) return [];
      const started = performance.now();
      let data: readonly EmbeddingItem[];
      try {
        ({ data } = await client.embeddings.create(
          { model, input: [...texts], encoding_format: "float" },
          { timeout: timeoutMs },
        ));
      } catch (err) {
        if (!(err instanceof APIError)) throw err;
        const kind = openAIErrorKind(err);
        const message =
          kind === "timeout"
            ? `OpenAI did not answer within ${timeoutMs}ms`
            : `OpenAI embeddings request failed: ${err.message}`;
        throw new LlmError(kind, message, undefined, { cause: err });
      }
      // Every item carries its index, so the order is not taken on trust.
      const ordered = [...data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
      const vectors = toVectors(ordered, texts.length, "OpenAI");
      onCall?.({
        texts: texts.length,
        durationMs: Math.round(performance.now() - started),
        loadMs: null,
      });
      return vectors;
    },
  };
}
