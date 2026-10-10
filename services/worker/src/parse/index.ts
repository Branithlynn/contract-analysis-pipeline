import { readFile } from "node:fs/promises";
import { ErrorCode, MIME_FORMATS, type DocumentFormat } from "@nexus/shared";
import type { Logger } from "@nexus/shared/node";
import { PermanentError } from "../pipeline/errors.js";
import { parseDocx } from "./docx.js";
import { normalizePages, normalizeText, stripPageMarkers } from "./normalize.js";
import { parsePdf } from "./pdf.js";

export interface ParsedDocument {
  format: DocumentFormat;
  // pdf text carries [[page N]] markers, docx text has none since docx has no fixed pages.
  text: string;
  pageCount: number | null;
  // Without the page markers, so it reflects the document and not our formatting.
  charCount: number;
}

// Roughly 100k tokens. Past this a contract is more likely a mis-upload than something worth the cost.
export const MAX_TEXT_CHARS = 400_000;

// Same bar as the pdf text layer check. Below it there is nothing worth sending to the model.
const MIN_DOCX_CHARS = 50;

async function extract(
  format: DocumentFormat,
  path: string,
  logger: Logger,
): Promise<{ text: string; pageCount: number | null }> {
  if (format === "pdf") {
    const { totalPages, pages } = await parsePdf(await readFile(path));
    return { text: normalizePages(pages), pageCount: totalPages };
  }
  return { text: normalizeText(await parseDocx(path, logger)), pageCount: null };
}

export async function parseDocument(
  path: string,
  mime: string,
  logger: Logger,
): Promise<ParsedDocument> {
  const format = MIME_FORMATS.get(mime);
  if (format === undefined) {
    throw new PermanentError(ErrorCode.UNSUPPORTED_TYPE, `Unsupported file type: ${mime}`);
  }

  let extracted: { text: string; pageCount: number | null };
  try {
    extracted = await extract(format, path, logger);
  } catch (err) {
    // parsePdf already classifies (NO_TEXT_LAYER, PARSE_ERROR); anything else is a parser crash.
    if (err instanceof PermanentError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new PermanentError(ErrorCode.PARSE_ERROR, `Could not parse ${format}: ${message}`, {
      cause: err,
    });
  }

  if (format === "docx" && extracted.text.replace(/\s/g, "").length < MIN_DOCX_CHARS) {
    throw new PermanentError(ErrorCode.EMPTY_DOCUMENT, "DOCX has no text to analyze.");
  }

  const charCount = stripPageMarkers(extracted.text).length;
  if (charCount > MAX_TEXT_CHARS) {
    throw new PermanentError(
      ErrorCode.TEXT_TOO_LONG,
      `Document has ${charCount} characters, the limit is ${MAX_TEXT_CHARS}`,
    );
  }
  return { format, ...extracted, charCount };
}
