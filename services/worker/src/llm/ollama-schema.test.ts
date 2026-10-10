import { RiskCategory, llmExtractionJsonSchema } from "@nexus/shared";
import { describe, expect, it } from "vitest";
import { buildFieldGuide, capSchemaForOllama } from "./ollama-schema.js";

type Node = Record<string, unknown>;

function collect(node: unknown, key: string, out: Node[] = []): Node[] {
  if (Array.isArray(node)) {
    node.forEach((child) => collect(child, key, out));
  } else if (node !== null && typeof node === "object") {
    const obj = node as Node;
    const props = obj.properties as Record<string, Node> | undefined;
    if (props?.[key] !== undefined) out.push(props[key]);
    Object.values(obj).forEach((child) => collect(child, key, out));
  }
  return out;
}

describe("capSchemaForOllama", () => {
  const schema = {
    type: "object",
    properties: {
      vendor_name: {
        type: "object",
        properties: {
          value: { type: ["string", "null"] },
          quote: { type: "string", description: "exact text" },
        },
      },
      risk_clauses: {
        type: "array",
        items: {
          type: "object",
          properties: {
            explanation: { type: "string" },
            quote: { type: "string" },
          },
        },
      },
      summary: { type: "string" },
    },
  };

  it("caps every quote at 300 chars, at any depth, keeping its other keys", () => {
    const capped = capSchemaForOllama(schema);

    expect(collect(capped, "quote")).toEqual([
      { type: "string", description: "exact text", maxLength: 300 },
      { type: "string", maxLength: 300 },
    ]);
  });

  it("caps explanation at 400 chars and risk_clauses at 12 items", () => {
    const capped = capSchemaForOllama(schema);

    expect(collect(capped, "explanation")).toEqual([{ type: "string", maxLength: 400 }]);
    expect(collect(capped, "risk_clauses")[0]).toMatchObject({ type: "array", maxItems: 12 });
  });

  it("leaves everything else as it was", () => {
    const capped = capSchemaForOllama(schema) as Node;
    const props = capped.properties as Record<string, Node>;

    expect(props.summary).toEqual({ type: "string" });
    expect((props.vendor_name?.properties as Record<string, Node>).value).toEqual({
      type: ["string", "null"],
    });
  });

  it("doesn't mutate the input, the same schema object goes to other providers", () => {
    const before = structuredClone(schema);

    capSchemaForOllama(schema);

    expect(schema).toEqual(before);
  });

  it("caps all 14 quotes of the real extraction schema", () => {
    const capped = capSchemaForOllama(llmExtractionJsonSchema());

    const quotes = collect(capped, "quote");
    expect(quotes).toHaveLength(14); // 13 fields + the risk clause quote
    for (const quote of quotes) expect(quote.maxLength).toBe(300);
    expect(collect(capped, "explanation")[0]?.maxLength).toBe(400);
    expect(collect(capped, "risk_clauses")[0]?.maxItems).toBe(12);
  });
});

describe("buildFieldGuide", () => {
  const small = {
    type: "object",
    properties: {
      vendor_name: {
        type: "object",
        description: "Party providing the goods",
        properties: {
          value: { type: ["string", "null"] },
          quote: { type: "string", description: "Exact text" },
          confidence: { type: "string", enum: ["high", "low"] },
        },
      },
      document_type: {
        type: "object",
        description: "Kind of document",
        properties: {
          value: { anyOf: [{ type: "string", enum: ["contract", "nda"] }, { type: "null" }] },
          quote: { type: "string", description: "Exact text" },
          confidence: { type: "string", enum: ["high", "low"] },
        },
      },
      total: {
        type: "object",
        properties: {
          value: {
            anyOf: [
              {
                type: "object",
                properties: { currency: { type: "string", description: "ISO code" } },
              },
              { type: "null" },
            ],
          },
        },
      },
      risks: {
        type: "array",
        items: {
          type: "object",
          properties: { quote: { type: "string", description: "Exact text from the document" } },
        },
      },
    },
  };

  it("writes one line per described or enum field, shared lines once as *.key, in schema order", () => {
    expect(buildFieldGuide(small).split("\n")).toEqual([
      "vendor_name: Party providing the goods",
      "*.quote: Exact text",
      "*.confidence: one of: high, low",
      "document_type: Kind of document",
      "document_type.value: one of: contract, nda",
      "total.value.currency: ISO code",
      "risks[].quote: Exact text from the document",
    ]);
  });

  it("returns an empty string for a schema with nothing to explain", () => {
    expect(buildFieldGuide({ type: "object", properties: { a: { type: "string" } } })).toBe("");
  });

  it("covers the new definitions and the full risk category list for the real schema", () => {
    const guide = buildFieldGuide(llmExtractionJsonSchema());
    const size = `field guide is ${guide.length} chars`;

    expect(guide, size).toContain("signing date is not the effective date");
    expect(guide, size).toContain("Never a cure or remedy period");
    expect(guide, size).toContain("risk_clauses[].explanation: One sentence in your own words");
    expect(guide, size).toContain(
      `risk_clauses[].category: one of: ${RiskCategory.options.join(", ")}`,
    );
    expect(guide, size).toContain("risk_clauses[].severity: one of: low, medium, high");
    expect(guide, size).toContain("*.confidence: one of: high, medium, low");
    expect(guide, size).toContain("document_type.value: one of: contract, proposal");
    // Printed so the size is visible in the test output; well under the full schema's ~7000 chars.
    expect(guide.length, size).toBeLessThan(3000);
  });
});
