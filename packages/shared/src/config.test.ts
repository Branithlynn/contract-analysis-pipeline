import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("applies the .env.example defaults to an empty env", () => {
    const config = loadConfig({});
    expect(config.API_PORT).toBe(3000);
    expect(config.LLM_PROVIDER).toBe("ollama");
    expect(config.LLM_TIMEOUT_MS).toBe(180000);
    expect(config.GROUNDING_REVIEW_THRESHOLD).toBe(0.8);
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
      loadConfig({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-test" }).LLM_PROVIDER,
    ).toBe("anthropic");
    expect(loadConfig({ LLM_PROVIDER: "mock" }).LLM_PROVIDER).toBe("mock");
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

  it("returns the same object for the same env", () => {
    const env = { LOG_LEVEL: "debug" };
    expect(loadConfig(env)).toBe(loadConfig(env));
  });
});
