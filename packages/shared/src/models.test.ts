import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { defaultModelSelection, hostedModels, selectionOr } from "./models.js";

describe("model selection", () => {
  it("takes the default from LLM_PROVIDER and LLM_MODEL", () => {
    expect(defaultModelSelection({ LLM_PROVIDER: "ollama", LLM_MODEL: "qwen2.5:3b" })).toEqual({
      provider: "ollama",
      model: "qwen2.5:3b",
    });
  });

  it("lists the hosted models of one provider, the default model included", () => {
    const config = loadConfig({
      LLM_PROVIDER: "anthropic",
      LLM_MODEL: "claude-sonnet-5-5",
      ANTHROPIC_API_KEY: "test-anthropic-key",
      ANTHROPIC_MODELS: "claude-haiku-5-5",
      OPENAI_MODELS: "gpt-5-mini, gpt-5",
    });

    expect(hostedModels(config, "anthropic")).toEqual(["claude-sonnet-5-5", "claude-haiku-5-5"]);
    expect(hostedModels(config, "openai")).toEqual(["gpt-5-mini", "gpt-5"]);
  });

  it("uses what a row or a job says, and the default for one from before model selection", () => {
    const fallback = { provider: "ollama", model: "qwen2.5:7b-instruct" } as const;

    expect(selectionOr({ provider: "openai", model: "gpt-5-mini" }, fallback)).toEqual({
      provider: "openai",
      model: "gpt-5-mini",
    });
    expect(selectionOr({}, fallback)).toEqual(fallback);
    expect(selectionOr({ provider: null, model: null }, fallback)).toEqual(fallback);
    // Half a selection is none: a provider without a model cannot be called.
    expect(selectionOr({ provider: "openai", model: null }, fallback)).toEqual(fallback);
    expect(selectionOr({ model: "gpt-5-mini" }, fallback)).toEqual(fallback);
  });
});
