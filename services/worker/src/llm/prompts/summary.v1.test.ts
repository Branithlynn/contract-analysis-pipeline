import { describe, expect, it } from "vitest";
import {
  LlmSummarySchema,
  PROMPT_VERSION,
  SCHEMA_NAME,
  buildSystemPrompt,
  buildUserMessage,
  summaryJsonSchema,
} from "./summary.v1.js";

// Pinned on purpose: a wording change becomes summary.v2, not an edit to v1.
const EXPECTED =
  "You write an 80-word plain summary of a vendor contract for a procurement analyst from the structured data provided. Mention vendor, scope if known, value, term and the most important risks. Do not add facts that are not in the data.";

describe("summary.v1", () => {
  it("returns exactly the agreed system prompt", () => {
    expect(buildSystemPrompt()).toBe(EXPECTED);
  });

  it("exposes its version and a schema name openai accepts", () => {
    expect(PROMPT_VERSION).toBe("summary.v1");
    expect(SCHEMA_NAME).toBe("contract_summary");
    expect(SCHEMA_NAME).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
  });
});

describe("summaryJsonSchema", () => {
  // Exact match keeps it inside every provider's structured output rules: no $schema, all keys
  // required, additionalProperties false, no unions, no min/max/pattern.
  it("is a single required string with nothing providers could reject", () => {
    expect(summaryJsonSchema()).toEqual({
      type: "object",
      properties: {
        summary: { type: "string", description: "Plain summary of the contract, about 80 words" },
      },
      required: ["summary"],
      additionalProperties: false,
    });
  });

  it("validates a reply", () => {
    expect(LlmSummarySchema.safeParse({ summary: "Acme provides hosting." }).success).toBe(true);
    expect(LlmSummarySchema.safeParse({ summary: null }).success).toBe(false);
  });
});

describe("buildUserMessage", () => {
  it("sends the merged data as json with every quote field removed, at any depth", () => {
    const merged = {
      vendor_name: {
        value: "Acme",
        quote: "Acme Ltd",
        quote_verified: true,
        quote_page: 1,
        confidence: "high",
      },
      risk_clauses: [{ category: "auto_renewal", severity: "high", quote: "renews automatically" }],
      summary: "",
    };

    expect(JSON.parse(buildUserMessage(merged))).toEqual({
      vendor_name: { value: "Acme", confidence: "high" },
      risk_clauses: [{ category: "auto_renewal", severity: "high" }],
      summary: "",
    });
  });

  it("keeps nulls and values that merely contain the word quote", () => {
    const merged = { liability_cap: { value: "per quote", confidence: "low" }, auto_renewal: null };

    expect(JSON.parse(buildUserMessage(merged))).toEqual(merged);
  });
});
