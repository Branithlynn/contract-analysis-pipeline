// pdfkit and docx plumbing shared by make-test-files.ts and make-samples.ts.
import { Document, Packer, type Paragraph } from "docx";
import PDFDocument from "pdfkit";

// pdfkit derives the file id from the info dict, so a fixed date makes the output byte for byte stable.
const FIXED_DATE = new Date("2026-01-01T00:00:00Z");

export interface PdfInfo {
  title: string;
  author: string;
}

// bufferPages keeps finished pages open, for a draw that goes back to them (footers on pages that
// pdfkit added by itself).
export function renderPdf(
  info: PdfInfo,
  draw: (doc: PDFKit.PDFDocument) => void,
  bufferPages = false,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      autoFirstPage: false,
      size: "A4",
      bufferPages,
      info: { CreationDate: FIXED_DATE, Title: info.title, Author: info.author },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    draw(doc);
    doc.end();
  });
}

// Header and footer sit in the margins. pdfkit starts a new page for text below the bottom margin,
// so the margin is lifted while the footer is written.
export function writeInMargin(doc: PDFKit.PDFDocument, text: string, y: number): void {
  const bottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.fontSize(9).text(text, doc.page.margins.left, y, {
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
    align: "center",
    lineBreak: false,
  });
  doc.page.margins.bottom = bottom;
}

// Packer stamps the current time into the docx, so unlike the pdfs these differ on every run.
export function packDocx(children: Paragraph[]): Promise<Buffer> {
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

// Grey blocks and rules roughly where a scanned page has its text, but no text objects at all.
export function drawScannedPage(doc: PDFKit.PDFDocument): void {
  doc.addPage();
  doc.rect(60, 60, doc.page.width - 120, doc.page.height - 120).stroke("#999999");
  doc.rect(80, 90, 220, 18).fill("#cccccc");
  for (let row = 0; row < 28; row++) {
    const y = 140 + row * 22;
    const width = row % 5 === 4 ? 260 : 420;
    doc
      .moveTo(80, y)
      .lineTo(80 + width, y)
      .lineWidth(6)
      .stroke("#bbbbbb");
  }
}
