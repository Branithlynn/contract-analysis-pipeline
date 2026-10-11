import { describe, expect, it } from "vitest";
import { mapLimit } from "./limit.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("mapLimit", () => {
  it("keeps input order even when later items finish first", async () => {
    const delays = [30, 5, 15, 0];
    const result = await mapLimit(delays, 2, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return `${i}:${ms}`;
    });
    expect(result).toEqual(["0:30", "1:5", "2:15", "3:0"]);
  });

  it("never runs more than limit at once", async () => {
    let running = 0;
    let peak = 0;
    await mapLimit(
      Array.from({ length: 10 }, (_, i) => i),
      3,
      async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 1));
        running--;
      },
    );
    expect(peak).toBe(3);
  });

  it("returns [] for no items", async () => {
    expect(await mapLimit([], 2, () => Promise.resolve(1))).toEqual([]);
  });

  it("rejects with the first error and starts no new items after it", async () => {
    const gate = deferred();
    const started: number[] = [];
    const run = mapLimit([0, 1, 2, 3], 2, async (n) => {
      started.push(n);
      if (n === 0) throw new Error("boom");
      await gate.promise;
      return n;
    });
    await expect(run).rejects.toThrow("boom");
    gate.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual([0, 1]);
  });

  it("throws on a limit below 1", async () => {
    await expect(mapLimit([1], 0, () => Promise.resolve(1))).rejects.toThrow(RangeError);
  });
});
