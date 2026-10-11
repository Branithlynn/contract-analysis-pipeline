import { LlmExtractionSchema, llmExtractionJsonSchema } from "@nexus/shared";
import { describe, expect, it } from "vitest";
import { ollamaContextFloor } from "../factory.js";
import { buildFieldGuide } from "../ollama-schema.js";
import { ollamaSystemPrompt } from "../ollama.js";
import { extractPrompt } from "./extract.js";
import * as v1 from "./extract.v1.js";
import { PROMPT_VERSION, buildSystemPrompt, extractionJsonSchema } from "./extract.v2.js";

// Pinned like v1: once rows are stored as extract.v2, a wording change is a new version.
const RULE_6 = `6. Risk clauses: report only clauses that create material cost, legal or operational risk for Nexus Corp as the customer. Severity rubric:
   high: uncapped or open-ended financial exposure, or loss of important rights (IP, termination, data);
   medium: unfavorable but bounded terms;
   low: worth noting, minor impact.
   Every risk clause needs an exact quote. Standard boilerplate and standard mutual clauses are not risks. Use category "other" only when no other category fits.`;

const GUIDE_LINES = [
  "governing_law: Jurisdiction whose law governs the agreement, by name as the contract writes it, without 'the laws of' or 'State of': 'New York', 'England and Wales'. Never a code or abbreviation",
  "termination_notice_days: Days of notice required to end the agreement as a whole or stop it from renewing. Never a cure or remedy period, and not a termination for convenience right that only one party has",
  "risk_clauses[].category: ip_assignment: IP in work Nexus Corp pays for ends up with the vendor, by assignment or because the vendor keeps it. uncapped_liability: a carve-out that leaves Nexus Corp's liability unlimited (not the standard mutual ones for death, injury or fraud). termination_for_convenience_vendor_only: only the vendor may end the agreement without cause. foreign_governing_law: law of a country outside the United States. one of: auto_renewal, uncapped_liability, broad_indemnification, unilateral_price_increase, termination_for_convenience_vendor_only, exclusivity, ip_assignment, data_protection_gap, penalties_liquidated_damages, unfavorable_payment_terms, foreign_governing_law, other",
];

// Rules start a line with "N. ", and rule 6 has indented lines under it.
function rules(prompt: string): Map<string, string> {
  const map = new Map<string, string>();
  let key = "intro";
  for (const line of prompt.split("\n")) {
    const number = /^(\d+)\. /.exec(line)?.[1];
    if (number !== undefined) key = number;
    map.set(key, map.has(key) ? `${map.get(key) ?? ""}\n${line}` : line);
  }
  return map;
}

function withoutDescriptions(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutDescriptions);
  if (node === null || typeof node !== "object") return node;
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key, value]) => !(key === "description" && typeof value === "string"))
      .map(([key, value]) => [key, withoutDescriptions(value)]),
  );
}

describe("extract.v2 system prompt", () => {
  it("is v1 with a different rule 6 and nothing else", () => {
    const a = rules(v1.buildSystemPrompt());
    const b = rules(buildSystemPrompt());

    expect([...b.keys()]).toEqual([...a.keys()]);
    const changed = [...b.keys()].filter((key) => a.get(key) !== b.get(key));
    expect(changed).toEqual(["6"]);
    expect(b.get("6")).toBe(RULE_6);
  });

  it("has no leading or trailing whitespace and no carriage returns", () => {
    const prompt = buildSystemPrompt();

    expect(prompt).toBe(prompt.trim());
    expect(prompt).not.toContain("\r");
  });

  it("has its own version and comes out of the registry", () => {
    expect(PROMPT_VERSION).toBe("extract.v2");
    expect(extractPrompt("extract.v2")).toEqual({
      version: "extract.v2",
      system: buildSystemPrompt(),
      schema: extractionJsonSchema(),
    });
    expect(extractPrompt("extract.v1")).toEqual({
      version: "extract.v1",
      system: v1.buildSystemPrompt(),
      schema: llmExtractionJsonSchema(),
    });
  });
});

describe("extract.v2 schema", () => {
  it("changes three descriptions and nothing about the structure", () => {
    const base = llmExtractionJsonSchema();
    const schema = extractionJsonSchema();

    expect(withoutDescriptions(schema)).toEqual(withoutDescriptions(base));
    const before = buildFieldGuide(base).split("\n");
    const after = buildFieldGuide(schema).split("\n");
    expect(after).toHaveLength(before.length);
    expect(after.filter((line) => !before.includes(line))).toEqual(GUIDE_LINES);
  });

  it("leaves the schema v1 sends untouched", () => {
    const before = JSON.stringify(llmExtractionJsonSchema());

    extractionJsonSchema();

    expect(JSON.stringify(llmExtractionJsonSchema())).toBe(before);
    expect(JSON.stringify(llmExtractionJsonSchema())).not.toContain("Never a code");
  });

  it("is still a schema the zod validation of the reply agrees with", () => {
    const schema = extractionJsonSchema() as { required: string[] };

    expect([...schema.required].sort()).toEqual(Object.keys(LlmExtractionSchema.shape).sort());
  });
});

describe("extract.v2 size", () => {
  // The 7b reads the system prompt and the field guide out of the same num_ctx as the document.
  const full = (version: "extract.v1" | "extract.v2") =>
    ollamaSystemPrompt(extractPrompt(version)).length;

  it("stays within 20% of v1, as the system prompt and as what ollama gets", () => {
    expect(v1.buildSystemPrompt().length).toBe(2094);
    expect(buildSystemPrompt().length).toBe(2195);
    expect(buildSystemPrompt().length / v1.buildSystemPrompt().length).toBeLessThan(1.2);
    expect(full("extract.v1")).toBe(3948);
    expect(full("extract.v2")).toBeLessThan(full("extract.v1") * 1.2);
  });

  it("fits the same num_ctx floor as v1, so switching versions doesn't cost gpu memory", () => {
    for (const chars of [12000, 24000]) {
      expect(ollamaContextFloor(chars, "extract.v2")).toBe(ollamaContextFloor(chars, "extract.v1"));
    }
    expect(ollamaContextFloor(12000, "extract.v2")).toBe(10240);
  });
});
