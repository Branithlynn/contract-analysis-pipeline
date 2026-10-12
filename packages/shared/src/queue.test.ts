import { describe, expect, it } from "vitest";
import { LlmProviderName } from "./providers.js";
import { ExtractJobPayload, QUEUE_NAMES, jobIdFor, queueKindFor } from "./queue.js";

const id = "3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b";

describe("jobIdFor", () => {
  it("joins id and run with _ and never contains a colon", () => {
    expect(jobIdFor(id, 2)).toBe(`${id}_2`);
    expect(jobIdFor(id, 2)).not.toContain(":");
  });
});

describe("ExtractJobPayload", () => {
  it("accepts a uuid and a positive run", () => {
    expect(ExtractJobPayload.safeParse({ documentId: id, run: 1 }).success).toBe(true);
  });

  it("rejects a non uuid id and a run below 1", () => {
    expect(ExtractJobPayload.safeParse({ documentId: "doc-1", run: 1 }).success).toBe(false);
    expect(ExtractJobPayload.safeParse({ documentId: id, run: 0 }).success).toBe(false);
  });

  it("carries the model a job is to run with", () => {
    const parsed = ExtractJobPayload.parse({
      documentId: id,
      run: 2,
      provider: "openai",
      model: "gpt-5-mini",
    });

    expect(parsed).toEqual({ documentId: id, run: 2, provider: "openai", model: "gpt-5-mini" });
  });

  it("still reads a job from before models could be chosen", () => {
    expect(ExtractJobPayload.parse({ documentId: id, run: 1 })).toEqual({ documentId: id, run: 1 });
  });

  it("rejects a provider it does not know and an empty model", () => {
    const base = { documentId: id, run: 1 };
    expect(ExtractJobPayload.safeParse({ ...base, provider: "gemini", model: "x" }).success).toBe(
      false,
    );
    expect(ExtractJobPayload.safeParse({ ...base, provider: "mock", model: "" }).success).toBe(
      false,
    );
  });
});

describe("queueKindFor", () => {
  it("sends ollama to the local queue and every other provider to the hosted one", () => {
    expect(queueKindFor("ollama")).toBe("local");
    for (const provider of LlmProviderName.options.filter((name) => name !== "ollama")) {
      expect(queueKindFor(provider)).toBe("hosted");
    }
  });

  it("uses two different queue names, neither of them the old single queue", () => {
    expect(QUEUE_NAMES.local).not.toBe(QUEUE_NAMES.hosted);
    expect(Object.values(QUEUE_NAMES)).not.toContain("document-extraction");
  });
});
