import { describe, expect, it } from "vitest";
import { ErrorCode } from "@nexus/shared";
import { PermanentError, TransientError, classifyError } from "./errors.js";

function withCode(code: string): Error {
  return Object.assign(new Error(`connect ${code}`), { code });
}

describe("PermanentError / TransientError", () => {
  it("carry code, message, name and cause", () => {
    const cause = new Error("root");
    const permanent = new PermanentError(ErrorCode.PARSE_ERROR, "bad pdf", { cause });
    const transient = new TransientError(ErrorCode.LLM_UNAVAILABLE, "ollama down");

    expect(permanent).toBeInstanceOf(Error);
    expect(permanent).toMatchObject({
      name: "PermanentError",
      code: "PARSE_ERROR",
      message: "bad pdf",
    });
    expect(permanent.cause).toBe(cause);
    expect(transient).toMatchObject({ name: "TransientError", code: "LLM_UNAVAILABLE" });
    expect(transient.cause).toBeUndefined();
  });
});

describe("classifyError", () => {
  it("returns already classified errors unchanged", () => {
    const permanent = new PermanentError(ErrorCode.NO_TEXT_LAYER, "scanned");
    const transient = new TransientError(ErrorCode.LLM_UNAVAILABLE, "down");

    expect(classifyError(permanent)).toBe(permanent);
    expect(classifyError(transient)).toBe(transient);
  });

  it.each(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"])(
    "maps %s to transient LLM_UNAVAILABLE",
    (code) => {
      const err = withCode(code);
      const result = classifyError(err);

      expect(result).toBeInstanceOf(TransientError);
      expect(result.code).toBe(ErrorCode.LLM_UNAVAILABLE);
      expect(result.cause).toBe(err);
    },
  );

  it("finds the network code on the cause, which is where fetch puts it", () => {
    const err = new TypeError("fetch failed", { cause: withCode("ECONNREFUSED") });

    expect(classifyError(err).code).toBe(ErrorCode.LLM_UNAVAILABLE);
  });

  it.each(["AbortError", "TimeoutError"])("maps %s to transient LLM_UNAVAILABLE", (name) => {
    const result = classifyError(new DOMException("aborted", name));

    expect(result).toBeInstanceOf(TransientError);
    expect(result.code).toBe(ErrorCode.LLM_UNAVAILABLE);
  });

  it("maps a real AbortSignal.timeout reason", async () => {
    const signal = AbortSignal.timeout(1);
    await new Promise((resolve) => signal.addEventListener("abort", resolve));

    expect(classifyError(signal.reason).code).toBe(ErrorCode.LLM_UNAVAILABLE);
  });

  it("maps anything else to transient INTERNAL and keeps the message", () => {
    const err = new RangeError("something odd");
    const result = classifyError(err);

    expect(result).toBeInstanceOf(TransientError);
    expect(result).toMatchObject({ code: ErrorCode.INTERNAL, message: "something odd" });
    expect(result.cause).toBe(err);
  });

  it("handles non-Error throws", () => {
    expect(classifyError("boom")).toMatchObject({ code: ErrorCode.INTERNAL, message: "boom" });
    expect(classifyError(undefined).code).toBe(ErrorCode.INTERNAL);
  });

  it("survives a cause cycle", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    Object.defineProperty(a, "cause", { value: b });

    expect(classifyError(a).code).toBe(ErrorCode.INTERNAL);
  });
});
