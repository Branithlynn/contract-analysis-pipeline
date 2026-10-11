import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CASE_SUFFIX, caseNames, findCaseFiles } from "./cases.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

function names(pattern: string): string[] {
  return findCaseFiles(pattern, ROOT).map((file) => basename(file, CASE_SUFFIX));
}

describe("findCaseFiles", () => {
  it("takes a path glob from the repo root", () => {
    expect(names("evals/cases/*.expected.json")).toEqual(caseNames(ROOT));
    expect(names("evals/cases/saas*.expected.json")).toEqual([
      "saas-subscription-docx",
      "saas-subscription-pdf",
    ]);
  });

  it("takes a case name", () => {
    expect(names("mutual-nda")).toEqual(["mutual-nda"]);
  });

  it("takes a glob over the case names", () => {
    expect(names("mutual-nda*")).toEqual(["mutual-nda"]);
    expect(names("saas*")).toEqual(["saas-subscription-docx", "saas-subscription-pdf"]);
    expect(names("*")).toEqual(caseNames(ROOT));
  });

  it("returns paths relative to the root", () => {
    expect(findCaseFiles("mutual-nda", ROOT).map((file) => file.replaceAll("\\", "/"))).toEqual([
      "evals/cases/mutual-nda.expected.json",
    ]);
  });

  it("finds nothing for a name that is not a case, or a path that is not there", () => {
    expect(names("mutual")).toEqual([]);
    expect(names("no-such-case*")).toEqual([]);
    expect(names("evals/nowhere/mutual-nda")).toEqual([]);
    // A file that exists but is not a case file.
    expect(names("package.json")).toEqual([]);
  });
});

describe("caseNames", () => {
  it("lists every case by name, sorted", () => {
    expect(caseNames(ROOT)).toEqual([
      "consulting-sow",
      "hardware-supply",
      "master-services-agreement",
      "mutual-nda",
      "saas-subscription-docx",
      "saas-subscription-pdf",
      "scanned-quote",
    ]);
  });
});
