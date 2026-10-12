import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("applies the .env.example defaults to an empty env", () => {
    const config = loadConfig({});
    expect(config.API_PORT).toBe(3000);
    expect(config.LLM_PROVIDER).toBe("ollama");
    expect(config.LLM_TIMEOUT_MS).toBe(300000);
    expect(config.LLM_MAX_INPUT_CHARS).toBe(12000);
    expect(config.GROUNDING_REVIEW_THRESHOLD).toBe(0.8);
  });

  it("takes an extraction prompt version it knows and defaults to extract.v3", () => {
    expect(loadConfig({}).PROMPT_VERSION).toBe("extract.v3");
    expect(loadConfig({ PROMPT_VERSION: "" }).PROMPT_VERSION).toBe("extract.v3");
    // The older versions stay selectable, for rerunning an eval against them.
    expect(loadConfig({ PROMPT_VERSION: "extract.v1" }).PROMPT_VERSION).toBe("extract.v1");
    expect(loadConfig({ PROMPT_VERSION: "extract.v2" }).PROMPT_VERSION).toBe("extract.v2");
    expect(() => loadConfig({ PROMPT_VERSION: "extract.v9" })).toThrow("PROMPT_VERSION");
  });

  it("coerces numeric strings", () => {
    const config = loadConfig({ MAX_UPLOAD_MB: "5", WORKER_CONCURRENCY: "4" });
    expect(config.MAX_UPLOAD_MB).toBe(5);
    expect(config.WORKER_CONCURRENCY).toBe(4);
  });

  it("treats empty values as unset, like the blank keys in .env.example", () => {
    const config = loadConfig({ ANTHROPIC_API_KEY: "", API_PORT: "" });
    expect(config.ANTHROPIC_API_KEY).toBeUndefined();
    expect(config.API_PORT).toBe(3000);
  });

  it("requires the api key of the selected provider only", () => {
    expect(() => loadConfig({ LLM_PROVIDER: "anthropic" })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => loadConfig({ LLM_PROVIDER: "openai" })).toThrow(/OPENAI_API_KEY/);
    expect(
      loadConfig({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-anthropic-key" })
        .LLM_PROVIDER,
    ).toBe("anthropic");
    expect(loadConfig({ LLM_PROVIDER: "mock", ALLOW_MOCK: "true" }).LLM_PROVIDER).toBe("mock");
  });

  it("lists every bad key on its own line", () => {
    let message = "";
    try {
      loadConfig({
        API_PORT: "not-a-number",
        LLM_PROVIDER: "gemini",
        REDIS_URL: "nope",
        GROUNDING_REVIEW_THRESHOLD: "1.5",
      });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    const lines = message.split("\n");
    for (const key of ["API_PORT", "LLM_PROVIDER", "REDIS_URL", "GROUNDING_REVIEW_THRESHOLD"]) {
      expect(lines.filter((line) => line.trimStart().startsWith(`${key}:`))).toHaveLength(1);
    }
  });

  it("lists the missing api key together with other errors", () => {
    expect(() => loadConfig({ LLM_PROVIDER: "openai", JOB_ATTEMPTS: "0" })).toThrow(
      /OPENAI_API_KEY[\s\S]*JOB_ATTEMPTS|JOB_ATTEMPTS[\s\S]*OPENAI_API_KEY/,
    );
  });

  it("lists the missing api key even when another key fails its type check", () => {
    let message = "";
    try {
      loadConfig({ LLM_PROVIDER: "openai", API_PORT: "not-a-number" });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toMatch(/^ {2}API_PORT:/m);
    expect(message).toMatch(/^ {2}OPENAI_API_KEY:/m);
  });

  it("defaults embeddings to ollama and picks the model that goes with the provider", () => {
    expect(loadConfig({})).toMatchObject({
      EMBED_PROVIDER: "ollama",
      EMBED_MODEL: "nomic-embed-text",
    });
    expect(
      loadConfig({ EMBED_PROVIDER: "openai", OPENAI_API_KEY: "test-openai-key" }).EMBED_MODEL,
    ).toBe("text-embedding-3-small");
    expect(loadConfig({ EMBED_PROVIDER: "mock" }).EMBED_MODEL).toBe("mock");
    // Blank counts as unset, compose passes EMBED_MODEL through like that.
    expect(loadConfig({ EMBED_PROVIDER: "mock", EMBED_MODEL: "" }).EMBED_MODEL).toBe("mock");
    expect(loadConfig({ EMBED_MODEL: "mxbai-embed-large" }).EMBED_MODEL).toBe("mxbai-embed-large");
  });

  it("keeps ollama embeddings on the cpu unless EMBED_OLLAMA_NUM_GPU says otherwise", () => {
    expect(loadConfig({}).EMBED_OLLAMA_NUM_GPU).toBe(0);
    expect(loadConfig({ EMBED_OLLAMA_NUM_GPU: "" }).EMBED_OLLAMA_NUM_GPU).toBe(0);
    expect(loadConfig({ EMBED_OLLAMA_NUM_GPU: "99" }).EMBED_OLLAMA_NUM_GPU).toBe(99);
    // -1 is ollama's own "decide for me".
    expect(loadConfig({ EMBED_OLLAMA_NUM_GPU: "-1" }).EMBED_OLLAMA_NUM_GPU).toBe(-1);
    expect(() => loadConfig({ EMBED_OLLAMA_NUM_GPU: "-2" })).toThrow(/EMBED_OLLAMA_NUM_GPU/);
    expect(() => loadConfig({ EMBED_OLLAMA_NUM_GPU: "half" })).toThrow(/EMBED_OLLAMA_NUM_GPU/);
  });

  it("has no anthropic embeddings, and keeps the embed provider apart from the llm provider", () => {
    expect(() => loadConfig({ EMBED_PROVIDER: "anthropic" })).toThrow(/EMBED_PROVIDER/);
    expect(
      loadConfig({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-anthropic-key" })
        .EMBED_PROVIDER,
    ).toBe("ollama");
  });

  it("requires the openai key for openai embeddings, named once", () => {
    let message = "";
    try {
      loadConfig({ EMBED_PROVIDER: "openai" });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toMatch(/OPENAI_API_KEY: required when EMBED_PROVIDER=openai/);

    try {
      loadConfig({ EMBED_PROVIDER: "openai", LLM_PROVIDER: "openai" });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message.match(/OPENAI_API_KEY/g)).toHaveLength(1);
  });

  it("only takes the mock as the default provider when ALLOW_MOCK is true", () => {
    expect(loadConfig({}).ALLOW_MOCK).toBe(false);
    expect(loadConfig({ ALLOW_MOCK: "true" }).ALLOW_MOCK).toBe(true);
    expect(loadConfig({ ALLOW_MOCK: "" }).ALLOW_MOCK).toBe(false);
    expect(() => loadConfig({ LLM_PROVIDER: "mock" })).toThrow(
      /ALLOW_MOCK: has to be true when LLM_PROVIDER=mock/,
    );
    expect(() => loadConfig({ LLM_PROVIDER: "mock", ALLOW_MOCK: "false" })).toThrow(/ALLOW_MOCK/);
    expect(() => loadConfig({ ALLOW_MOCK: "yes" })).toThrow(/ALLOW_MOCK/);
  });

  it("gives the mock one of its own model names, whatever LLM_MODEL still says", () => {
    const mock = { LLM_PROVIDER: "mock", ALLOW_MOCK: "true" };
    // LLM_MODEL left at the ollama default, as in a .env where only the provider was switched.
    expect(loadConfig(mock).LLM_MODEL).toBe("mock");
    expect(loadConfig({ ...mock, LLM_MODEL: "gpt-5-mini" }).LLM_MODEL).toBe("mock");
    expect(loadConfig({ ...mock, LLM_MODEL: "mock-alt" }).LLM_MODEL).toBe("mock-alt");
    expect(loadConfig({}).LLM_MODEL).toBe("qwen2.5:7b-instruct");
  });

  it("reads the hosted model allowlists and puts the default model on its own provider's list", () => {
    expect(loadConfig({})).toMatchObject({
      OPENAI_MODELS: ["gpt-5-mini"],
      ANTHROPIC_MODELS: ["claude-sonnet-5-5"],
    });
    expect(loadConfig({ OPENAI_MODELS: "gpt-5-mini, gpt-5 ,,gpt-5" }).OPENAI_MODELS).toEqual([
      "gpt-5-mini",
      "gpt-5",
    ]);
    const openai = loadConfig({
      LLM_PROVIDER: "openai",
      LLM_MODEL: "gpt-5",
      OPENAI_API_KEY: "test-openai-key",
    });
    expect(openai.OPENAI_MODELS).toEqual(["gpt-5", "gpt-5-mini"]);
    expect(openai.ANTHROPIC_MODELS).toEqual(["claude-sonnet-5-5"]);
    // An ollama default model is not a hosted model.
    expect(loadConfig({ LLM_MODEL: "llama3.2" }).OPENAI_MODELS).toEqual(["gpt-5-mini"]);
  });

  it("returns the same object for the same env", () => {
    const env = { LOG_LEVEL: "debug" };
    expect(loadConfig(env)).toBe(loadConfig(env));
  });
});
