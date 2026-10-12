import { ExtractedFieldName, ExtractionResultSchema, type LlmExtraction } from "@nexus/shared";
import { describe, expect, it } from "vitest";
import { MOCK_EXTRACTION } from "../llm/mock.js";
import { normalizeExtraction } from "./normalize.js";

function withFields(fields: Partial<LlmExtraction>): LlmExtraction {
  return { ...MOCK_EXTRACTION, ...fields };
}

const risk = {
  category: "auto_renewal",
  severity: "high",
  title: "Renews automatically",
  explanation: "Nexus is locked in unless it gives notice.",
  quote: "This Agreement renews automatically for successive 12 month terms.",
} as const;

describe("normalizeExtraction", () => {
  it("keeps a valid date and drops one that isn't YYYY-MM-DD, saying what the model sent", () => {
    const { data, warnings } = normalizeExtraction(
      withFields({
        effective_date: { value: "1st March 2026", quote: "1st March 2026", confidence: "high" },
        expiration_date: { value: "2027-02-28", quote: "28 February 2027", confidence: "high" },
      }),
    );

    expect(data.effective_date).toEqual({ value: null, quote: null, confidence: "low" });
    expect(data.expiration_date).toEqual({
      value: "2027-02-28",
      quote: "28 February 2027",
      confidence: "high",
    });
    expect(warnings).toEqual(['effective_date: dropped "1st March 2026" (not YYYY-MM-DD)']);
  });

  it("drops a date in the right format that isn't a real day", () => {
    const { data, warnings } = normalizeExtraction(
      withFields({ effective_date: { value: "2026-02-30", quote: "x", confidence: "high" } }),
    );

    expect(data.effective_date.value).toBeNull();
    expect(warnings).toEqual(['effective_date: dropped "2026-02-30" (not a real date)']);
  });

  it("uppercases a currency code and drops one that isn't 3 letters", () => {
    const eur = normalizeExtraction(
      withFields({
        total_contract_value: {
          value: { amount: 120000, currency: " eur " },
          quote: "EUR 120,000",
          confidence: "high",
        },
      }),
    );
    const euro = normalizeExtraction(
      withFields({
        total_contract_value: {
          value: { amount: 120000, currency: "EURO" },
          quote: "120,000 Euro",
          confidence: "high",
        },
      }),
    );

    expect(eur.data.total_contract_value.value).toEqual({ amount: 120000, currency: "EUR" });
    expect(eur.warnings).toEqual([]);
    expect(euro.data.total_contract_value).toEqual({ value: null, quote: null, confidence: "low" });
    expect(euro.warnings).toEqual([
      'total_contract_value: dropped {"amount":120000,"currency":"EURO"} (currency is not a 3-letter code)',
    ]);
  });

  it("drops a negative amount", () => {
    const { data, warnings } = normalizeExtraction(
      withFields({
        total_contract_value: {
          value: { amount: -1, currency: "USD" },
          quote: "x",
          confidence: "high",
        },
      }),
    );

    expect(data.total_contract_value.value).toBeNull();
    expect(warnings[0]).toContain("amount is not a finite number >= 0");
  });

  it("accepts 12.0 as 12 and drops negative or out of range counts", () => {
    const { data, warnings } = normalizeExtraction(
      withFields({
        initial_term_months: { value: 12.0, quote: "twelve (12) months", confidence: "high" },
        renewal_term_months: { value: -5, quote: "x", confidence: "high" },
        termination_notice_days: { value: 4000, quote: "y", confidence: "high" },
      }),
    );

    expect(data.initial_term_months.value).toBe(12);
    expect(data.renewal_term_months).toEqual({ value: null, quote: null, confidence: "low" });
    expect(data.termination_notice_days.value).toBeNull();
    expect(warnings).toEqual([
      "renewal_term_months: dropped -5 (not a whole number in 0..1200)",
      "termination_notice_days: dropped 4000 (not a whole number in 0..3650)",
    ]);
  });

  it("drops a fractional month count", () => {
    const { data, warnings } = normalizeExtraction(
      withFields({ initial_term_months: { value: 12.5, quote: "x", confidence: "high" } }),
    );

    expect(data.initial_term_months.value).toBeNull();
    expect(warnings).toEqual(["initial_term_months: dropped 12.5 (not a whole number in 0..1200)"]);
  });

  it("turns a quote of 'null' or blank into null", () => {
    const { data } = normalizeExtraction(
      withFields({
        vendor_name: { value: "Acme Ltd", quote: "null", confidence: "medium" },
        customer_name: { value: "Nexus Corp", quote: "   ", confidence: "medium" },
      }),
    );

    expect(data.vendor_name).toEqual({ value: "Acme Ltd", quote: null, confidence: "medium" });
    expect(data.customer_name.quote).toBeNull();
  });

  it("clears the quote and sets low confidence on a null value, with no warning", () => {
    const { data, warnings } = normalizeExtraction(
      withFields({
        governing_law: { value: null, quote: "laws of the State of New York", confidence: "high" },
      }),
    );

    expect(data.governing_law).toEqual({ value: null, quote: null, confidence: "low" });
    expect(warnings).toEqual([]);
  });

  it("trims strings, turns empty ones into null and strips one pair of wrapping braces", () => {
    const { data } = normalizeExtraction(
      withFields({
        liability_cap: { value: "{USD 50,000}", quote: "USD 50,000", confidence: "high" },
        payment_terms: { value: "  net 30 ", quote: "net 30", confidence: "high" },
        vendor_name: { value: "  ", quote: "Acme", confidence: "high" },
        governing_law: { value: "{{New York}}", quote: "New York", confidence: "high" },
      }),
    );

    expect(data.liability_cap.value).toBe("USD 50,000");
    expect(data.payment_terms.value).toBe("net 30");
    expect(data.vendor_name).toEqual({ value: null, quote: null, confidence: "low" });
    expect(data.governing_law.value).toBe("{New York}");
  });

  it.each(["null", "NONE", "n/a", "Not Stated", " not specified ", "{N/A}"])(
    "treats a value of %j as not found: null, quote null, low, no warning",
    (word) => {
      const { data, warnings } = normalizeExtraction(
        withFields({
          governing_law: { value: word, quote: "Governing law: not stated", confidence: "high" },
          effective_date: { value: word, quote: "x", confidence: "medium" },
        }),
      );

      expect(data.governing_law).toEqual({ value: null, quote: null, confidence: "low" });
      expect(data.effective_date).toEqual({ value: null, quote: null, confidence: "low" });
      expect(warnings).toEqual([]);
    },
  );

  it("drops a governing_law that is a code or a date, saying what the model sent", () => {
    // All seen in the first eval runs. "DE" was meant as Delaware and reads as Germany.
    for (const [value, reason] of [
      ["DE", "a code, not the name of a jurisdiction"],
      ["LUX", "a code, not the name of a jurisdiction"],
      ["USA", "a code, not the name of a jurisdiction"],
      ["uk", "a code, not the name of a jurisdiction"],
      ["US-NY", "a code, not the name of a jurisdiction"],
      ["GB-ENG", "a code, not the name of a jurisdiction"],
      ["USA-NY", "a code, not the name of a jurisdiction"],
      ["GBR-ENG", "a code, not the name of a jurisdiction"],
      ["us-ca", "a code, not the name of a jurisdiction"],
      ["FR-75", "a code, not the name of a jurisdiction"],
      ["2023-01-01", "a date, not a jurisdiction"],
    ] as const) {
      const { data, warnings } = normalizeExtraction({
        ...MOCK_EXTRACTION,
        governing_law: { value, quote: "governed by the laws of", confidence: "high" },
      });

      expect(data.governing_law).toEqual({ value: null, quote: null, confidence: "low" });
      expect(warnings).toEqual([`governing_law: dropped ${JSON.stringify(value)} (${reason})`]);
    }
  });

  it("keeps a governing_law that names the jurisdiction, short or long", () => {
    const names = [
      "Ohio",
      "Iowa",
      "Delaware",
      "New York",
      "England and Wales",
      "Peru",
      // A dash alone doesn't make a code.
      "Guinea-Bissau",
      "Baden-Wuerttemberg",
      "US-based",
    ];
    for (const value of names) {
      const { data, warnings } = normalizeExtraction({
        ...MOCK_EXTRACTION,
        governing_law: { value, quote: "governed by the laws of", confidence: "high" },
      });

      expect(data.governing_law.value).toBe(value);
      expect(warnings).toEqual([]);
    }
  });

  it("keeps a value that only contains a not-found word", () => {
    const { data } = normalizeExtraction(
      withFields({ liability_cap: { value: "None of the above", quote: "x", confidence: "high" } }),
    );

    expect(data.liability_cap.value).toBe("None of the above");
  });

  it("drops a risk clause whose quote is 'null' or empty and keeps the rest trimmed", () => {
    const { data, warnings } = normalizeExtraction(
      withFields({
        risk_clauses: [
          { ...risk, title: " Renews automatically ", quote: ` ${risk.quote} ` },
          { ...risk, title: "Price increase", quote: "null" },
          { ...risk, title: "Exclusivity", quote: "" },
        ],
      }),
    );

    expect(data.risk_clauses).toEqual([{ ...risk }]);
    expect(warnings).toEqual([
      'risk_clauses: dropped "Price increase" (quote was "null")',
      'risk_clauses: dropped "Exclusivity" (quote was "")',
    ]);
  });

  it("produces fields the strict stored schema accepts once grounding adds its flags", () => {
    const { data } = normalizeExtraction(
      withFields({
        effective_date: { value: "2026-03-01", quote: "1 March 2026", confidence: "high" },
        initial_term_months: { value: 12.0, quote: "12 months", confidence: "high" },
        total_contract_value: {
          value: { amount: 5000, currency: "usd" },
          quote: "USD 5,000",
          confidence: "medium",
        },
        risk_clauses: [{ ...risk }],
      }),
    );
    const flags = { quote_verified: false, quote_page: null };
    const shape = ExtractionResultSchema.shape;

    for (const name of ExtractedFieldName.options) {
      expect(shape[name].safeParse({ ...data[name], ...flags }).success, name).toBe(true);
    }
    expect(
      shape.risk_clauses.safeParse(data.risk_clauses.map((r) => ({ ...r, ...flags }))).success,
    ).toBe(true);
  });

  it("passes the mock extraction through with nothing dropped", () => {
    const { data, warnings } = normalizeExtraction(MOCK_EXTRACTION);

    expect(warnings).toEqual([]);
    expect(data.document_type).toEqual({ value: "other", quote: null, confidence: "low" });
    expect(data.summary).toBe("Mock extraction.");
  });
});
