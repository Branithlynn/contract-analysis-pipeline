import { describe, expect, it } from "vitest";
import {
  ExtractionResultSchema,
  LlmExtractionSchema,
  llmExtractionJsonSchema,
  type ExtractionResult,
  type LlmExtraction,
} from "./extraction.js";

const fullLlm: LlmExtraction = {
  document_type: { value: "contract", quote: "Master Services Agreement", confidence: "high" },
  vendor_name: { value: "Acme Cloud Ltd", quote: 'Acme Cloud Ltd ("Vendor")', confidence: "high" },
  customer_name: { value: "Nexus Corp", quote: 'Nexus Corp ("Customer")', confidence: "high" },
  payment_terms: { value: "net 45", quote: "within forty-five (45) days", confidence: "medium" },
  governing_law: {
    value: "England and Wales",
    quote: "laws of England and Wales",
    confidence: "high",
  },
  liability_cap: {
    value: "fees paid in the prior 12 months",
    quote: "shall not exceed the fees paid",
    confidence: "medium",
  },
  effective_date: {
    value: "2026-03-01",
    quote: "effective as of 1 March 2026",
    confidence: "high",
  },
  expiration_date: { value: null, quote: null, confidence: "low" },
  initial_term_months: {
    value: 24,
    quote: "initial term of twenty-four (24) months",
    confidence: "high",
  },
  renewal_term_months: {
    value: 12,
    quote: "successive twelve (12) month periods",
    confidence: "high",
  },
  termination_notice_days: { value: 90, quote: "at least ninety (90) days", confidence: "high" },
  auto_renewal: { value: true, quote: "shall automatically renew", confidence: "high" },
  total_contract_value: {
    value: { amount: 120000, currency: "EUR" },
    quote: "EUR 120,000",
    confidence: "medium",
  },
  risk_clauses: [
    {
      category: "auto_renewal",
      severity: "medium",
      title: "Automatic renewal",
      explanation: "Renews for 12 months unless cancelled 90 days before term end.",
      quote: "shall automatically renew",
    },
  ],
  summary: "Two year cloud services agreement with automatic annual renewal.",
};

const nullField = { value: null, quote: null, confidence: "low" } as const;

const allNullLlm: LlmExtraction = {
  document_type: nullField,
  vendor_name: nullField,
  customer_name: nullField,
  payment_terms: nullField,
  governing_law: nullField,
  liability_cap: nullField,
  effective_date: nullField,
  expiration_date: nullField,
  initial_term_months: nullField,
  renewal_term_months: nullField,
  termination_notice_days: nullField,
  auto_renewal: nullField,
  total_contract_value: nullField,
  risk_clauses: [],
  summary: "",
};

function verified<T extends { quote: string | null }>(f: T) {
  return { ...f, quote_verified: f.quote !== null, quote_page: f.quote === null ? null : 1 };
}

const validResult: ExtractionResult = {
  document_type: verified(fullLlm.document_type),
  vendor_name: verified(fullLlm.vendor_name),
  customer_name: verified(fullLlm.customer_name),
  payment_terms: verified(fullLlm.payment_terms),
  governing_law: verified(fullLlm.governing_law),
  liability_cap: verified(fullLlm.liability_cap),
  effective_date: verified(fullLlm.effective_date),
  expiration_date: verified(fullLlm.expiration_date),
  initial_term_months: verified(fullLlm.initial_term_months),
  renewal_term_months: verified(fullLlm.renewal_term_months),
  termination_notice_days: verified(fullLlm.termination_notice_days),
  auto_renewal: verified(fullLlm.auto_renewal),
  total_contract_value: verified(fullLlm.total_contract_value),
  risk_clauses: fullLlm.risk_clauses.map(verified),
  summary: fullLlm.summary,
  derived: {
    expiration_date: "2028-02-29",
    expiration_source: "computed",
    current_term_end: "2028-02-29",
    next_renewal_date: "2028-03-01",
    notice_deadline: "2027-12-01",
    days_until_notice_deadline: 417,
    alerts: [{ level: "info", message: "Notice deadline is more than 90 days away." }],
  },
  conflicts: [
    {
      field: "payment_terms",
      values: [
        { value: "net 45", chunk_index: 0, quote: "within forty-five (45) days" },
        { value: "net 30", chunk_index: 3, quote: "within thirty (30) days" },
      ],
    },
  ],
  warnings: [],
  grounding_score: 0.92,
};

describe("LlmExtractionSchema", () => {
  it("accepts a fully populated extraction", () => {
    expect(LlmExtractionSchema.safeParse(fullLlm).success).toBe(true);
  });

  it("accepts an extraction where every value is null", () => {
    expect(LlmExtractionSchema.safeParse(allNullLlm).success).toBe(true);
  });

  it("rejects a value outside an enum", () => {
    const bad = { ...fullLlm, document_type: { ...fullLlm.document_type, value: "invoice" } };
    expect(LlmExtractionSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a missing key", () => {
    const withoutSummary: Partial<LlmExtraction> = { ...fullLlm };
    delete withoutSummary.summary;
    expect(LlmExtractionSchema.safeParse(withoutSummary).success).toBe(false);
  });
});

describe("llmExtractionJsonSchema", () => {
  const schema = llmExtractionJsonSchema();

  function walk(node: unknown, visit: (obj: Record<string, unknown>) => void): void {
    if (Array.isArray(node)) {
      node.forEach((child) => walk(child, visit));
    } else if (node !== null && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      visit(obj);
      Object.values(obj).forEach((child) => walk(child, visit));
    }
  }

  it("has no top level $schema key", () => {
    expect(schema).not.toHaveProperty("$schema");
  });

  it("sets additionalProperties false on every object", () => {
    const objects: Record<string, unknown>[] = [];
    walk(schema, (obj) => {
      if (obj.type === "object") objects.push(obj);
    });
    expect(objects.length).toBeGreaterThan(0);
    for (const obj of objects) expect(obj.additionalProperties).toBe(false);
  });

  it("contains no pattern anywhere in the tree", () => {
    const withPattern: Record<string, unknown>[] = [];
    walk(schema, (obj) => {
      if ("pattern" in obj) withPattern.push(obj);
    });
    expect(withPattern).toEqual([]);
  });
});

describe("ExtractionResultSchema", () => {
  it("accepts a valid result", () => {
    const parsed = ExtractionResultSchema.safeParse(validResult);
    expect(parsed.error).toBeUndefined();
  });

  it("rejects a date that is not YYYY-MM-DD", () => {
    const bad = {
      ...validResult,
      effective_date: { ...validResult.effective_date, value: "1 March 2026" },
    };
    expect(ExtractionResultSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a lowercase currency code", () => {
    const bad = {
      ...validResult,
      total_contract_value: {
        ...validResult.total_contract_value,
        value: { amount: 120000, currency: "eur" },
      },
    };
    expect(ExtractionResultSchema.safeParse(bad).success).toBe(false);
  });
});
