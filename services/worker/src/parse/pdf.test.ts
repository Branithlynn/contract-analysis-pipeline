import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as unpdfModule from "unpdf";
import { PermanentError } from "../pipeline/errors.js";
import { makePdf } from "../test-support/pdf.js";
import { parsePdf } from "./pdf.js";

// Counts loadingTask.destroy() calls so the tests can check the document is closed on every path.
const destroyed = vi.hoisted(() => vi.fn());
vi.mock("unpdf", async (importOriginal) => {
  const mod = await importOriginal<typeof unpdfModule>();
  return {
    ...mod,
    getDocumentProxy: async (...args: Parameters<typeof mod.getDocumentProxy>) => {
      const pdf = await mod.getDocumentProxy(...args);
      const destroy = pdf.loadingTask.destroy.bind(pdf.loadingTask);
      pdf.loadingTask.destroy = () => {
        destroyed();
        return destroy();
      };
      return pdf;
    },
  };
});

const LINE = "This agreement renews automatically each year";

const FIXTURES = {
  twoPages: [
    ["Page 1 line 1 " + LINE, "Page 1 line 2 " + LINE, "Page 1 line 3 " + LINE],
    ["Page 2 line 1 " + LINE, "Page 2 line 2 " + LINE, "Page 2 line 3 " + LINE],
  ],
  blank: [[], []],
  // 2 pages with 30 and 60 non-whitespace chars: average 45, under the threshold.
  sparse: [["a".repeat(30)], ["b".repeat(60)]],
  // 2 pages with 40 and 60 non-whitespace chars plus lots of spaces: average exactly 50.
  justEnough: [["c".repeat(20) + " ".repeat(40) + "c".repeat(20)], ["d".repeat(60)]],
} satisfies Record<string, string[][]>;

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "nexus-pdf-"));
  for (const [name, pages] of Object.entries(FIXTURES)) {
    await writeFile(join(dir, `${name}.pdf`), await makePdf(pages));
  }
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  destroyed.mockClear();
});

function fixture(name: keyof typeof FIXTURES): Promise<Buffer> {
  return readFile(join(dir, `${name}.pdf`));
}

describe("parsePdf", () => {
  // Clause detection later depends on these line breaks. This fails if a future unpdf drops them.
  it("returns one string per page with the line breaks kept", async () => {
    const result = await parsePdf(await fixture("twoPages"));

    expect(result.totalPages).toBe(2);
    expect(result.pages).toEqual(FIXTURES.twoPages.map((lines) => lines.join("\n")));
    expect(destroyed).toHaveBeenCalledOnce();
  });

  it("rejects a pdf without text as permanent NO_TEXT_LAYER and still closes it", async () => {
    const err = await parsePdf(await fixture("blank")).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PermanentError);
    expect(err).toMatchObject({
      code: "NO_TEXT_LAYER",
      message: "PDF has no extractable text (likely scanned). OCR is not supported.",
    });
    expect(destroyed).toHaveBeenCalledOnce();
  });

  it("rejects when the average per page is under 50 non-whitespace chars", async () => {
    await expect(parsePdf(await fixture("sparse"))).rejects.toMatchObject({
      code: "NO_TEXT_LAYER",
    });
  });

  it("accepts an average of exactly 50 and ignores whitespace in the count", async () => {
    const result = await parsePdf(await fixture("justEnough"));

    expect(result.totalPages).toBe(2);
  });

  it("rejects bytes that are not a pdf as permanent PARSE_ERROR", async () => {
    const err = await parsePdf(Buffer.from("definitely not a pdf")).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PermanentError);
    expect(err).toMatchObject({ code: "PARSE_ERROR" });
    expect((err as PermanentError).cause).toBeInstanceOf(Error);
  });

  it("does not detach the caller's buffer", async () => {
    const buffer = await fixture("twoPages");
    await parsePdf(buffer);

    expect(buffer.byteLength).toBeGreaterThan(0);
  });
});
