import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Stage } from "@nexus/shared";
import { makeDeps } from "../test-support/fixtures.js";
import { makePdf } from "../test-support/pdf.js";
import { analyzeDocument, type StageRunner } from "./analyze.js";
import { PermanentError } from "./errors.js";

const PDF = "application/pdf";
const LINE = "The supplier shall provide the services described in this agreement";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "nexus-analyze-"));
  await writeFile(join(dir, "two-pages.pdf"), await makePdf([[LINE], [LINE]]));
  await writeFile(join(dir, "blank.pdf"), await makePdf([[], []]));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function setup() {
  return makeDeps({ UPLOAD_DIR: dir }).deps;
}

const input = (path: string) => ({ path, mime: PDF, filename: "contract.pdf" });

describe("analyzeDocument", () => {
  it("resolves the relative path against UPLOAD_DIR and parses the file", async () => {
    const result = await analyzeDocument(input("two-pages.pdf"), setup());

    expect(result.parsed).toMatchObject({ format: "pdf", pageCount: 2 });
    expect(result.parsed.text).toBe(`[[page 1]]\n${LINE}\n\n[[page 2]]\n${LINE}`);
    expect(result.extraction).toBeNull();
    // Nothing has been extracted yet, so nothing can be trusted without a look.
    expect(result.needsReview).toBe(true);
  });

  it("runs parsing through onStage", async () => {
    const stages: Stage[] = [];
    const onStage: StageRunner = (stage, fn) => {
      stages.push(stage);
      return fn();
    };

    await analyzeDocument(input("two-pages.pdf"), setup(), { onStage });

    expect(stages).toEqual(["parsing"]);
  });

  it("lets parse errors through unchanged", async () => {
    const err = await analyzeDocument(input("blank.pdf"), setup()).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PermanentError);
    expect(err).toMatchObject({ code: "NO_TEXT_LAYER" });
  });
});
