import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it } from "vitest";
import { LlmError } from "@nexus/shared/node";
import { createChatModels, type ChatModelsConfig } from "./chat-models.js";
import { ScriptedChatModel } from "./scripted-model.js";

// Nothing here calls a provider: the models are built and looked at.

const CONFIG: ChatModelsConfig = {
  OLLAMA_URL: "http://localhost:11434///",
  OPENAI_API_KEY: "test-openai-key",
  ANTHROPIC_API_KEY: "test-anthropic-key",
  ASK_TIMEOUT_MS: 180000,
  OLLAMA_NUM_CTX: 10240,
};

const signal = new AbortController().signal;

describe("createChatModels", () => {
  it("builds the ollama model with our num_ctx, no retries and no trailing slash on the url", async () => {
    const models = createChatModels({ config: CONFIG });

    const model = models.create({ provider: "ollama", model: "qwen2.5:7b-instruct" }, signal);

    expect(model).toBeInstanceOf(ChatOllama);
    expect(model).toMatchObject({
      model: "qwen2.5:7b-instruct",
      baseUrl: "http://localhost:11434",
      numCtx: 10240,
      temperature: 0,
      // Where langchain keeps maxRetries.
      caller: { maxRetries: 0 },
    });
    await models.close();
  });

  it("sends an ollama call through the fetch it was given, with the question's signal", async () => {
    const seen: { url: string; aborted: boolean | undefined }[] = [];
    const models = createChatModels({
      config: CONFIG,
      fetch: (url, init) => {
        seen.push({ url: String(url), aborted: init?.signal?.aborted });
        return Promise.reject(new Error("stopped here on purpose"));
      },
    });
    const stopped = new AbortController();
    const model = models.create({ provider: "ollama", model: "qwen2.5:3b" }, stopped.signal);

    await expect(model.invoke("hello")).rejects.toThrow();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("http://localhost:11434/api/chat");
    expect(seen[0]?.aborted).toBe(false);
    await models.close();
  });

  it("builds the hosted models with the model that was picked and no retries of their own", () => {
    const models = createChatModels({ config: CONFIG });

    const openai = models.create({ provider: "openai", model: "gpt-5-mini" }, signal);
    expect(openai).toBeInstanceOf(ChatOpenAI);
    // bullmq does not sit behind a question, and the user asks again: the sdk must not retry.
    expect(openai).toMatchObject({
      model: "gpt-5-mini",
      timeout: 180000,
      caller: { maxRetries: 0 },
    });

    const anthropic = models.create({ provider: "anthropic", model: "claude-sonnet-5-5" }, signal);
    expect(anthropic).toBeInstanceOf(ChatAnthropic);
    expect(anthropic).toMatchObject({ model: "claude-sonnet-5-5", caller: { maxRetries: 0 } });
  });

  it("refuses a hosted provider whose key is not set, as an auth error", () => {
    const models = createChatModels({
      config: { ...CONFIG, OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined },
    });

    for (const [provider, key] of [
      ["openai", "OPENAI_API_KEY"],
      ["anthropic", "ANTHROPIC_API_KEY"],
    ] as const) {
      let thrown: unknown;
      try {
        models.create({ provider, model: "any" }, signal);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(LlmError);
      expect(thrown).toMatchObject({ kind: "auth", message: `${key} is not set` });
    }
  });

  it("gives the mock the scripted model, and closes without ever having opened a pool", async () => {
    const models = createChatModels({ config: CONFIG });

    expect(models.create({ provider: "mock", model: "mock" }, signal)).toBeInstanceOf(
      ScriptedChatModel,
    );
    await expect(models.close()).resolves.toBeUndefined();
  });
});
