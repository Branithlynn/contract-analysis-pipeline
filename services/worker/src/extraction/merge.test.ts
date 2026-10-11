import { describe, expect, it } from "vitest";
import type { GroundedExtraction } from "./grounding.js";
import { mergeExtractions, type ChunkResult } from "./merge.js";

const notFound = {
  value: null,
  quote: null,
  confidence: "low",
  quote_verified: false,
  quote_page: null,
} as const;

const EMPTY: GroundedExtraction = {
  document_type: notFound,
  vendor_name: notFound,
  customer_name: notFound,
  payment_terms: notFound,
  governing_law: notFound,
  liability_cap: notFound,
  effective_date: notFound,
  expiration_date: notFound,
  initial_term_months: notFound,
  renewal_term_months: notFound,
  termination_notice_days: notFound,
  auto_renewal: notFound,
  total_contract_value: notFound,
  risk_clauses: [],
  summary: "",
};

function chunk(chunkIndex: number, data: Partial<GroundedExtraction>): ChunkResult {
  return { chunkIndex, data: { ...EMPTY, ...data } };
}

function found<T>(
  value: T,
  quote: string,
  opts: { verified?: boolean; confidence?: "high" | "medium" | "low"; page?: number } = {},
) {
  const verified = opts.verified ?? true;
  return {
    value,
    quote,
    confidence: opts.confidence ?? "high",
    quote_verified: verified,
    quote_page: verified ? (opts.page ?? 1) : null,
  };
}

const renewal = {
  category: "auto_renewal",
  title: "Automatic renewal",
  explanation: "Nexus is locked in unless it gives notice.",
  quote_verified: true,
  quote_page: 2,
} as const;

