import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.js";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = {
    write: (chunk: string) => lines.push(JSON.parse(chunk) as Record<string, unknown>),
  };
  return { lines, stream };
}

describe("createLogger", () => {
  it("adds the service, an iso time and the documentId binding", () => {
    const { lines, stream } = capture();
    createLogger("worker", "info", stream).info({ documentId: "doc-1" }, "parsed");
    expect(lines[0]).toMatchObject({ service: "worker", documentId: "doc-1", msg: "parsed" });
    expect(lines[0]?.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("redacts top level api keys", () => {
    const { lines, stream } = capture();
    createLogger("api", "info", stream).info({ apiKey: "sk-1", api_key: "sk-2" }, "boot");
    expect(lines[0]).toMatchObject({ apiKey: "[Redacted]", api_key: "[Redacted]" });
  });

  it("redacts the auth header and nested api keys", () => {
    const { lines, stream } = capture();
    createLogger("api", "info", stream).info(
      {
        req: { headers: { authorization: "Bearer secret", host: "x" } },
        provider: { apiKey: "sk-1", name: "openai" },
        config: { api_key: "sk-2" },
      },
      "request",
    );
    expect(lines[0]).toMatchObject({
      req: { headers: { authorization: "[Redacted]", host: "x" } },
      provider: { apiKey: "[Redacted]", name: "openai" },
      config: { api_key: "[Redacted]" },
    });
  });

  it("respects the level", () => {
    const { lines, stream } = capture();
    createLogger("api", "warn", stream).info("hidden");
    expect(lines).toHaveLength(0);
  });
});
