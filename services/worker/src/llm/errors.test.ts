import { describe, expect, it } from "vitest";
import { LlmError, type LlmErrorKind } from "./errors.js";

describe("LlmError", () => {
  it("carries kind, message, rawText, name and cause", () => {
    const cause = new Error("root");
    const err = new LlmError("bad_output", "not json", "{oops", { cause });

    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({
      name: "LlmError",
      kind: "bad_output",
      message: "not json",
      rawText: "{oops",
    });
    expect(err.cause).toBe(cause);
  });

  it("leaves rawText undefined when not given", () => {
    expect(new LlmError("auth", "401").rawText).toBeUndefined();
  });

  it.each<[LlmErrorKind, boolean]>([
    ["timeout", true],
    ["rate_limited", true],
    ["unavailable", true],
    ["auth", false],
    ["invalid_request", false],
    ["bad_output", false],
  ])("%s retryable = %s", (kind, retryable) => {
    expect(new LlmError(kind, "x").retryable).toBe(retryable);
  });
});
