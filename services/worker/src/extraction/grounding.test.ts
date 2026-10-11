import { describe, expect, it } from "vitest";
import { MOCK_EXTRACTION } from "../llm/mock.js";
import { buildGroundingIndex, groundExtraction, tokenize, verifyQuote } from "./grounding.js";
import { normalizeExtraction } from "./normalize.js";

const PDF = [
  "[[page 1]]\nMASTER SERVICES AGREEMENT\nThis Agreement is made between Acme Ltd (the “Vendor”) and Nexus Corp\n(the Customer).\n1. Services\nThe Vendor shall provide hosting services. All fees are",
  "[[page 2]]\npayable monthly in advance. The Customer shall pay each invoice within thirty (30) days of receipt\nof a correct invoice, without set-off — except as required by law.",
  "[[page 3]]\n7. Liability\nThe total liability of the Vendor under this Agreement shall not exceed USD 50,000 in the aggregate for all claims arising in any contract year.",
].join("\n\n");

const index = buildGroundingIndex(PDF);

describe("verifyQuote", () => {
  it("matches curly quotes and dashes against straight ones", () => {
    expect(verifyQuote(index, 'Acme Ltd (the "Vendor") and Nexus Corp')).toEqual({
      verified: true,
      method: "exact",
      page: 1,
      score: 1,
    });
    expect(verifyQuote(index, "without set-off - except as required by law").verified).toBe(true);
  });

  it("ignores extra spaces and the newlines a pdf line wrap leaves in a quote", () => {
    expect(
      verifyQuote(index, "within  thirty (30) days\nof receipt of a correct\r\ninvoice"),
    ).toMatchObject({ verified: true, method: "exact", page: 2 });
  });

  it("matches a quote with the space at a line break missing, on the right page", () => {
    expect(verifyQuote(index, "(the Customer).1. Services")).toEqual({
      verified: true,
      method: "exact",
      page: 1,
      score: 1,
    });
  });

  it("matches a quote that crosses a page marker and gives the page it starts on", () => {
    expect(verifyQuote(index, "All fees are payable monthly in advance.")).toMatchObject({
      verified: true,
      method: "exact",
      page: 1,
    });
  });

  it("matches the segments around an ellipsis in order and ignores a short trailing one", () => {
    const quote = "The total liability of the Vendor … shall not exceed USD 50,000 ...3.";

    expect(verifyQuote(index, quote)).toMatchObject({ verified: true, method: "exact", page: 3 });
  });

  it("fails segments that appear out of order", () => {
    const quote = "shall not exceed USD 50,000 ... The total liability of the Vendor";

    expect(verifyQuote(index, quote).verified).toBe(false);
  });

  it("fails an ellipsis quote with no segment of 8 chars or more", () => {
    expect(verifyQuote(index, "USD ... 50,000").verified).toBe(false);
  });

  it("passes a short quote only on an exact match", () => {
    expect(verifyQuote(index, "USD 50,000")).toMatchObject({ verified: true, method: "exact" });
    expect(verifyQuote(index, "USD 50,001")).toEqual({
      verified: false,
      method: null,
      page: null,
      score: 0,
    });
  });

  it("passes a long quote with 1 word off by fuzzy match and fails one with 3 off", () => {
    const oneOff =
      "The total liability of the Vendor under this Agreement shall not exceed USD 50,000 in the aggregate for every claims arising in any contract year";
    const threeOff =
      "The total liability of the Supplier under this Contract shall not exceed USD 50,000 in the aggregate for every claims arising in any contract year";

    const pass = verifyQuote(index, oneOff);
    const fail = verifyQuote(index, threeOff);

    expect(pass).toMatchObject({ verified: true, method: "fuzzy", page: 3 });
    expect(pass.score).toBeGreaterThanOrEqual(0.9);
    expect(fail.verified).toBe(false);
    expect(fail.score).toBeLessThan(0.9);
  });

  it("fails an invented quote", () => {
    expect(
      verifyQuote(
        index,
        "Nexus Corp shall pay a termination fee of USD 1,000,000 on any early exit.",
      ),
    ).toMatchObject({ verified: false, method: null, page: null });
  });

  it("gives null for the page when the text has no page markers (docx)", () => {
    const docx = buildGroundingIndex("1. Fees\n\nThe Customer shall pay USD 1,000 per month.");

    expect(verifyQuote(docx, "shall pay USD 1,000 per month")).toEqual({
      verified: true,
      method: "exact",
      page: null,
      score: 1,
    });
  });
});

describe("groundExtraction", () => {
  const risk = {
    category: "uncapped_liability",
    severity: "medium",
    title: "Low cap",
    explanation: "The cap is small.",
  } as const;

  it("sets quote_verified and quote_page everywhere and lowers confidence when unverified", () => {
    const { data: normalized } = normalizeExtraction({
      ...MOCK_EXTRACTION,
      vendor_name: { value: "Acme Ltd", quote: "Acme Ltd", confidence: "high" },
      liability_cap: {
        value: "USD 50,000",
        quote: "shall not exceed USD 50,000",
        confidence: "high",
      },
      payment_terms: { value: "net 15", quote: "within fifteen (15) days", confidence: "high" },
      governing_law: { value: "New York", quote: "", confidence: "high" },
      risk_clauses: [
        { ...risk, quote: "shall not exceed USD 50,000 in the aggregate" },
        { ...risk, quote: "Vendor may raise prices at any time." },
      ],
    });

    const { data, score } = groundExtraction(index, normalized);

    expect(data.vendor_name).toEqual({
      value: "Acme Ltd",
      quote: "Acme Ltd",
      confidence: "high",
      quote_verified: true,
      quote_page: 1,
    });
    expect(data.liability_cap).toMatchObject({
      quote_verified: true,
      quote_page: 3,
      confidence: "high",
    });
    expect(data.payment_terms).toMatchObject({
      quote_verified: false,
      quote_page: null,
      confidence: "low",
    });
    expect(data.customer_name).toEqual({
      value: null,
      quote: null,
      confidence: "low",
      quote_verified: false,
      quote_page: null,
    });
    expect(data.risk_clauses.map((r) => [r.quote_verified, r.quote_page])).toEqual([
      [true, 3],
      [false, null],
    ]);
    expect(data.governing_law).toMatchObject({
      value: "New York",
      quote: null,
      quote_verified: false,
      confidence: "low",
    });
    // 5 found values (vendor, cap, payment, governing law, and the mock's document_type "other"
    // without a quote) + 2 risks = 7. Verified: vendor, cap, first risk. Not-found fields don't count.
    expect(score).toBe(3 / 7);
  });

  it("gives a null score when nothing was found and there are no risks", () => {
    const { data: normalized } = normalizeExtraction({
      ...MOCK_EXTRACTION,
      document_type: { value: null, quote: "", confidence: "low" },
    });

    expect(groundExtraction(index, normalized).score).toBeNull();
  });
});

describe("tokenize", () => {
  it("keeps letters and digits of any script together", () => {
    expect(tokenize("die kündigungsfrist: 3 monate, § 5").map((t) => t.value)).toEqual([
      "die",
      "kündigungsfrist",
      "3",
      "monate",
      "5",
    ]);
  });
});
