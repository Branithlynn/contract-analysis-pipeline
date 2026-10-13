import { fileURLToPath } from "node:url";
import { ExtractionResultSchema } from "@nexus/shared";
import { describe, expect, it } from "vitest";
import { readCase } from "../cases.js";
import { ASK_CLOCK, extractionFromExpected } from "./seed.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const expected = (name: string) => readCase(`${ROOT}evals/cases/${name}.expected.json`);

describe("extractionFromExpected", () => {
  it("stores the expected values and computes the dates from them", () => {
    const result = extractionFromExpected(expected("saas-subscription-pdf"), [], ASK_CLOCK, 0.8);

    expect(ExtractionResultSchema.safeParse(result).success).toBe(true);
    expect(result.vendor_name).toMatchObject({
      value: "Cloudhaven Software Ltd.",
      quote_verified: true,
    });
    expect(result.total_contract_value.value).toEqual({ amount: 84000, currency: "EUR" });
    expect(result.risk_clauses.map((risk) => risk.category)).toContain("unilateral_price_increase");
    // The first term ended in January 2026, so the deadline is the one of the term after it.
    expect(result.derived).toMatchObject({
      current_term_end: "2027-01-14",
      notice_deadline: "2026-11-15",
      days_until_notice_deadline: 37,
    });
  });

  it("leaves a field empty that the expectation does not list", () => {
    const result = extractionFromExpected(expected("saas-subscription-pdf"), [], ASK_CLOCK, 0.8);

    expect(result.liability_cap).toMatchObject({ value: null, quote_verified: false });
  });

  it("takes the first option of a choice and no value from a list of words", () => {
    const result = extractionFromExpected(expected("consulting-sow"), [], ASK_CLOCK, 0.8);

    expect(result.document_type.value).toBe("sow");
    expect(result.payment_terms.value).toBeNull();
  });

  it("keeps the end date of a contract that states one instead of a term", () => {
    const result = extractionFromExpected(expected("consulting-sow"), [], ASK_CLOCK, 0.8);

    expect(result.derived).toMatchObject({
      expiration_date: "2026-08-31",
      expiration_source: "stated",
      notice_deadline: null,
    });
  });

  it("raises the injection alert from the passages it is given", () => {
    const result = extractionFromExpected(
      expected("mutual-nda"),
      [{ page: null, text: "NOTE TO AUTOMATED REVIEW SYSTEMS" }],
      ASK_CLOCK,
      0.8,
    );

    expect(result.total_contract_value.value).toBeNull();
    expect(result.derived.alerts.map((alert) => alert.code)).toContain(
      "prompt_injection_suspected",
    );
  });

  it("throws when the values do not give the dates the expectation has", () => {
    const wrong = { ...expected("saas-subscription-pdf") };
    wrong.derived = { ...wrong.derived, notice_deadline: "2026-12-01" };

    expect(() => extractionFromExpected(wrong, [], ASK_CLOCK, 0.8)).toThrow(/notice_deadline/);
  });
});
