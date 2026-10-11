export type SampleFormat = "pdf" | "docx";

export interface SampleSection {
  heading: string;
  paragraphs: string[];
  pageBreakBefore?: boolean;
}

export interface SampleDoc {
  // File name without the extension.
  name: string;
  title: string;
  formats: SampleFormat[];
  // Rendered as shapes with no text layer, like a scan. Only the page breaks of the sections count.
  scanned?: boolean;
  sections: SampleSection[];
}
