import { APIConnectionError, APIConnectionTimeoutError, APIError } from "openai";
import { describe, expect, it } from "vitest";
import { openAIErrorKind } from "./openai-errors.js";

// The error the sdk builds for a response with this status.
const status = (code: number) => APIError.generate(code, {}, "nope", new Headers());

describe("openAIErrorKind", () => {
  it.each([
    [400, "invalid_request"],
    [401, "auth"],
    [403, "auth"],
    [404, "invalid_request"],
    [409, "rate_limited"],
    [422, "invalid_request"],
    [429, "rate_limited"],
    [500, "unavailable"],
    [503, "unavailable"],
    // No class of its own in the sdk, a plain APIError.
    [413, "invalid_request"],
  ])("maps http %i to %s", (code, kind) => {
    expect(openAIErrorKind(status(code))).toBe(kind);
  });

  it("tells a timeout from a connection that failed", () => {
    // The timeout extends the connection error, so the order of the checks matters.
    expect(openAIErrorKind(new APIConnectionTimeoutError())).toBe("timeout");
    expect(openAIErrorKind(new APIConnectionError({ message: "Connection error." }))).toBe(
      "unavailable",
    );
  });

  it("takes an error without a status for the provider being away", () => {
    expect(openAIErrorKind(new APIError(undefined, undefined, "stream ended", undefined))).toBe(
      "unavailable",
    );
  });
});
