import { describe, expect, it } from "vitest";
import { ACCEPT_ATTRIBUTE, checkFiles, UPLOAD_LIMITS } from "./uploadLimits.js";

const MB = 1024 * 1024;

function file(name: string, size = 1000) {
  return { name, size };
}

describe("checkFiles", () => {
  it("accepts pdf and docx whatever the case of the extension", () => {
    const files = [file("msa.pdf"), file("SOW.DOCX"), file("order.Pdf")];
    expect(checkFiles(files)).toEqual({ accepted: files, rejected: [] });
  });

  it("rejects other extensions and names without one", () => {
    const { accepted, rejected } = checkFiles([file("notes.txt"), file("pdf"), file("a.pdf.exe")]);
    expect(accepted).toEqual([]);
    expect(rejected.map((r) => r.name)).toEqual(["notes.txt", "pdf", "a.pdf.exe"]);
    expect(rejected[0]?.message).toBe("Only .pdf and .docx files are accepted");
  });

  it("accepts a file of exactly 20 MB and rejects one byte more", () => {
    const { accepted, rejected } = checkFiles([
      file("edge.pdf", 20 * MB),
      file("big.pdf", 20 * MB + 1),
    ]);
    expect(accepted.map((f) => f.name)).toEqual(["edge.pdf"]);
    expect(rejected).toEqual([{ name: "big.pdf", message: "Larger than 20 MB" }]);
  });

  it("keeps the first 10 valid files and rejects the rest", () => {
    const files = Array.from({ length: 12 }, (_, i) => file(`c${i}.pdf`));
    const { accepted, rejected } = checkFiles(files);
    expect(accepted).toEqual(files.slice(0, 10));
    expect(rejected).toEqual([
      { name: "c10.pdf", message: "Only 10 files per upload" },
      { name: "c11.pdf", message: "Only 10 files per upload" },
    ]);
  });

  it("does not count invalid files towards the 10", () => {
    const valid = Array.from({ length: 10 }, (_, i) => file(`c${i}.pdf`));
    const { accepted, rejected } = checkFiles([file("notes.txt"), ...valid]);
    expect(accepted).toEqual(valid);
    expect(rejected.map((r) => r.name)).toEqual(["notes.txt"]);
  });
});

describe("limits", () => {
  it("match what the api defaults to", () => {
    expect(UPLOAD_LIMITS).toEqual({ maxFileMb: 20, maxFiles: 10, extensions: ["pdf", "docx"] });
    expect(ACCEPT_ATTRIBUTE).toBe(".pdf,.docx");
  });
});
