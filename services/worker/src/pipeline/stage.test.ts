import { describe, expect, it } from "vitest";
import { ErrorCode } from "@nexus/shared";
import { getDocument, listEvents, transitionStatus } from "@nexus/shared/node";
import { makeDeps, seedDocument } from "../test-support/fixtures.js";
import { PermanentError } from "./errors.js";
import { runStage } from "./stage.js";

function setup() {
  const { deps, lines } = makeDeps();
  const documentId = seedDocument(deps);
  transitionStatus(deps.db, documentId, "processing", { from: "queued" });
  return { deps, lines, ctx: { deps, documentId, run: 1 } };
}

describe("runStage", () => {
  it("sets the stage, returns the result and writes an ok event with a duration", async () => {
    const { deps, lines, ctx } = setup();

    const result = await runStage(ctx, "parsing", () => {
      expect(getDocument(deps.db, ctx.documentId)?.stage).toBe("parsing");
      return Promise.resolve(42);
    });

    expect(result).toBe(42);
    const [event] = listEvents(deps.db, ctx.documentId);
    expect(event).toMatchObject({ run: 1, stage: "parsing", outcome: "ok" });
    expect(event?.duration_ms).toEqual(expect.any(Number));
    expect(lines.at(-1)).toMatchObject({ documentId: ctx.documentId, stage: "parsing" });
  });

  it("writes an error event with code and message, logs it and rethrows the same error", async () => {
    const { deps, lines, ctx } = setup();
    const err = new PermanentError(ErrorCode.NO_TEXT_LAYER, "no text layer found");

    await expect(runStage(ctx, "parsing", () => Promise.reject(err))).rejects.toBe(err);

    const [event] = listEvents(deps.db, ctx.documentId);
    expect(event).toMatchObject({
      stage: "parsing",
      outcome: "error",
      message: "NO_TEXT_LAYER: no text layer found",
    });
    expect(event?.duration_ms).toEqual(expect.any(Number));
    expect(lines.at(-1)).toMatchObject({
      level: 40,
      documentId: ctx.documentId,
      stage: "parsing",
      code: "NO_TEXT_LAYER",
    });
  });

  it("classifies unknown errors for the event but still rethrows the original", async () => {
    const { deps, ctx } = setup();
    const err = new Error("kaboom");

    await expect(runStage(ctx, "extracting", () => Promise.reject(err))).rejects.toBe(err);

    expect(listEvents(deps.db, ctx.documentId)[0]?.message).toBe("INTERNAL: kaboom");
  });

  it("caps the event message at 500 chars", async () => {
    const { deps, ctx } = setup();

    await expect(
      runStage(ctx, "extracting", () => Promise.reject(new Error("x".repeat(2000)))),
    ).rejects.toThrow();

    expect(listEvents(deps.db, ctx.documentId)[0]?.message).toHaveLength(500);
  });
});
