import { LlmError, loadConfig, type ModelSelection } from "@nexus/shared/node";
import { describe, expect, it, vi } from "vitest";
import { createProviderFor, createProviderRegistry } from "./factory.js";
import { MockProvider } from "./mock.js";
import type { LlmProvider } from "./types.js";

// Building a provider for what a job asks for, instead of one for the whole worker.

const KEYS = {
  OPENAI_API_KEY: "test-openai-key",
  ANTHROPIC_API_KEY: "test-anthropic-key",
  ALLOW_MOCK: "true",
};

function refusal(config: ReturnType<typeof loadConfig>, selection: ModelSelection): LlmError {
  try {
    createProviderFor(config, selection);
  } catch (err) {
    if (err instanceof LlmError) return err;
    throw err;
  }
  throw new Error("expected createProviderFor to throw");
}

describe("createProviderFor", () => {
  it("builds the provider the selection names, with the selection's model", async () => {
    const config = loadConfig({ ...KEYS, OPENAI_MODELS: "gpt-5-mini,gpt-5" });

    const ollama = createProviderFor(config, { provider: "ollama", model: "llama3.2:3b" });
    expect(ollama).toMatchObject({ name: "ollama", model: "llama3.2:3b" });
    await ollama.close?.();
    expect(createProviderFor(config, { provider: "openai", model: "gpt-5" })).toMatchObject({
      name: "openai",
      model: "gpt-5",
    });
    expect(
      createProviderFor(config, { provider: "anthropic", model: "claude-sonnet-5-5" }),
    ).toMatchObject({ name: "anthropic", model: "claude-sonnet-5-5" });
    const mock = createProviderFor(config, { provider: "mock", model: "mock-alt" });
    expect(mock).toBeInstanceOf(MockProvider);
    expect(mock).toMatchObject({ name: "mock", model: "mock-alt" });
  });

  it("does not depend on LLM_PROVIDER: the environment default is ollama here", () => {
    const config = loadConfig(KEYS);
    expect(config.LLM_PROVIDER).toBe("ollama");

    expect(createProviderFor(config, { provider: "openai", model: "gpt-5-mini" }).name).toBe(
      "openai",
    );
  });

  it("refuses a hosted provider whose key the worker does not have, as an auth error", () => {
    const err = refusal(loadConfig({}), { provider: "openai", model: "gpt-5-mini" });

    // auth is not retryable: the job fails once with LLM_AUTH instead of three times.
    expect(err).toMatchObject({
      kind: "auth",
      retryable: false,
      message: "OPENAI_API_KEY is not set for the worker",
    });
    expect(
      refusal(loadConfig({}), { provider: "anthropic", model: "claude-sonnet-5-5" }),
    ).toMatchObject({ kind: "auth", message: "ANTHROPIC_API_KEY is not set for the worker" });
  });

  it("refuses a hosted model that is not on the allowlist, even though the key is there", () => {
    const config = loadConfig(KEYS);

    expect(refusal(config, { provider: "openai", model: "gpt-5-pro" })).toMatchObject({
      kind: "invalid_request",
      retryable: false,
      message: "Model gpt-5-pro is not in OPENAI_MODELS",
    });
    expect(refusal(config, { provider: "anthropic", model: "claude-opus-5-5" })).toMatchObject({
      message: "Model claude-opus-5-5 is not in ANTHROPIC_MODELS",
    });
  });

  it("refuses the mock when ALLOW_MOCK is not true, and a model that is not a mock model", () => {
    expect(refusal(loadConfig({}), { provider: "mock", model: "mock" })).toMatchObject({
      kind: "invalid_request",
      message: "The mock provider is off (ALLOW_MOCK is not true)",
    });
    expect(refusal(loadConfig(KEYS), { provider: "mock", model: "gpt-5" })).toMatchObject({
      message: "Model gpt-5 is not a mock model",
    });
  });
});

describe("createProviderRegistry", () => {
  const fake = (
    selection: ModelSelection,
    close = vi.fn(() => Promise.resolve()),
  ): LlmProvider => ({
    name: selection.provider,
    model: selection.model,
    complete: () => Promise.reject(new Error("not used")),
    close,
  });

  it("builds a provider on first use and hands out the same one for the same selection", () => {
    const create = vi.fn((_config: unknown, selection: ModelSelection) => fake(selection));
    const registry = createProviderRegistry(loadConfig(KEYS), create);
    expect(create).not.toHaveBeenCalled();

    const a = registry.get({ provider: "ollama", model: "qwen2.5:7b-instruct" });
    const again = registry.get({ provider: "ollama", model: "qwen2.5:7b-instruct" });
    const otherModel = registry.get({ provider: "ollama", model: "llama3.2:3b" });
    const otherProvider = registry.get({ provider: "openai", model: "gpt-5-mini" });

    expect(again).toBe(a);
    expect(otherModel).not.toBe(a);
    expect(otherProvider).not.toBe(a);
    expect(create).toHaveBeenCalledTimes(3);
    expect(otherModel).toMatchObject({ name: "ollama", model: "llama3.2:3b" });
  });

  it("does not keep a provider that could not be built, so a later job is checked again", () => {
    const registry = createProviderRegistry(loadConfig({}));
    const selection: ModelSelection = { provider: "openai", model: "gpt-5-mini" };

    expect(() => registry.get(selection)).toThrow("OPENAI_API_KEY is not set for the worker");
    expect(() => registry.get(selection)).toThrow(LlmError);
  });

  it("closes every provider it built", async () => {
    const closed: string[] = [];
    const registry = createProviderRegistry(loadConfig(KEYS), (_config, selection) =>
      fake(
        selection,
        vi.fn(() => {
          closed.push(selection.model);
          return Promise.resolve();
        }),
      ),
    );
    registry.get({ provider: "ollama", model: "a" });
    registry.get({ provider: "ollama", model: "b" });

    await registry.close();

    expect(closed.sort()).toEqual(["a", "b"]);
  });

  it("with the real factory gives a mock job a mock and an ollama job an ollama provider", async () => {
    const registry = createProviderRegistry(loadConfig(KEYS));

    expect(registry.get({ provider: "mock", model: "mock" })).toBeInstanceOf(MockProvider);
    expect(registry.get({ provider: "ollama", model: "qwen2.5:7b-instruct" }).name).toBe("ollama");
    await registry.close();
  });
});
