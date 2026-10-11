import { describe, expect, it } from "vitest";
import { pollInterval } from "./hooks.js";

describe("pollInterval", () => {
  it("polls every 2s while something is queued or processing", () => {
    expect(pollInterval(["completed", "queued"])).toBe(2000);
    expect(pollInterval(["processing"])).toBe(2000);
  });

  it("stops once everything is terminal", () => {
    expect(pollInterval(["completed", "failed"])).toBe(false);
  });

  it("does not poll with nothing loaded", () => {
    expect(pollInterval([])).toBe(false);
  });
});
