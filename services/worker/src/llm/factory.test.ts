import { loadConfig } from "@nexus/shared/node";
import { describe, expect, it } from "vitest";
import { createProvider, ollamaContextFloor } from "./factory.js";
import { MockProvider } from "./mock.js";

describe("ollamaContextFloor", () => {
  // Pinned so a prompt or schema change that moves the size shows up here.
  it("sizes one floor for extract.v1 and summary.v1", () => {
    expect(ollamaContextFloor(24000)).toBe(14336);
    expect(ollamaContextFloor(12000)).toBe(10240);
  });
});

describe("createProvider", () => {
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
    const provider = createProvider(loadConfig({ LLM_PROVIDER: "mock" }));

    expect(provider).toBeInstanceOf(MockProvider);
  });

  it("refuses to build a keyed provider from a config that skipped validation", () => {
    const config = { ...loadConfig({}), LLM_PROVIDER: "openai" as const };

    expect(() => createProvider(config)).toThrow("OPENAI_API_KEY");
  });
});
