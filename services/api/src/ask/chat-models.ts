import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import {
  createOllamaAgent,
  LlmError,
  type Config,
  type ModelSelection,
  type OllamaFetch,
} from "@nexus/shared/node";
import { ollamaChatFetch } from "./ollama-fetch.js";
import { defaultMockScript, ScriptedChatModel } from "./scripted-model.js";

// The chat model of one question. Made per question: the model is picked per request, and the
// ollama one carries that question's abort signal in its fetch.
export interface ChatModels {
  create(selection: ModelSelection, signal: AbortSignal): BaseChatModel;
  close(): Promise<void>;
}

export type ChatModelsConfig = Pick<
  Config,
  "OLLAMA_URL" | "OPENAI_API_KEY" | "ANTHROPIC_API_KEY" | "ASK_TIMEOUT_MS" | "OLLAMA_NUM_CTX"
>;

export interface ChatModelsOptions {
  config: ChatModelsConfig;
  fetch?: OllamaFetch;
}

function requireKey(key: string | undefined, name: string): string {
  // The model catalog refuses a provider without a key before this is reached.
  if (key === undefined) throw new LlmError("auth", `${name} is not set`);
  return key;
}

export function createChatModels({ config, fetch }: ChatModelsOptions): ChatModels {
  const baseUrl = config.OLLAMA_URL.replace(/\/+$/, "");
  // Made on first use, so an api that only talks to hosted models opens no connection pool.
  let agent: ReturnType<typeof createOllamaAgent> | undefined;

  return {
    create(selection, signal) {
      switch (selection.provider) {
        case "ollama":
          agent ??= createOllamaAgent(config.ASK_TIMEOUT_MS);
          return new ChatOllama({
            model: selection.model,
            baseUrl,
            fetch: ollamaChatFetch({
              agent,
              signal,
              baseUrl,
              timeoutMs: config.ASK_TIMEOUT_MS,
              ...(fetch === undefined ? {} : { fetch }),
            }),
            // Ollama's default context is a few thousand tokens and it drops the start of a longer
            // prompt without an error, which here is the system prompt with the rules. The same
            // value the worker extracts with, so a question after an extraction is not a reload.
            numCtx: config.OLLAMA_NUM_CTX,
            temperature: 0,
            // Retries belong to whoever asked. A question that failed is asked again by the user.
            maxRetries: 0,
          });
        case "openai":
          return new ChatOpenAI({
            model: selection.model,
            apiKey: requireKey(config.OPENAI_API_KEY, "OPENAI_API_KEY"),
            maxRetries: 0,
            timeout: config.ASK_TIMEOUT_MS,
            reasoning: { effort: "low" },
          });
        case "anthropic":
          return new ChatAnthropic({
            model: selection.model,
            apiKey: requireKey(config.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY"),
            maxRetries: 0,
          });
        case "mock":
          return new ScriptedChatModel(defaultMockScript);
      }
    },
    close: async () => {
      await agent?.close();
    },
  };
}
