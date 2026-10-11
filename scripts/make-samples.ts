// Generates the contracts in samples/generated from samples/source. Their content is written by hand
// in TS, so the right answer for every field is known and model output can be scored against it.
// All vendors are made up. Run with `npm run samples`.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HeadingLevel, Paragraph } from "docx";
import { consultingSow } from "../samples/source/consulting-sow.js";
import { hardwareSupply } from "../samples/source/hardware-supply.js";
import { masterServicesAgreement } from "../samples/source/master-services-agreement.js";
import { mutualNda } from "../samples/source/mutual-nda.js";
import { saasSubscription } from "../samples/source/saas-subscription.js";
import { scannedQuote } from "../samples/source/scanned-quote.js";
import type { SampleDoc } from "../samples/source/types.js";
import { drawScannedPage, packDocx, renderPdf, writeInMargin } from "./lib/render.js";

const OUT_DIR = fileURLToPath(new URL("../samples/generated/", import.meta.url));
const SAMPLES: SampleDoc[] = [
  saasSubscription,
  consultingSow,
  hardwareSupply,
  mutualNda,
  masterServicesAgreement,
  scannedQuote,
];

const BODY_SIZE = 10.5;
const TITLE_SIZE = 14;

// A heading is not left alone at the foot of a page: it moves to the next one unless its first
// lines of text fit under it.
const KEEP_WITH_HEADING_LINES = 4;

interface Rendered {
  data: Buffer;
  pages: number;
}

function explicitPages(sample: SampleDoc): number {
  return 1 + sample.sections.filter((section) => section.pageBreakBefore).length;
}

async function pdf(sample: SampleDoc): Promise<Rendered> {
  let pages = 0;
  const data = await renderPdf(
    { title: sample.title, author: "make-samples" },
    (doc) => {
      doc.on("pageAdded", () => pages++);
      if (sample.scanned) {
        for (let page = 0; page < explicitPages(sample); page++) drawScannedPage(doc);
        return;
      }

      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(TITLE_SIZE).text(sample.title, { paragraphGap: 10 });
      doc.fontSize(BODY_SIZE);
      for (const section of sample.sections) {
        const room = doc.page.maxY() - doc.y;
        if (section.pageBreakBefore || room < KEEP_WITH_HEADING_LINES * doc.currentLineHeight()) {
          doc.addPage();
        }
        doc.font("Helvetica-Bold").text(section.heading, { paragraphGap: 4 });
        doc.font("Helvetica");
        // Long text runs on to the next page by itself, as it does in a real contract.
        for (const paragraph of section.paragraphs) doc.text(paragraph, { paragraphGap: 6 });
        doc.moveDown(0.5);
      }

      // The same footer on every page, so the parser's footer stripping has something to remove.
      // Written last because only now is it known how many pages there are.
      doc.font("Helvetica");
      for (let page = 0; page < pages; page++) {
        doc.switchToPage(page);
        writeInMargin(doc, `Confidential | Page ${page + 1}`, doc.page.height - 40);
      }
    },
    true,
  );
  return { data, pages };
}

async function docx(sample: SampleDoc): Promise<Rendered> {
  const data = await packDocx([
    new Paragraph({ text: sample.title, heading: HeadingLevel.TITLE }),
    ...sample.sections.flatMap((section) => [
      new Paragraph({
        text: section.heading,
        heading: HeadingLevel.HEADING_2,
        pageBreakBefore: section.pageBreakBefore === true,
      }),
      ...section.paragraphs.map((text) => new Paragraph(text)),
    ]),
  ]);
  // Word decides where a docx page ends, so this is only the count the source asks for.
  return { data, pages: explicitPages(sample) };
}

const RENDERERS = { pdf, docx };

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  for (const sample of SAMPLES) {
    for (const format of sample.formats) {
      const path = join(OUT_DIR, `${sample.name}.${format}`);
      const { data, pages } = await RENDERERS[format](sample);
      await writeFile(path, data);
      console.log(`wrote ${path} (${pages} pages)`);
    }
  }
}

await main();
