import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "@nexus/shared/node";
import { PermanentError } from "../pipeline/errors.js";
import { makeDocx } from "../test-support/docx.js";
import { makePdf } from "../test-support/pdf.js";
import { MAX_TEXT_CHARS, parseDocument } from "./index.js";

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const logger = createLogger("worker", "silent");

const BODY = "The supplier shall deliver the services described in Schedule A";

let dir: string;
const path = (name: string) => join(dir, name);

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "nexus-parse-"));
  await writeFile(
    path("contract.pdf"),
    await makePdf([
      [`${BODY} on page one.`, "It renews automa-", "tically every year."],
      [`${BODY} on page two.`],
    ]),
  );
  await writeFile(
    path("contract.docx"),
    await makeDocx(["Master Services Agreement", `${BODY}.`, "Net 30 days."]),
  );
  await writeFile(path("huge.docx"), await makeDocx(["x".repeat(MAX_TEXT_CHARS + 1)]));
  await writeFile(path("limit.docx"), await makeDocx(["x".repeat(MAX_TEXT_CHARS)]));
  await writeFile(path("broken.docx"), "not a zip");
  await writeFile(path("empty.docx"), await makeDocx([]));
  // 49 non-whitespace chars spread over paragraphs with lots of spaces.
  await writeFile(
    path("almost-empty.docx"),
    await makeDocx(["a".repeat(20), "  b b  ".repeat(10), "c".repeat(9)]),
  );
  await writeFile(path("just-enough.docx"), await makeDocx(["d".repeat(50)]));
  await writeFile(path("broken.pdf"), "not a pdf");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function rejection(promise: Promise<unknown>): Promise<PermanentError> {
  const err = await promise.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(PermanentError);
  return err as PermanentError;
}

describe("parseDocument", () => {
  it("parses a pdf into page marked, normalized text", async () => {
    const result = await parseDocument(path("contract.pdf"), PDF, logger);

    expect(result.format).toBe("pdf");
    expect(result.pageCount).toBe(2);
    expect(result.text).toBe(
      `[[page 1]]\n${BODY} on page one.\nIt renews automatically every year.\n\n[[page 2]]\n${BODY} on page two.`,
    );
  });

  it("counts chars without the page markers", async () => {
    const result = await parseDocument(path("contract.pdf"), PDF, logger);

    expect(result.charCount).toBe(result.text.replace(/\[\[page \d+\]\]\n/g, "").length);
    expect(result.charCount).toBeLessThan(result.text.length);
  });

  it("parses a docx into normalized text without page markers or a page count", async () => {
    const result = await parseDocument(path("contract.docx"), DOCX, logger);

    expect(result).toEqual({
      format: "docx",
      text: `Master Services Agreement\n\n${BODY}.\n\nNet 30 days.`,
      pageCount: null,
      charCount: result.text.length,
    });
  });

  it.each(["empty.docx", "almost-empty.docx"])(
    "rejects %s with under 50 non-whitespace chars as EMPTY_DOCUMENT",
    async (name) => {
      const err = await rejection(parseDocument(path(name), DOCX, logger));

      expect(err.code).toBe("EMPTY_DOCUMENT");
    },
  );

  it("accepts a docx with exactly 50 non-whitespace chars", async () => {
    const result = await parseDocument(path("just-enough.docx"), DOCX, logger);

    expect(result.charCount).toBe(50);
  });

  it("rejects an unknown mime as UNSUPPORTED_TYPE", async () => {
    const err = await rejection(parseDocument(path("contract.pdf"), "text/plain", logger));

    expect(err.code).toBe("UNSUPPORTED_TYPE");
  });

  it.each([
    ["broken.docx", DOCX],
    ["broken.pdf", PDF],
  ])("turns a parser crash on %s into PARSE_ERROR with the cause", async (name, mime) => {
    const err = await rejection(parseDocument(path(name), mime, logger));

    expect(err.code).toBe("PARSE_ERROR");
    expect(err.cause).toBeInstanceOf(Error);
  });

  it("rejects text over 400k chars as TEXT_TOO_LONG", async () => {
    const err = await rejection(parseDocument(path("huge.docx"), DOCX, logger));

    expect(err.code).toBe("TEXT_TOO_LONG");
  });

  it("accepts exactly 400k chars", async () => {
    const result = await parseDocument(path("limit.docx"), DOCX, logger);

    expect(result.charCount).toBe(MAX_TEXT_CHARS);
  });
});
