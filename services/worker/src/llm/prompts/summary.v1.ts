import { z } from "zod";

// Only used for documents split into several chunks: each chunk's summary covers just its part, so
// a second call writes one summary from the merged data.
export const PROMPT_VERSION = "summary.v1";

export const SCHEMA_NAME = "contract_summary";

export const LlmSummarySchema = z.object({
  summary: z.string().describe("Plain summary of the contract, about 80 words"),
});
export type LlmSummary = z.infer<typeof LlmSummarySchema>;

export function summaryJsonSchema(): Record<string, unknown> {
  const schema: Record<string, unknown> = { ...z.toJSONSchema(LlmSummarySchema) };
  // Some providers reject the top level $schema key.
  delete schema.$schema;
  return schema;
}

const SYSTEM_PROMPT =
  "You write an 80-word plain summary of a vendor contract for a procurement analyst from the structured data provided. Mention vendor, scope if known, value, term and the most important risks. Do not add facts that are not in the data.";

export function buildSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

// Quotes and their verification flags only matter for grounding; here they would roughly double the
// input and tempt the model to summarize clause wording instead of the facts.
function withoutQuotes(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutQuotes);
  if (node !== null && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => !key.startsWith("quote"))
        .map(([key, value]) => [key, withoutQuotes(value)]),
    );
  }
  return node;
}

export function buildUserMessage(merged: unknown): string {
  return JSON.stringify(withoutQuotes(merged), null, 2);
}