describe("mergeExtractions", () => {
  it("returns a single chunk as it is", () => {
    const only = chunk(0, { vendor_name: found("Acme", "Acme Ltd"), summary: "Acme hosting." });

    expect(mergeExtractions([only])).toEqual({ data: only.data, conflicts: [] });
  });

  it("prefers a verified value over an unverified one from an earlier chunk", () => {
    const { data, conflicts } = mergeExtractions([
      chunk(0, { vendor_name: found("Acme Holdings", "Acme Holdings", { verified: false }) }),
      chunk(1, { vendor_name: found("Acme Ltd", "Acme Ltd", { confidence: "low" }) }),
    ]);

    expect(data.vendor_name.value).toBe("Acme Ltd");
    expect(conflicts).toEqual([]);
  });

  it("prefers high over medium confidence when both are verified, and reports the conflict", () => {
    const { data, conflicts } = mergeExtractions([
      chunk(0, { governing_law: found("Delaware", "laws of Delaware", { confidence: "medium" }) }),
      chunk(1, { governing_law: found("New York", "laws of New York", { confidence: "high" }) }),
    ]);

    expect(data.governing_law.value).toBe("New York");
    expect(conflicts).toEqual([
      {
        field: "governing_law",
        values: [
          { value: "New York", chunk_index: 1, quote: "laws of New York" },
          { value: "Delaware", chunk_index: 0, quote: "laws of Delaware" },
        ],
      },
    ]);
  });

  it("takes the earlier chunk on a full tie", () => {
    const { data } = mergeExtractions([
      chunk(0, { payment_terms: found("net 30", "net 30") }),
      chunk(1, { payment_terms: found("net 45", "net 45") }),
    ]);

    expect(data.payment_terms.value).toBe("net 30");
  });

  it("reports two verified different amounts as a conflict", () => {
    const { data, conflicts } = mergeExtractions([
      chunk(0, {
        total_contract_value: found({ amount: 120000, currency: "USD" }, "USD 120,000"),
      }),
      chunk(1, {
        total_contract_value: found({ amount: 150000, currency: "USD" }, "USD 150,000"),
      }),
      chunk(2, {
        total_contract_value: found({ amount: 999, currency: "USD" }, "USD 999", {
          verified: false,
        }),
      }),
    ]);

    expect(data.total_contract_value.value).toEqual({ amount: 120000, currency: "USD" });
    expect(conflicts).toEqual([
      {
        field: "total_contract_value",
        values: [
          { value: { amount: 120000, currency: "USD" }, chunk_index: 0, quote: "USD 120,000" },
          { value: { amount: 150000, currency: "USD" }, chunk_index: 1, quote: "USD 150,000" },
        ],
      },
    ]);
  });

  it("sees the same value from two chunks as no conflict, ignoring case and spacing", () => {
    const { data, conflicts } = mergeExtractions([
      chunk(0, { vendor_name: found("Acme  Ltd", "Acme Ltd") }),
      chunk(1, { vendor_name: found("ACME LTD", "ACME LTD") }),
      chunk(2, { initial_term_months: found(12, "12 months") }),
      chunk(3, { initial_term_months: found(12, "twelve (12) months") }),
    ]);

    expect(data.vendor_name.value).toBe("Acme  Ltd");
    expect(data.initial_term_months.value).toBe(12);
    expect(conflicts).toEqual([]);
  });

  it("never lets a null from another chunk count against a value", () => {
    const { data } = mergeExtractions([
      chunk(0, {}),
      chunk(1, { auto_renewal: found(true, "renews automatically") }),
      chunk(2, {}),
    ]);

    expect(data.auto_renewal.value).toBe(true);
    expect(data.customer_name).toEqual(notFound);
  });

  it("picks document_type by majority vote, earliest on a tie", () => {
    const majority = mergeExtractions([
      chunk(0, { document_type: found("sow", "Statement of Work") }),
      chunk(1, { document_type: found("contract", "Agreement") }),
      chunk(2, { document_type: found("contract", "Agreement") }),
    ]);
    const tie = mergeExtractions([
      chunk(0, { document_type: found("sow", "Statement of Work") }),
      chunk(1, { document_type: found("contract", "Agreement") }),
    ]);

    expect(majority.data.document_type.value).toBe("contract");
    expect(tie.data.document_type.value).toBe("sow");
    expect(majority.conflicts).toEqual([]);
  });

  it("dedupes a risk clause repeated by the overlap between chunks", () => {
    const quote = "This Agreement renews automatically for successive 12 month terms.";
    const { data } = mergeExtractions([
      chunk(0, { risk_clauses: [{ ...renewal, severity: "high", quote }] }),
      chunk(1, {
        risk_clauses: [
          { ...renewal, severity: "high", quote: `${quote} unless terminated` },
          {
            ...renewal,
            category: "exclusivity",
            severity: "medium",
            title: "Exclusive",
            quote: "Customer shall buy only from Vendor.",
          },
        ],
      }),
    ]);

    expect(data.risk_clauses.map((r) => [r.category, r.quote])).toEqual([
      ["auto_renewal", quote],
      ["exclusivity", "Customer shall buy only from Vendor."],
    ]);
  });

  it("keeps the higher severity duplicate, then the verified one, at the first one's position", () => {
    const quote = "Vendor may increase fees annually by any amount.";
    const priceRisk = {
      ...renewal,
      category: "unilateral_price_increase",
      title: "Price",
    } as const;
    const { data } = mergeExtractions([
      chunk(0, {
        risk_clauses: [
          { ...priceRisk, severity: "medium", quote },
          { ...renewal, severity: "low", quote: "renews automatically for 12 months" },
        ],
      }),
      chunk(1, {
        risk_clauses: [
          { ...priceRisk, severity: "high", quote, quote_verified: false, quote_page: null },
          {
            ...renewal,
            severity: "low",
            quote: "renews automatically for 12 months",
            quote_page: 3,
          },
        ],
      }),
    ]);

    expect(data.risk_clauses.map((r) => [r.category, r.severity, r.quote_page])).toEqual([
      ["unilateral_price_increase", "high", null],
      ["auto_renewal", "low", 2],
    ]);
  });

  it("keeps two risks of the same category whose quotes differ", () => {
    const { data } = mergeExtractions([
      chunk(0, {
        risk_clauses: [{ ...renewal, severity: "high", quote: "renews automatically each year" }],
      }),
      chunk(1, {
        risk_clauses: [
          { ...renewal, severity: "high", quote: "notice must be given ninety days before expiry" },
        ],
      }),
    ]);

    expect(data.risk_clauses).toHaveLength(2);
  });
});
