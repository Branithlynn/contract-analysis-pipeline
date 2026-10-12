import type { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QUEUE_NAMES, createLogger, jobIdFor } from "@nexus/shared/node";
import { BullMqJobQueue } from "./queue.js";

// No redis in unit tests. The fakes stand in for the two clients, so what is tested here is our
// own code around them: the ready guard, the job options, the ping timeout and the close order.
const fakes = vi.hoisted(() => ({
  redis: [] as unknown[],
  queues: [] as unknown[],
  closed: [] as string[],
}));

// The factories run before this file's imports, so they load EventEmitter themselves.
vi.mock("ioredis", async () => {
  const { EventEmitter } = await import("node:events");
  class Redis extends EventEmitter {
    status = "ready";
    ping = vi.fn(() => Promise.resolve("PONG"));
    quit = vi.fn(() => {
      fakes.closed.push("redis");
      return Promise.resolve("OK");
    });
    constructor(
      readonly url: string,
      readonly options: unknown,
    ) {
      super();
      fakes.redis.push(this);
    }
  }
  return { Redis };
});

vi.mock("bullmq", async () => {
  const { EventEmitter } = await import("node:events");
  class Queue extends EventEmitter {
    add = vi.fn(() => Promise.resolve());
    close = vi.fn(() => {
      fakes.closed.push("queue");
      return Promise.resolve();
    });
    constructor(
      readonly name: string,
      readonly options: unknown,
    ) {
      super();
      fakes.queues.push(this);
    }
  }
  return { Queue };
});

interface FakeRedis extends EventEmitter {
  status: string;
  url: string;
  options: unknown;
  ping: ReturnType<typeof vi.fn>;
}

interface FakeQueue extends EventEmitter {
  name: string;
  options: { connection: unknown };
  add: ReturnType<typeof vi.fn>;
}

const ID = "00000000-0000-4000-8000-000000000001";
const MOCK = { provider: "mock", model: "mock" } as const;
const OLLAMA = { provider: "ollama", model: "qwen2.5:7b-instruct" } as const;

function setup() {
  const lines: Record<string, unknown>[] = [];
  const stream = {
    write: (chunk: string) => lines.push(JSON.parse(chunk) as Record<string, unknown>),
  };
  const queue = new BullMqJobQueue("redis://example:6379", 3, createLogger("api", "debug", stream));
  const redis = fakes.redis.at(-1) as FakeRedis;
  // Created in this order: the queue for ollama jobs, then the one for everything else.
  const [local, hosted] = fakes.queues.slice(-2) as [FakeQueue, FakeQueue];
  return { queue, redis, local, hosted, bull: hosted, lines };
}

afterEach(() => {
  vi.useRealTimers();
  fakes.redis.length = 0;
  fakes.queues.length = 0;
  fakes.closed.length = 0;
});

