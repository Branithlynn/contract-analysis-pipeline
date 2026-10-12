import { describe, expect, it } from "vitest";
import type { ChunkHit } from "@nexus/shared/node";
import { docId, extractionResult, field } from "../test-support/fixtures.js";
import { verifyCitations, type CitationSources } from "./citations.js";
import type { ContractRow } from "./tools.js";

const LIABILITY: ChunkHit = {
  chunk_id: 7,
  document_id: docId(1),
  file_name: "msa.pdf",
  page_start: 5,
  page_end: 6,
  // "in the preceding" starts page 6.
  page_breaks: [{ page: 6, offset: 57 }],
  text: "The Vendor's total liability is limited to the fees paid\nin the preceding 12 months.",
  score: 0,
};
const DOCX: ChunkHit = {
  chunk_id: 8,
  document_id: docId(2),
  file_name: "sow.docx",
  page_start: null,
  page_end: null,
  page_breaks: [],
  text: "Invoices are payable within 30 days (Net 30) of the invoice date.",
  score: 0,
};
const CONTRACT: ContractRow = {
  id: docId(1),
  file_name: "msa.pdf",
  needs_review: false,
  result: extractionResult({
    vendor_name: field("Acme Cloud Ltd"),
    payment_terms: { ...field("net 45"), quote: "payable within forty-five (45) days" },
  }),
};

const sources: CitationSources = {
  chunk: (id) => [LIABILITY, DOCX].find((chunk) => chunk.chunk_id === id),
  contract: (id) => (id === CONTRACT.id ? CONTRACT : undefined),
};

const check = (answer: string) => verifyCitations(answer, sources);

describe("verifyCitations", () => {
  it("verifies a chunk citation whose quote is in the chunk and finds the quote's page", () => {
    const answer = `The cap is "limited to the fees paid in the preceding 12 months" [chunk:7].`;

    expect(check(answer)).toEqual([
      {
        marker: "[chunk:7]",
        start: answer.indexOf("[chunk:7]"),
        kind: "chunk",
        id: "7",
        status: "verified",
        document_id: docId(1),
        file_name: "msa.pdf",
        // The quote starts on page 5 and ends on 6, not just "somewhere in 5 to 6".
        page_start: 5,
        page_end: 6,
        quotes: [
          {
            text: "limited to the fees paid in the preceding 12 months",
            found: true,
            page_start: 5,
            page_end: 6,
          },
        ],
      },
    ]);
  });

  it("places a quote from the second page of a chunk on that page", () => {
    const [citation] = check(`It covers "the preceding 12 months" [chunk:7].`);

    expect(citation).toMatchObject({ status: "verified", page_start: 6, page_end: 6 });
  });

  it("marks a citation of a chunk that does not exist", () => {
    const [citation] = check(`The cap is "limited to the fees paid" [chunk:999].`);

    expect(citation).toMatchObject({
      marker: "[chunk:999]",
      status: "not_found",
      document_id: null,
      file_name: null,
      page_start: null,
      quotes: [{ text: "limited to the fees paid", found: false }],
    });
  });

  it("marks a citation whose quote is not in the chunk", () => {
    const [citation] = check(`Liability is "unlimited for all claims" [chunk:7].`);

    expect(citation).toMatchObject({
      status: "quote_not_found",
      // The chunk exists, so the ui can still show where the model claims to have read it.
      file_name: "msa.pdf",
      page_start: 5,
      page_end: 6,
      quotes: [{ text: "unlimited for all claims", found: false, page_start: null }],
    });
  });

  it("verifies a citation without a quote by the chunk existing, with the chunk's pages", () => {
    expect(check("The liability is capped [chunk:7].")).toMatchObject([
      { status: "verified", page_start: 5, page_end: 6, quotes: [] },
    ]);
  });

  it("accepts the quote the way grounding does: other whitespace, quotes and case", () => {
    const [citation] = check(`It says “The vendor’s  total liability is limited” [chunk:7].`);

    expect(citation).toMatchObject({ status: "verified" });
  });

  it("checks a short quote as plain text", () => {
    expect(check(`Payment is "Net 30" [chunk:8].`)).toMatchObject([
      { status: "verified", page_start: null, quotes: [{ text: "Net 30", found: true }] },
    ]);
    expect(check(`Payment is "Net 90" [chunk:8].`)).toMatchObject([{ status: "quote_not_found" }]);
  });

  it("does not take a made up id for a chunk", () => {
    expect(check("See [chunk:abc] and [chunk:7x].").map((c) => c.status)).toEqual([
      "not_found",
      "not_found",
    ]);
  });

  it("verifies a contract citation and checks its quote against the extracted values", () => {
    const id = docId(1);

    expect(check(`The vendor is "Acme Cloud Ltd" [contract:${id}].`)).toMatchObject([
      { kind: "contract", id, status: "verified", document_id: id, file_name: "msa.pdf" },
    ]);
    // The quote kept with a field counts too.
    expect(
      check(`Invoices are "payable within forty-five (45) days" [contract:${id}].`),
    ).toMatchObject([{ status: "verified" }]);
    expect(check(`The vendor is "Globex Inc" [contract:${id}].`)).toMatchObject([
      { status: "quote_not_found" },
    ]);
    expect(check(`The vendor is Acme [contract:${docId(9)}].`)).toMatchObject([
      { status: "not_found", document_id: null },
    ]);
  });

  it("gives a quote to the citation that follows it, not to a later one", () => {
    const citations = check(
      `It is "limited to the fees paid" [chunk:7]. Payment is "Net 30" [chunk:8].`,
    );

    expect(citations.map((c) => [c.id, c.status, c.quotes.map((q) => q.text)])).toEqual([
      ["7", "verified", ["limited to the fees paid"]],
      ["8", "verified", ["Net 30"]],
    ]);
  });

  it("lets citations in a row back one sentence together", () => {
    const backed = check(`It is "limited to the fees paid" and "Net 30" [chunk:7], [chunk:8].`);
    expect(backed.map((c) => c.status)).toEqual(["verified", "verified"]);
    expect(backed[0]?.quotes.map((q) => q.found)).toEqual([true, false]);

    // One quote that neither has leaves both unverified.
    const unbacked = check(`It is "limited to the fees paid" and "Net 90" [chunk:7] [chunk:8].`);
    expect(unbacked.map((c) => c.status)).toEqual(["quote_not_found", "quote_not_found"]);
  });

  it("returns nothing for an answer without citations", () => {
    expect(check("I could not find that in the contracts.")).toEqual([]);
  });
});
