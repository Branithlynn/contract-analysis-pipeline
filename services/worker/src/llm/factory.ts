import { llmExtractionJsonSchema } from "@nexus/shared";
import type { Config } from "@nexus/shared/node";
import { createAnthropicProvider } from "./anthropic.js";
import { MockProvider } from "./mock.js";
import { contextFloor, createOllamaProvider } from "./ollama.js";
import * as extract from "./prompts/extract.v1.js";
import * as summary from "./prompts/summary.v1.js";
import { createOpenAIProvider } from "./openai.js";
import type { LlmProvider } from "./types.js";

// loadConfig already rejects a missing key for the chosen provider; this only narrows the type.
function requireKey(key: string | undefined, name: string): string {
  if (key === undefined) throw new Error(`${name} is required for this LLM_PROVIDER`);
  return key;
}

// Every kind of call the worker makes to ollama, so they all share one num_ctx. The summary has no
// output budget of its own yet; the extraction budget is the larger one either way.
export function ollamaContextFloor(maxInputChars: number): number {
  return contextFloor(maxInputChars, [
    {
      system: extract.buildSystemPrompt(),
      schema: llmExtractionJsonSchema(),
      maxOutputTokens: extract.MAX_OUTPUT_TOKENS,
    },
    {
      system: summary.buildSystemPrompt(),
      schema: summary.summaryJsonSchema(),
      maxOutputTokens: extract.MAX_OUTPUT_TOKENS,
    },
  ]);
}

export function createProvider(config: Config): LlmProvider {
  switch (config.LLM_PROVIDER) {
    case "ollama":
      return createOllamaProvider({
        baseUrl: config.OLLAMA_URL,
        model: config.LLM_MODEL,
        numCtxFloor: ollamaContextFloor(config.LLM_MAX_INPUT_CHARS),
      });
    case "anthropic":
      return createAnthropicProvider({
        apiKey: requireKey(config.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY"),
        model: config.LLM_MODEL,
      });
    case "openai":
      return createOpenAIProvider({
        apiKey: requireKey(config.OPENAI_API_KEY, "OPENAI_API_KEY"),
        model: config.LLM_MODEL,
      });
    case "mock":
      return new MockProvider();
  }
}
