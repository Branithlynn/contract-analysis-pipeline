import { extractText, getDocumentProxy } from "unpdf";
import { ErrorCode } from "@nexus/shared";
import { PermanentError } from "../pipeline/errors.js";

export interface ParsedPdf {
  totalPages: number;
  // One entry per page, line breaks kept: clause detection needs them.
  pages: string[];
}

// Below this a pdf is almost certainly scanned images. Sending near-empty text to the model gets
// back nulls that look like a legit "not in the contract", so failing is the honest answer.
const MIN_AVG_CHARS_PER_PAGE = 50;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Broken or encrypted pdfs fail the same way on every attempt, so parse failures are permanent.
async function open(data: Uint8Array) {
  try {
    // pdf.js may transfer the buffer it gets to its worker, so it gets a copy instead of the caller's.
    return await getDocumentProxy(new Uint8Array(data));
  } catch (err) {
    throw new PermanentError(ErrorCode.PARSE_ERROR, `Could not open PDF: ${message(err)}`, {
      cause: err,
    });
  }
}

export async function parsePdf(data: Uint8Array): Promise<ParsedPdf> {
  const pdf = await open(data);
  let totalPages: number;
  let pages: string[];
  try {
    ({ totalPages, text: pages } = await extractText(pdf, { mergePages: false }));
  } catch (err) {
    throw new PermanentError(ErrorCode.PARSE_ERROR, `Could not read PDF text: ${message(err)}`, {
      cause: err,
    });
  } finally {
    // The proxy returned by unpdf 1.8 has no destroy(); the loading task owns the document.
    await pdf.loadingTask.destroy();
  }

  const chars = pages.reduce((sum, page) => sum + page.replace(/\s/g, "").length, 0);
  if (totalPages === 0 || chars / totalPages < MIN_AVG_CHARS_PER_PAGE) {
    throw new PermanentError(
      ErrorCode.NO_TEXT_LAYER,
      "PDF has no extractable text (likely scanned). OCR is not supported.",
    );
  }
  return { totalPages, pages };
}
