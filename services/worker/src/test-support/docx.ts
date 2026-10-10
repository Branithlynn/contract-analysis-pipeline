import { Document, Packer, Paragraph } from "docx";

// One paragraph per string.
export function makeDocx(paragraphs: string[]): Promise<Buffer> {
  const doc = new Document({
    sections: [{ children: paragraphs.map((text) => new Paragraph(text)) }],
  });
  return Packer.toBuffer(doc);
}
