import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@nexus/shared/node";
import { createShutdown } from "./shutdown.js";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = {
    write: (chunk: string) => lines.push(JSON.parse(chunk) as Record<string, unknown>),
  };
  return { lines, logger: createLogger("api", "info", stream) };
}

describe("createShutdown", () => {
  it("closes the steps in order, once, then exits 0", async () => {
    const order: string[] = [];
    const exit = vi.fn();
    const { logger, lines } = capture();
    const shutdown = createShutdown({
      logger,
      exit,
      steps: [
        ["reconciler", () => void order.push("reconciler")],
        ["http", async () => void order.push("http")],
        ["queue", async () => void order.push("queue")],
        ["db", () => void order.push("db")],
      ],
    });

    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);

    expect(order).toEqual(["reconciler", "http", "queue", "db"]);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(lines[0]).toMatchObject({ msg: "shutting down", signal: "SIGTERM" });
    expect(lines.at(-1)).toMatchObject({ msg: "shutdown complete" });
  });

  it("logs a failing step and still closes the rest", async () => {
    const order: string[] = [];
    const exit = vi.fn();
    const { logger, lines } = capture();
    const shutdown = createShutdown({
      logger,
      exit,
      steps: [
        [
          "queue",
          () => {
            throw new Error("redis gone");
          },
        ],
        ["db", () => void order.push("db")],
      ],
    });

    await shutdown("SIGTERM");

    expect(order).toEqual(["db"]);
    expect(lines.find((l) => l.msg === "queue close failed")?.err).toMatchObject({
      message: "redis gone",
    });
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("forces exit 1 when a step hangs past the timeout", async () => {
    vi.useFakeTimers();
    try {
      const exit = vi.fn();
      const { logger, lines } = capture();
      const shutdown = createShutdown({
        logger,
        exit,
        forceAfterMs: 10_000,
        steps: [["http", () => new Promise<void>(() => undefined)]],
      });

      void shutdown("SIGTERM");
      await vi.advanceTimersByTimeAsync(9_999);
      expect(exit).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(exit).toHaveBeenCalledWith(1);
      expect(lines.some((l) => l.msg === "shutdown timed out, forcing exit")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
