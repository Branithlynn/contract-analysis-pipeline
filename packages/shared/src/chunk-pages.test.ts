import { describe, expect, it } from "vitest";
import { pagesOfQuote, type ChunkPages } from "./chunk-pages.js";

// A chunk that starts near the bottom of page 4, covers all of page 5 and ends on page 6.
const P4 = "9.3 Vendor shall keep the records for six years.";
const P5 =
  "10. Liability\n10.1 The liability of each party is limited to the fees\npaid in the preceding 12 months.";
const P6 = "10.2 Nothing in this agreement limits liability for fraud.";
const text = `${P4}\n\n${P5}\n\n${P6}`;
const chunk: ChunkPages = {
  text,
  page_start: 4,
  page_end: 6,
  page_breaks: [
    { page: 5, offset: text.indexOf("10. Liability") },
    { page: 6, offset: text.indexOf("10.2 Nothing") },
  ],
};

describe("pagesOfQuote", () => {
  it("gives the first page for a quote before any break", () => {
    expect(pagesOfQuote(chunk, "keep the records for six years")).toEqual({
      page_start: 4,
      page_end: 4,
    });
  });

  it("gives a later page for a quote after a break", () => {
    expect(pagesOfQuote(chunk, "limited to the fees")).toEqual({ page_start: 5, page_end: 5 });
    expect(pagesOfQuote(chunk, "limits liability for fraud")).toEqual({
      page_start: 6,
      page_end: 6,
    });
  });

  it("gives both pages for a quote that runs across a page break", () => {
    // Ends page 4, starts page 5.
    expect(pagesOfQuote(chunk, "for six years. 10. Liability")).toEqual({
      page_start: 4,
      page_end: 5,
    });
    // From page 4 to page 6, over two breaks.
    expect(pagesOfQuote(chunk, `six years. ${P5} 10.2 Nothing`)).toEqual({
      page_start: 4,
      page_end: 6,
    });
  });

  it("puts a quote that starts exactly at a break on the new page", () => {
    expect(pagesOfQuote(chunk, "10. Liability")).toEqual({ page_start: 5, page_end: 5 });
    expect(pagesOfQuote(chunk, "years.")).toEqual({ page_start: 4, page_end: 4 });
  });

  it("finds a quote whose line breaks differ from the chunk's", () => {
    // In the chunk there is a line break between "fees" and "paid".
    expect(pagesOfQuote(chunk, "limited to the fees paid in the   preceding\n12 months")).toEqual({
      page_start: 5,
      page_end: 5,
    });
  });

  it("uses the first occurrence when the quote appears twice", () => {
    expect(pagesOfQuote(chunk, "liability")).toEqual({ page_start: 5, page_end: 5 });
  });

  it("works for a chunk on one page", () => {
    const single: ChunkPages = { text: P5, page_start: 12, page_end: 12, page_breaks: [] };
    expect(pagesOfQuote(single, "paid in the preceding 12 months")).toEqual({
      page_start: 12,
      page_end: 12,
    });
  });

  it("is null for a quote that is not in the chunk, and for an empty one", () => {
    expect(pagesOfQuote(chunk, "limited to the Fees")).toBeNull();
    expect(pagesOfQuote(chunk, "something else entirely")).toBeNull();
    expect(pagesOfQuote(chunk, "   ")).toBeNull();
  });

  it("is null for docx chunks, which have no pages", () => {
    const docx: ChunkPages = { text: P5, page_start: null, page_end: null, page_breaks: [] };
    expect(pagesOfQuote(docx, "limited to the fees")).toBeNull();
  });
});
