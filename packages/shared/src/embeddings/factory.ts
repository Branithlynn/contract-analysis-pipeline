import type { Config } from "../config.js";
import { MockEmbedder } from "./mock.js";
import { createOllamaEmbedder } from "./ollama.js";
import { createOpenAIEmbedder } from "./openai.js";
import type { Embedder } from "./types.js";

export type EmbedConfig = Pick<
  Config,
  | "EMBED_PROVIDER"
  | "EMBED_MODEL"
  | "EMBED_OLLAMA_NUM_GPU"
  | "OLLAMA_URL"
  | "OPENAI_API_KEY"
  | "LLM_TIMEOUT_MS"
>;

export function createEmbedder(config: EmbedConfig): Embedder {
  switch (config.EMBED_PROVIDER) {
    case "ollama":
      return createOllamaEmbedder({
        baseUrl: config.OLLAMA_URL,
        model: config.EMBED_MODEL,
        numGpu: config.EMBED_OLLAMA_NUM_GPU,
        timeoutMs: config.LLM_TIMEOUT_MS,
      });
    case "openai": {
      // loadConfig already rejects a missing key for this provider; this only narrows the type.
      if (config.OPENAI_API_KEY === undefined) {
        throw new Error("OPENAI_API_KEY is required for EMBED_PROVIDER=openai");
      }
      return createOpenAIEmbedder({ apiKey: config.OPENAI_API_KEY, model: config.EMBED_MODEL });
    }
    case "mock":
      return new MockEmbedder({ model: config.EMBED_MODEL });
  }
}
