import { describe, expect, it } from "vitest";
import { ollamaContextFloor } from "../factory.js";
import { ollamaSystemPrompt } from "../ollama.js";
import { extractPrompt } from "./extract.js";
import * as v1 from "./extract.v1.js";
import * as v2 from "./extract.v2.js";
import { PROMPT_VERSION, buildSystemPrompt, extractionJsonSchema } from "./extract.v3.js";

const OTHER_SENTENCE = ' Use category "other" only when no other category fits.';

describe("extract.v3", () => {
  it("is v1's system prompt plus the sentence about the category other, and nothing else", () => {
    const anchor = "Do not report standard mutual clauses as risks.";
    const expected = v1.buildSystemPrompt().replace(anchor, `${anchor}${OTHER_SENTENCE}`);

    expect(expected).not.toBe(v1.buildSystemPrompt());
    expect(buildSystemPrompt()).toBe(expected);
  });

  it("has none of v2's wording on what counts as a risk, and shares v2's other sentence", () => {
    const prompt = buildSystemPrompt();

    expect(prompt).toContain(
      "6. Risk clauses: report clauses that create cost, legal or operational risk for Nexus Corp. Severity rubric:",
    );
    expect(prompt).not.toContain("material");
    expect(prompt).not.toContain("only clauses");
    expect(prompt).not.toContain("boilerplate");
    expect(v2.buildSystemPrompt()).toContain(OTHER_SENTENCE.trim());
  });

  it("sends exactly v2's schema, so only rule 6 separates the two versions", () => {
    expect(extractionJsonSchema()).toEqual(v2.extractionJsonSchema());
    expect(JSON.stringify(extractionJsonSchema())).toContain("Never a code or abbreviation");
  });

  it("has its own version and comes out of the registry", () => {
    expect(PROMPT_VERSION).toBe("extract.v3");
    expect(extractPrompt("extract.v3")).toEqual({
      version: "extract.v3",
      system: buildSystemPrompt(),
      schema: extractionJsonSchema(),
    });
  });

  it("is shorter than v2 and fits the same num_ctx floor as v1", () => {
    const full = (version: "extract.v1" | "extract.v2" | "extract.v3") =>
      ollamaSystemPrompt(extractPrompt(version)).length;

    expect(buildSystemPrompt().length).toBe(v1.buildSystemPrompt().length + OTHER_SENTENCE.length);
    expect(full("extract.v3")).toBeLessThan(full("extract.v2"));
    expect(full("extract.v3")).toBeLessThan(full("extract.v1") * 1.2);
    for (const chars of [12000, 24000]) {
      expect(ollamaContextFloor(chars, "extract.v3")).toBe(ollamaContextFloor(chars, "extract.v1"));
    }
    expect(ollamaContextFloor(12000, "extract.v3")).toBe(10240);
  });
});
