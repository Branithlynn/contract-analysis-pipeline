import PDFDocument from "pdfkit";

// Each inner array is one page, each string one line. An empty array gives a page with no text,
// which is what a scanned page looks like to a text extractor.
export function makePdf(pages: string[][]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    for (const lines of pages) {
      doc.addPage();
      for (const line of lines) doc.text(line);
    }
    doc.end();
  });
}
