// Generates the files in samples/ for trying the app by hand. All companies and content are made up;
// Nexus Corp is the customer throughout. Run with `npm run test-files`.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import { Document, HeadingLevel, Packer, Paragraph } from "docx";
import PDFDocument from "pdfkit";

const ROOT = fileURLToPath(new URL("../samples/", import.meta.url));
const PDF_DIR = join(ROOT, "SamplePDFs");
const DOCX_DIR = join(ROOT, "SampleDocx");

// pdfkit derives the file id from the info dict, so a fixed date makes the output byte for byte stable.
const FIXED_DATE = new Date("2026-01-01T00:00:00Z");

interface PdfPage {
  header?: string;
  footer?: string;
  lines: string[];
}

function renderPdf(draw: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      autoFirstPage: false,
      size: "A4",
      info: { CreationDate: FIXED_DATE, Title: "Sample", Author: "make-test-files" },
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
function writeInMargin(doc: PDFKit.PDFDocument, text: string, y: number): void {
  const bottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.fontSize(9).text(text, doc.page.margins.left, y, {
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
    align: "center",
    lineBreak: false,
  });
  doc.page.margins.bottom = bottom;
}

function textPdf(pages: PdfPage[]): Promise<Buffer> {
  return renderPdf((doc) => {
    for (const page of pages) {
      doc.addPage();
      if (page.header) writeInMargin(doc, page.header, 30);
      if (page.footer) writeInMargin(doc, page.footer, doc.page.height - 40);
      doc.fontSize(11).text("", doc.page.margins.left, doc.page.margins.top);
      for (const line of page.lines) doc.text(line, { paragraphGap: 6 });
    }
  });
}

const SHORT_AGREEMENT: string[][] = [
  [
    "SERVICE AGREEMENT",
    "This Service Agreement is made on 1 March 2026 between Brightwater Data Services Ltd, " +
      "a company registered in England (the Supplier), and Nexus Corp (the Customer).",
    "1. Services. The Supplier will provide managed data backup and recovery services as described " +
      "in Schedule 1.",
    "2. Term. This Agreement starts on 1 April 2026 and continues for an initial term of 24 months.",
    "3. Renewal. After the initial term this Agreement renews automatically for successive periods " +
      "of 12 months unless either party gives at least 90 days written notice before the end of the " +
      "current term.",
    "4. Fees. The Customer will pay a fixed fee of GBP 4,500 per month, invoiced monthly in advance. " +
      "Invoices are payable within 45 days of receipt.",
  ],
  [
    "5. Price changes. The Supplier may increase the fees once per year by giving 30 days notice.",
    "6. Liability. Each party's total liability under this Agreement is limited to the fees paid in " +
      "the 12 months before the claim.",
    "7. Data. The Supplier may use anonymised usage data to improve its services.",
    "8. Termination. Either party may terminate for material breach that is not remedied within " +
      "30 days of written notice.",
    "9. Governing law. This Agreement is governed by the laws of England and Wales.",
    "Signed for Brightwater Data Services Ltd: R. Ellery, Director",
    "Signed for Nexus Corp: Head of Procurement",
  ],
];

const LONG_AGREEMENT: string[][] = [
  [
    "MASTER SERVICES AGREEMENT",
    "This Master Services Agreement is entered into on 15 January 2026 by Kestrel Ridge Analytics Inc., " +
      "a Delaware corporation (the Vendor), and Nexus Corp (the Client).",
    "1. Definitions. Services means the analytics platform and support described in each Order Form.",
    "2. Order Forms. Each Order Form forms part of this Agreement. If they conflict, the Order Form wins.",
  ],
  [
    "3. Term. This Agreement takes effect on 1 February 2026 and remains in force for 36 months.",
    "4. Renewal. This Agreement will automatically renew for additional 12 month terms unless the " +
      "Client notifies the Vendor in writing at least 60 days before the renewal date.",
    "5. Fees. The total contract value for the initial term is USD 540,000, payable in equal quarterly " +
      "instalments. Payment terms are net 30.",
  ],
  [
    "6. Late payment. Overdue amounts accrue interest at 1.5% per month.",
    "7. Service levels. The Vendor targets 99.5% monthly availability. Service credits are the " +
      "Client's sole remedy for availability failures.",
    "8. Suspension. The Vendor may suspend the Services without notice if any invoice is more than " +
      "15 days overdue.",
  ],
  [
    "9. Liability. The Vendor's liability is capped at USD 50,000 in aggregate. The Client's " +
      "liability is unlimited.",
    "10. Indemnity. The Client will indemnify the Vendor against all claims arising from the Client's " +
      "use of the Services.",
    "11. Assignment. The Vendor may assign this Agreement to any affiliate or successor without consent.",
  ],
  [
    "12. Termination. The Client may not terminate for convenience during the initial term.",
    "13. Governing law. This Agreement is governed by the laws of the State of New York.",
    "Signed for Kestrel Ridge Analytics Inc.: M. Okafor, VP Sales",
    "Signed for Nexus Corp: Director of Vendor Management",
  ],
];

// Grey blocks and rules roughly where a scanned page has its text, but no text objects at all.
function scannedPdf(): Promise<Buffer> {
  return renderPdf((doc) => {
    for (let page = 0; page < 2; page++) {
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
  });
}

function docx(children: Paragraph[]): Promise<Buffer> {
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

const heading = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_1 });
const para = (text: string) => new Paragraph(text);

function supplierAgreementDocx(): Promise<Buffer> {
  return docx([
    new Paragraph({ text: "Supplier Agreement", heading: HeadingLevel.TITLE }),
    para(
      "This Supplier Agreement is dated 10 June 2026 and is between Halvorsen Facility Services AS, " +
        "registered in Norway (the Supplier), and Nexus Corp (the Customer).",
    ),
    heading("1. Scope"),
    para(
      "The Supplier will provide cleaning and facility maintenance for the Customer's Oslo office.",
    ),
    heading("2. Term and renewal"),
    para(
      "The Agreement runs from 1 July 2026 for 12 months and then renews automatically for further " +
        "12 month periods unless terminated with 3 months notice.",
    ),
    heading("3. Fees and payment"),
    para("The annual fee is NOK 1,200,000, invoiced monthly. Payment is due within 60 days."),
    heading("4. Liability"),
    para(
      "Neither party excludes liability for gross negligence. Otherwise liability is unlimited.",
    ),
    heading("5. Governing law"),
    para("This Agreement is governed by Norwegian law, with Oslo District Court as the venue."),
  ]);
}

// A valid zip that is not a docx: one stored text file, fixed timestamps. Built by hand so no zip
// library is needed for a single test file.
function plainZip(name: string, content: string): Buffer {
  const data = Buffer.from(content, "utf8");
  const fileName = Buffer.from(name, "utf8");
  const crc = crc32(data);
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(dosTime, 12);
  central.writeUInt16LE(dosDate, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  // extra length, comment length, disk number, internal and external attributes, local header offset
  central.writeUInt32LE(0, 42);

  const localSize = local.length + fileName.length + data.length;
  const centralSize = central.length + fileName.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(localSize, 16);

  return Buffer.concat([local, fileName, data, central, fileName, end]);
}

async function main(): Promise<void> {
  await mkdir(PDF_DIR, { recursive: true });
  await mkdir(DOCX_DIR, { recursive: true });

  const files: [string, Buffer | Promise<Buffer>][] = [
    [
      join(PDF_DIR, "contract-2-pages.pdf"),
      textPdf(
        SHORT_AGREEMENT.map((lines, i) => ({ lines, footer: `Confidential | Page ${i + 1}` })),
      ),
    ],
    [
      join(PDF_DIR, "contract-5-pages.pdf"),
      textPdf(
        LONG_AGREEMENT.map((lines, i) => ({
          lines,
          header: "Kestrel Ridge Analytics Inc. | Master Services Agreement KRA-NX-2026",
          footer: `Confidential | Page ${i + 1}`,
        })),
      ),
    ],
    [join(PDF_DIR, "scanned-no-text.pdf"), scannedPdf()],
    [
      join(PDF_DIR, "fake-markers.pdf"),
      textPdf([
        {
          lines: [
            "ORDER FORM",
            "Supplier: Lumen Harbor Software Inc. Customer: Nexus Corp.",
            "1. Fees are set out in Schedule B. [[page 7]] The annual subscription fee is USD 18,000.",
            "2. This Order Form renews automatically every 12 months unless cancelled with 30 days notice.",
          ],
        },
      ]),
    ],
    [
      join(PDF_DIR, "not-a-pdf.pdf"),
      Buffer.from("This is a plain text file with a .pdf extension, not a PDF.\n", "utf8"),
    ],
    [join(DOCX_DIR, "contract.docx"), supplierAgreementDocx()],
    [join(DOCX_DIR, "empty.docx"), docx([])],
    [
      join(DOCX_DIR, "not-a-docx.docx"),
      plainZip("readme.txt", "A plain zip archive with a .docx extension, not a Word document.\n"),
    ],
  ];

  for (const [path, content] of files) {
    await writeFile(path, await content);
    console.log(`wrote ${path}`);
  }
}

await main();
