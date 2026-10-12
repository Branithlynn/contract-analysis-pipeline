// Which page of a document a quote from a retrieval chunk is on. A chunk can run over a page
// break, so its own page range is not exact enough for a citation or for opening the pdf at the
// right place. Browser safe: the chat uses it too.

// A later page starting inside a chunk: the character offset in the chunk text where it begins.
export interface PageBreak {
  page: number;
  offset: number;
}

export interface ChunkPages {
  text: string;
  // Null for docx, which has no fixed pages.
  page_start: number | null;
  page_end: number | null;
  // Empty when the whole chunk is on page_start.
  page_breaks: readonly PageBreak[];
}

export interface QuotePages {
  // The page the quote starts on, which is where a viewer should open.
  page_start: number;
  // Different from page_start only for a quote that runs over a page break.
  page_end: number;
}

// The text with every run of whitespace as one space, and for each of its characters the offset
// it came from. A quote copied out of a chunk rarely keeps the pdf's line breaks.
function flatten(text: string): { flat: string; offsets: number[] } {
  let flat = "";
  const offsets: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    if (/\s/.test(char)) {
      pendingSpace = flat !== "";
      continue;
    }
    if (pendingSpace) {
      flat += " ";
      offsets.push(i - 1);
      pendingSpace = false;
    }
    flat += char;
    offsets.push(i);
  }
  return { flat, offsets };
}

function pageAt(chunk: ChunkPages, pageStart: number, offset: number): number {
  let page = pageStart;
  for (const br of chunk.page_breaks) {
    if (br.offset > offset) break;
    page = br.page;
  }
  return page;
}

// Null when the chunk has no pages (docx) or the quote is not in the chunk. Whitespace is compared
// loosely, everything else exactly.
export function pagesOfQuote(chunk: ChunkPages, quote: string): QuotePages | null {
  if (chunk.page_start === null) return null;
  const needle = flatten(quote).flat;
  if (needle === "") return null;
  const { flat, offsets } = flatten(chunk.text);
  const at = flat.indexOf(needle);
  if (at < 0) return null;
  const first = offsets[at];
  const last = offsets[at + needle.length - 1];
  if (first === undefined || last === undefined) return null;
  return {
    page_start: pageAt(chunk, chunk.page_start, first),
    page_end: pageAt(chunk, chunk.page_start, last),
  };
}
