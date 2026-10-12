import {
  defaultModelSelection,
  hostedModels,
  LlmError,
  MOCK_MODELS,
  type Config,
  type ExtractPromptVersion,
  type HostedProvider,
  type ModelSelection,
} from "@nexus/shared/node";
import { createAnthropicProvider } from "./anthropic.js";
import { MockProvider } from "./mock.js";
import { contextFloor, createOllamaProvider } from "./ollama.js";
import { extractPrompt } from "./prompts/extract.js";
import { MAX_OUTPUT_TOKENS } from "./prompts/extract.v1.js";
import * as summary from "./prompts/summary.v1.js";
import { createOpenAIProvider } from "./openai.js";
import type { LlmProvider } from "./types.js";

// What the worker's largest ollama call needs: a full chunk with the extraction prompt, or the
// summary. Sized for the prompt version in use: a longer system prompt or field guide needs its
// own room next to the document.
export function ollamaContextFloor(maxInputChars: number, version: ExtractPromptVersion): number {
  const extract = extractPrompt(version);
  return contextFloor(maxInputChars, [
    {
      system: extract.system,
      schema: extract.schema,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
    {
      system: summary.buildSystemPrompt(),
      schema: summary.summaryJsonSchema(),
      maxOutputTokens: summary.MAX_OUTPUT_TOKENS,
    },
  ]);
}

export interface OllamaContextCheck {
  configured: number;
  // What a full chunk needs with the current LLM_MAX_INPUT_CHARS and PROMPT_VERSION.
  needed: number;
  fits: boolean;
}

// OLLAMA_NUM_CTX is set by hand and the chunk size and the prompt can change under it. Too small
// loses no text: a call that does not fit gets a bigger num_ctx for itself. But then every full
// chunk is such a call, and each switch between sizes is a model reload. Checked at startup so
// that shows up as one clear line instead of as slow jobs.
export function checkOllamaContext(
  config: Pick<Config, "OLLAMA_NUM_CTX" | "LLM_MAX_INPUT_CHARS" | "PROMPT_VERSION">,
): OllamaContextCheck {
  const needed = ollamaContextFloor(config.LLM_MAX_INPUT_CHARS, config.PROMPT_VERSION);
  return { configured: config.OLLAMA_NUM_CTX, needed, fits: needed <= config.OLLAMA_NUM_CTX };
}

const KEY_NAMES = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY" } as const;
const LIST_NAMES = { openai: "OPENAI_MODELS", anthropic: "ANTHROPIC_MODELS" } as const;

// The api checks a selection before it queues a job. The worker checks again, because a job
// payload is input too: a key the worker itself does not have, or a model outside the allowlist,
// must not become a request to a paid api. Both fail the same way on every attempt.
function hostedKey(config: Config, provider: HostedProvider, model: string): string {
  const key = config[KEY_NAMES[provider]];
  if (key === undefined) {
    throw new LlmError("auth", `${KEY_NAMES[provider]} is not set for the worker`);
  }
  if (!hostedModels(config, provider).includes(model)) {
    throw new LlmError("invalid_request", `Model ${model} is not in ${LIST_NAMES[provider]}`);
  }
  return key;
}

export function createProviderFor(config: Config, selection: ModelSelection): LlmProvider {
  const { provider, model } = selection;
  switch (provider) {
    case "ollama":
      return createOllamaProvider({
        baseUrl: config.OLLAMA_URL,
        model,
        // The api's ask agent uses the same setting, so the two do not reload each other's model.
        numCtxFloor: config.OLLAMA_NUM_CTX,
        timeoutMs: config.LLM_TIMEOUT_MS,
      });
    case "anthropic":
      return createAnthropicProvider({ apiKey: hostedKey(config, provider, model), model });
    case "openai":
      return createOpenAIProvider({ apiKey: hostedKey(config, provider, model), model });
    case "mock":
      if (!config.ALLOW_MOCK) {
        throw new LlmError("invalid_request", "The mock provider is off (ALLOW_MOCK is not true)");
      }
      if (!MOCK_MODELS.includes(model)) {
        throw new LlmError("invalid_request", `Model ${model} is not a mock model`);
      }
      return new MockProvider(undefined, model);
  }
}

// The provider for LLM_PROVIDER / LLM_MODEL. What the eval and the smoke script use.
export function createProvider(config: Config): LlmProvider {
  return createProviderFor(config, defaultModelSelection(config));
}

export interface ProviderRegistry {
  // Throws an LlmError when the selection cannot be used by this worker.
  get(selection: ModelSelection): LlmProvider;
  close(): Promise<void>;
}

// One provider object per model for the life of the worker, built when the first job asks for it.
// The ollama one holds a connection pool, and a new pool per job would never be closed.
export function createProviderRegistry(
  config: Config,
  create: (config: Config, selection: ModelSelection) => LlmProvider = createProviderFor,
): ProviderRegistry {
  const providers = new Map<string, LlmProvider>();
  return {
    get(selection) {
      // A line break cannot be part of a model name, so two selections never share a key.
      const key = `${selection.provider}\n${selection.model}`;
      let provider = providers.get(key);
      if (provider === undefined) {
        provider = create(config, selection);
        providers.set(key, provider);
      }
      return provider;
    },
    async close() {
      await Promise.all([...providers.values()].map((provider) => provider.close?.()));
      providers.clear();
    },
  };
}
