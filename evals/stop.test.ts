import { describe, expect, it } from "vitest";
import { stopReason } from "./stop.js";

const ok = { error_code: null };
const down = { error_code: "LLM_UNAVAILABLE" };
const scan = { error_code: "NO_TEXT_LAYER" };

describe("stopReason", () => {
  it("keeps going on an empty run, on successes and on one unavailable case", () => {
    expect(stopReason([])).toBeNull();
    expect(stopReason([ok, ok])).toBeNull();
    expect(stopReason([down])).toBeNull();
    expect(stopReason([ok, down])).toBeNull();
  });

  it("stops after two unavailable cases in a row", () => {
    expect(stopReason([down, down])).toBe(
      "2 cases in a row failed with LLM_UNAVAILABLE, so the provider is down or stuck",
    );
    expect(stopReason([ok, ok, down, down])).not.toBeNull();
  });

  it("starts counting again after any case that got through", () => {
    expect(stopReason([down, ok, down])).toBeNull();
    expect(stopReason([down, down, ok])).toBeNull();
  });

  it("only counts unavailable, not other failures", () => {
    // The scanned sample fails on purpose, and it fails before any model is called.
    expect(stopReason([scan, scan])).toBeNull();
    expect(stopReason([down, scan, down])).toBeNull();
    expect(stopReason([{ error_code: "EXTRACTION_INVALID" }, down])).toBeNull();
  });
});
