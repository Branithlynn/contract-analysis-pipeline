export type DocumentFormat = "pdf" | "docx";

// Keyed by the mime sniffed from the file bytes. The api uses it to accept uploads and name the
// stored file, the worker to pick a parser, so the two can't drift apart.
export const MIME_FORMATS: ReadonlyMap<string, DocumentFormat> = new Map([
  ["application/pdf", "pdf"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
]);
