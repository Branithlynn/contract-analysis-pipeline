import type { SampleDoc } from "./types.js";

// Stands in for a quote that was scanned to images. The renderer draws shapes instead of the
// sections, so the sections only say how many pages there are.
export const scannedQuote: SampleDoc = {
  name: "scanned-quote",
  title: "Quotation",
  formats: ["pdf"],
  scanned: true,
  sections: [
    { heading: "Quotation", paragraphs: [] },
    { heading: "Price List", paragraphs: [], pageBreakBefore: true },
    { heading: "Terms of Sale", paragraphs: [], pageBreakBefore: true },
  ],
};
