import { describe, expect, it } from "vitest";
import { ExtractJobPayload, jobIdFor } from "./queue.js";

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
});
