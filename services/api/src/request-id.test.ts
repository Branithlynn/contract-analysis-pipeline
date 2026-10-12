import { describe, expect, it } from "vitest";
import { createLogger, loadConfig, openMemoryDb, MockEmbedder } from "@nexus/shared/node";
import { requestIdFrom } from "./request-id.js";
import { buildServer } from "./server.js";
import { okQueue } from "./test-support/fixtures.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("requestIdFrom", () => {
  it("keeps a sane incoming id", () => {
    // nginx's $request_id is 32 hex chars.
    expect(requestIdFrom("5f0c2f6c1d3b4a7e9a1b2c3d4e5f6a7b")).toBe(
      "5f0c2f6c1d3b4a7e9a1b2c3d4e5f6a7b",
    );
    expect(requestIdFrom("a")).toBe("a");
    expect(requestIdFrom("A".repeat(64))).toBe("A".repeat(64));
    expect(requestIdFrom("abc-123-DEF")).toBe("abc-123-DEF");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["too long", "a".repeat(65)],
    ["space", "abc def"],
    ["newline", "abc\ndef"],
    ["quote and brace", '{"injected":"x"}'],
    ["underscore", "abc_def"],
    ["sent twice", ["abc", "def"]],
  ])("falls back to a uuid when the header is %s", (_name, header) => {
    expect(requestIdFrom(header)).toMatch(UUID);
  });
});

describe("request id in the api logs", () => {
  async function setup() {
    const lines: Record<string, unknown>[] = [];
    const stream = {
      write: (chunk: string) => lines.push(JSON.parse(chunk) as Record<string, unknown>),
    };
    const app = await buildServer({
      db: openMemoryDb(),
      queue: okQueue,
      config: loadConfig({}),
      logger: createLogger("api", "info", stream),
      embedder: new MockEmbedder(),
      clock: () => new Date("2026-06-01T12:00:00Z"),
    });
    return { app, lines };
  }

  it("logs the id the proxy sent", async () => {
    const { app, lines } = await setup();
    await app.inject({
      method: "GET",
      url: "/healthz",
      headers: { "x-request-id": "5f0c2f6c1d3b4a7e9a1b2c3d4e5f6a7b" },
    });
    const ids = lines.filter((line) => "reqId" in line).map((line) => line["reqId"]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids)).toEqual(new Set(["5f0c2f6c1d3b4a7e9a1b2c3d4e5f6a7b"]));
  });

  it("logs its own uuid when the incoming id is not sane", async () => {
    const { app, lines } = await setup();
    await app.inject({
      method: "GET",
      url: "/healthz",
      headers: { "x-request-id": "not sane, has spaces" },
    });
    const ids = lines.filter((line) => "reqId" in line).map((line) => line["reqId"]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toMatch(UUID);
  });
});
