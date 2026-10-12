import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../errors.js";
import { createOllamaGate } from "./busy.js";

const logger = { warn: vi.fn() };

function gate(activeLocalJobs: () => Promise<number>, waitMs = 60) {
  return createOllamaGate({ activeLocalJobs, waitMs, pollMs: 10, logger });
}

describe("createOllamaGate", () => {
  it("lets a question through when the worker is not extracting", async () => {
    const release = await gate(() => Promise.resolve(0)).acquire();

    expect(release).toBeTypeOf("function");
  });

  it("answers MODEL_BUSY after the wait when the worker is still extracting", async () => {
    const active = vi.fn(() => Promise.resolve(1));
    const started = Date.now();

    const err = await gate(active)
      .acquire()
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 503, code: "MODEL_BUSY" });
    expect((err as HttpError).message).toMatch(/analyzing a document/);
    // It asked more than once, and gave up near the limit instead of hanging.
    expect(active.mock.calls.length).toBeGreaterThan(1);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("goes ahead when the extraction ends during the wait", async () => {
    let calls = 0;
    const release = await gate(() => Promise.resolve(++calls < 3 ? 1 : 0), 500).acquire();

    expect(calls).toBe(3);
    release();
  });

  it("holds a second question back while one is being answered, and frees it on release", async () => {
    const g = gate(() => Promise.resolve(0));
    const release = await g.acquire();

    await expect(g.acquire()).rejects.toMatchObject({
      code: "MODEL_BUSY",
      message: expect.stringMatching(/another question/) as string,
    });

    release();
    await expect(g.acquire()).resolves.toBeTypeOf("function");
  });

  it("does not refuse a question because redis is down", async () => {
    const release = await gate(() => Promise.reject(new Error("redis is not ready"))).acquire();

    expect(release).toBeTypeOf("function");
    expect(logger.warn).toHaveBeenCalled();
  });
});