describe("BullMqJobQueue", () => {
  it("opens a fail fast connection and hands the same one to bullmq", () => {
    const { redis, local, hosted } = setup();

    expect(redis.url).toBe("redis://example:6379");
    expect(redis.options).toEqual({ enableOfflineQueue: false, commandTimeout: 2000 });
    expect(fakes.queues).toHaveLength(2);
    expect([local.name, hosted.name]).toEqual([QUEUE_NAMES.local, QUEUE_NAMES.hosted]);
    expect(local.name).not.toBe(hosted.name);
    for (const bull of [local, hosted]) {
      expect(bull.options.connection).toBe(redis);
      expect(bull.options).not.toHaveProperty("prefix");
    }
  });

  it("passes a key prefix on to bullmq when it is given one", () => {
    new BullMqJobQueue("redis://example:6379", 3, createLogger("api", "silent"), 100, "nexus-e2e");

    expect(fakes.queues.slice(-2)).toMatchObject([
      { options: { prefix: "nexus-e2e" } },
      { options: { prefix: "nexus-e2e" } },
    ]);
  });

  it("adds the job under the document and run id, with the retry and cleanup options", async () => {
    const { queue, bull } = setup();

    await queue.enqueue(ID, 2, MOCK);

    expect(bull.add.mock.calls).toEqual([
      [
        "extract",
        { documentId: ID, run: 2, provider: "mock", model: "mock" },
        {
          jobId: jobIdFor(ID, 2),
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: { age: 604800 },
          removeOnFail: { age: 604800 },
        },
      ],
    ]);
  });

  it("rejects right away without calling add when redis is not ready", async () => {
    const { queue, redis, bull } = setup();
    redis.status = "reconnecting";

    expect(queue.isReady()).toBe(false);
    await expect(queue.enqueue(ID, 1, MOCK)).rejects.toThrow(
      "redis is not ready (status reconnecting)",
    );
    expect(bull.add).not.toHaveBeenCalled();
  });

  it("rejects a payload that is not a valid job before touching the queue", async () => {
    const { queue, bull } = setup();

    await expect(queue.enqueue("not-a-uuid", 1, MOCK)).rejects.toThrow();
    await expect(queue.enqueue(ID, 0, MOCK)).rejects.toThrow();
    await expect(queue.enqueue(ID, 1, { provider: "mock", model: "" })).rejects.toThrow();
    expect(bull.add).not.toHaveBeenCalled();
  });

  it("ping resolves when redis answers and leaves no timer behind", async () => {
    vi.useFakeTimers();
    const { queue } = setup();

    await expect(queue.ping()).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ping rejects after 1000ms when redis never answers", async () => {
    vi.useFakeTimers();
    const { queue, redis } = setup();
    redis.ping.mockReturnValue(new Promise(() => undefined));

    const result = queue.ping().then(
      () => "resolved",
      (err: unknown) => err,
    );
    await vi.advanceTimersByTimeAsync(999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(await result).toMatchObject({ message: "redis ping timed out after 1000ms" });
  });

  it("ping passes a redis error through", async () => {
    const { queue, redis } = setup();
    redis.ping.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(queue.ping()).rejects.toThrow("ECONNREFUSED");
  });

  it("calls an onReady listener on every ready event until it is unsubscribed", () => {
    const { queue, redis } = setup();
    const listener = vi.fn();

    const off = queue.onReady(listener);
    redis.emit("ready");
    redis.emit("ready");
    off();
    redis.emit("ready");

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("logs a connection error from bullmq as a warning instead of letting it throw", () => {
    const { bull, lines } = setup();

    // An EventEmitter throws on "error" when nobody listens.
    expect(() => bull.emit("error", new Error("ECONNRESET"))).not.toThrow();
    expect(lines).toEqual([
      expect.objectContaining({
        level: 40,
        msg: "redis connection error",
        err: expect.objectContaining({ message: "ECONNRESET" }) as unknown,
      }),
    ]);
  });

  it("closes both queues before the connection they run on", async () => {
    const { queue } = setup();

    await queue.close();

    expect(fakes.closed).toEqual(["queue", "queue", "redis"]);
  });

  it("puts an ollama job on the local queue and nothing on the hosted one", async () => {
    const { queue, local, hosted } = setup();

    await queue.enqueue(ID, 1, OLLAMA);

    expect(local.add).toHaveBeenCalledTimes(1);
    expect(local.add.mock.calls[0]?.[1]).toEqual({
      documentId: ID,
      run: 1,
      provider: "ollama",
      model: "qwen2.5:7b-instruct",
    });
    expect(hosted.add).not.toHaveBeenCalled();
  });

  it("puts openai, anthropic and mock jobs on the hosted queue", async () => {
    const { queue, local, hosted } = setup();

    await queue.enqueue(ID, 1, { provider: "openai", model: "gpt-5-mini" });
    await queue.enqueue(ID, 2, { provider: "anthropic", model: "claude-sonnet-5-5" });
    await queue.enqueue(ID, 3, MOCK);

    expect(hosted.add.mock.calls.map((call) => (call[1] as { provider: string }).provider)).toEqual(
      ["openai", "anthropic", "mock"],
    );
    expect(local.add).not.toHaveBeenCalled();
  });
});
