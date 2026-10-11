import { createLogger } from "@nexus/shared/node";
import { describe, expect, it } from "vitest";
import { concurrencyFor } from "./concurrency.js";

function setup() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger("worker", "debug", {
    write: (chunk: string) => lines.push(JSON.parse(chunk) as Record<string, unknown>),
  });
  return { logger, lines };
}

describe("concurrencyFor", () => {
  it("forces ollama to 1 and logs which setting was ignored", () => {
    const { logger, lines } = setup();

    expect(concurrencyFor({ name: "ollama" }, 2, "WORKER_CONCURRENCY", logger)).toBe(1);
    expect(lines).toEqual([
      expect.objectContaining({
        configured: 2,
        setting: "WORKER_CONCURRENCY",
        msg: "ollama runs one call at a time, ignoring WORKER_CONCURRENCY",
      }),
    ]);
  });

  it("says nothing when ollama is already configured for 1", () => {
    const { logger, lines } = setup();

    expect(concurrencyFor({ name: "ollama" }, 1, "WORKER_CONCURRENCY", logger)).toBe(1);
    expect(lines).toEqual([]);
  });

  it.each(["anthropic", "openai", "mock"] as const)("keeps the configured value for %s", (name) => {
    const { logger, lines } = setup();

    expect(concurrencyFor({ name }, 4, "LLM_CHUNK_CONCURRENCY", logger)).toBe(4);
    expect(lines).toEqual([]);
  });
});
