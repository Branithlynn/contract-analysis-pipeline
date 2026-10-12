import { loadConfig } from "@nexus/shared/node";
import { describe, expect, it } from "vitest";
import { checkOllamaContext, createProvider, ollamaContextFloor } from "./factory.js";
import { MockProvider } from "./mock.js";

describe("ollamaContextFloor", () => {
  // Pinned so a prompt or schema change that moves the size shows up here.
  it("sizes one floor for extract.v1 and summary.v1", () => {
    expect(ollamaContextFloor(24000, "extract.v1")).toBe(14336);
    expect(ollamaContextFloor(12000, "extract.v1")).toBe(10240);
  });

  it("sizes the floor for the prompt version in use", () => {
    expect(ollamaContextFloor(24000, "extract.v2")).toBe(14336);
    expect(ollamaContextFloor(12000, "extract.v2")).toBe(10240);
  });
});

describe("checkOllamaContext", () => {
  it("fits with the defaults, so OLLAMA_NUM_CTX and LLM_MAX_INPUT_CHARS agree out of the box", () => {
    expect(checkOllamaContext(loadConfig({}))).toEqual({
      configured: 10240,
      needed: 10240,
      fits: true,
    });
  });

  it("does not fit when the chunks were made bigger and OLLAMA_NUM_CTX was left alone", () => {
    const config = loadConfig({ LLM_MAX_INPUT_CHARS: "24000" });

    expect(checkOllamaContext(config)).toEqual({ configured: 10240, needed: 14336, fits: false });
  });

  it("fits when OLLAMA_NUM_CTX is larger than needed", () => {
    const config = loadConfig({ OLLAMA_NUM_CTX: "16384" });

    expect(checkOllamaContext(config)).toMatchObject({ needed: 10240, fits: true });
  });
});

describe("createProvider", () => {
  it("gives ollama OLLAMA_NUM_CTX as the num_ctx of a call that fits", () => {
    const provider = createProvider(loadConfig({ OLLAMA_NUM_CTX: "12288" }));
    const request = {
      system: "s",
      messages: [{ role: "user" as const, content: "short" }],
      schema: {},
      schemaName: "x",
      timeoutMs: 1000,
      maxOutputTokens: 512,
    };

    expect(provider.numCtx?.(request)).toBe(12288);
  });

  it("defaults to ollama with LLM_MODEL", () => {
    const provider = createProvider(loadConfig({}));

    expect(provider).toMatchObject({ name: "ollama", model: "qwen2.5:7b-instruct" });
  });

  it("builds anthropic with LLM_MODEL", () => {
    const config = loadConfig({
      LLM_PROVIDER: "anthropic",
      LLM_MODEL: "claude-sonnet-5-5",
      ANTHROPIC_API_KEY: "test-key",
    });

    expect(createProvider(config)).toMatchObject({
      name: "anthropic",
      model: "claude-sonnet-5-5",
    });
  });

  it("builds openai with LLM_MODEL", () => {
    const config = loadConfig({
      LLM_PROVIDER: "openai",
      LLM_MODEL: "gpt-test-model",
      OPENAI_API_KEY: "test-key",
    });

    expect(createProvider(config)).toMatchObject({ name: "openai", model: "gpt-test-model" });
  });

  it("builds the mock", () => {
    const provider = createProvider(loadConfig({ LLM_PROVIDER: "mock", ALLOW_MOCK: "true" }));

    expect(provider).toBeInstanceOf(MockProvider);
  });

  it("refuses to build a keyed provider from a config that skipped validation", () => {
    const config = { ...loadConfig({}), LLM_PROVIDER: "openai" as const };

    expect(() => createProvider(config)).toThrow("OPENAI_API_KEY");
  });
});
