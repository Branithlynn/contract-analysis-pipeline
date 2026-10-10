import { z } from "zod";

export const Confidence = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof Confidence>;

export const Severity = z.enum(["low", "medium", "high"]);
export type Severity = z.infer<typeof Severity>;

export const DocumentType = z.enum([
  "contract",
  "proposal",
  "amendment",
  "nda",
  "sow",
  "order_form",
  "other",
]);
export type DocumentType = z.infer<typeof DocumentType>;

export const RiskCategory = z.enum([
  "auto_renewal",
  "uncapped_liability",
  "broad_indemnification",
  "unilateral_price_increase",
  "termination_for_convenience_vendor_only",
  "exclusivity",
  "ip_assignment",
  "data_protection_gap",
  "penalties_liquidated_damages",
  "unfavorable_payment_terms",
  "foreign_governing_law",
  "other",
]);
export type RiskCategory = z.infer<typeof RiskCategory>;

// This schema is turned into JSON Schema for constrained decoding, so it stays loose on purpose:
// no regex, no min/max, no z.iso.*. Formats live in .describe() and strict checks happen in code afterwards.

const Money = z.object({
  amount: z.number(),
  currency: z.string().describe("ISO 4217 currency code, e.g. USD, EUR"),
});

// The quote is what lets us check each value against the document text later. It is "" rather than
// null when nothing was found: a nullable quote on every field doubles the union types (anyOf /
// [x, "null"]), and a small schema keeps constrained decoding fast and inside the limits of openai
// strict mode and ollama's grammar. It also gives every provider the same quote shape. Normalize turns
// "" back into null. History: anthropic structured outputs rejected this schema with "compiled grammar
// is too large", so anthropic now gets the schema as a hint in the system prompt instead.
function field<T extends z.ZodType>(value: T, description: string) {
  return z
    .object({
      value: value.nullable(),
      quote: z
        .string()
        .describe(
          "Exact text copied from the document that supports the value, or an empty string if not found",
        ),
      confidence: Confidence,
    })
    .describe(description);
}

const RiskClause = z.object({
  category: RiskCategory,
  severity: Severity,
  title: z.string(),
  explanation: z
    .string()
    .describe(
      "One sentence in your own words on why this clause matters to Nexus Corp. Do not repeat the quote.",
    ),
  quote: z.string().describe("Exact text copied from the document"),
});

// No notice deadline or renewal date here: the model extracts facts, code does the date math.
export const LlmExtractionSchema = z.object({
  document_type: field(DocumentType, "Kind of document"),
  vendor_name: field(z.string(), "Party providing the goods or services"),
  customer_name: field(z.string(), "Party buying the goods or services"),
  payment_terms: field(z.string(), "Payment terms, e.g. net 30"),
  governing_law: field(z.string(), "Jurisdiction whose law governs the agreement"),
  liability_cap: field(
    z.string(),
    "Limit on liability in the document's own words, for example 'fees paid in the 12 months before the claim' or 'USD 50,000'. Do not calculate it.",
  ),
  effective_date: field(
    z.string(),
    "Date the agreement starts or takes effect, formatted YYYY-MM-DD. A separate signing date is not the effective date",
  ),
  expiration_date: field(z.string(), "Date the initial term ends, formatted YYYY-MM-DD"),
  initial_term_months: field(z.number(), "Length of the initial term in months"),
  renewal_term_months: field(z.number(), "Length of each renewal term in months"),
  // The renewal deadline is computed from this, so a cure period here moves the deadline.
  termination_notice_days: field(
    z.number(),
    "Days of notice required to terminate the agreement or stop it from renewing. Never a cure or remedy period",
  ),
  auto_renewal: field(z.boolean(), "Whether the agreement renews automatically"),
  total_contract_value: field(Money, "Total value of the agreement"),
  risk_clauses: z.array(RiskClause),
  summary: z.string().describe("Plain summary of the document, max 80 words"),
});
export type LlmExtraction = z.infer<typeof LlmExtractionSchema>;

export function llmExtractionJsonSchema(): Record<string, unknown> {
  const schema: Record<string, unknown> = { ...z.toJSONSchema(LlmExtractionSchema) };
  // Some providers reject the top level $schema key.
  delete schema.$schema;
  return schema;
}

// Stored shape. Strict, since it is only ever validated in code and never sent to a provider.

const IsoDate = z.iso.date();
const NonNegInt = z.int().nonnegative();

export const StrictMoney = z.strictObject({
  amount: z.number().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

const Verification = {
  quote_verified: z.boolean(),
  // Pages are 1-based, null when the quote was not found or the format has no pages (docx).
  quote_page: z.int().min(1).nullable(),
};

function verifiedField<T extends z.ZodType>(value: T) {
  return z.strictObject({
    value: value.nullable(),
    quote: z.string().nullable(),
    confidence: Confidence,
    ...Verification,
  });
}

const VerifiedRiskClause = z.strictObject({
  category: RiskCategory,
  severity: Severity,
  title: z.string(),
  explanation: z.string(),
  quote: z.string(),
  ...Verification,
});

export const AlertLevel = z.enum(["info", "warning", "critical"]);
export type AlertLevel = z.infer<typeof AlertLevel>;

export const ExpirationSource = z.enum(["stated", "computed"]);
export type ExpirationSource = z.infer<typeof ExpirationSource>;

const Derived = z.strictObject({
  expiration_date: IsoDate.nullable(),
  expiration_source: ExpirationSource.nullable(),
  current_term_end: IsoDate.nullable(),
  next_renewal_date: IsoDate.nullable(),
  notice_deadline: IsoDate.nullable(),
  // Negative once the deadline has passed.
  days_until_notice_deadline: z.int().nullable(),
  alerts: z.array(z.strictObject({ level: AlertLevel, message: z.string() })),
});

export const ExtractedFieldName = LlmExtractionSchema.keyof().exclude(["risk_clauses", "summary"]);
export type ExtractedFieldName = z.infer<typeof ExtractedFieldName>;

// Conflicting candidates are kept as the model returned them, so they use the loose value types.
const Conflict = z.strictObject({
  field: ExtractedFieldName,
  values: z.array(
    z.strictObject({
      value: z.union([z.string(), z.number(), z.boolean(), Money]),
      chunk_index: NonNegInt,
      quote: z.string().nullable(),
    }),
  ),
});

export const ExtractionResultSchema = z.strictObject({
  document_type: verifiedField(DocumentType),
  vendor_name: verifiedField(z.string()),
  customer_name: verifiedField(z.string()),
  payment_terms: verifiedField(z.string()),
  governing_law: verifiedField(z.string()),
  liability_cap: verifiedField(z.string()),
  effective_date: verifiedField(IsoDate),
  expiration_date: verifiedField(IsoDate),
  initial_term_months: verifiedField(NonNegInt),
  renewal_term_months: verifiedField(NonNegInt),
  termination_notice_days: verifiedField(NonNegInt),
  auto_renewal: verifiedField(z.boolean()),
  total_contract_value: verifiedField(StrictMoney),
  risk_clauses: z.array(VerifiedRiskClause),
  summary: z.string(),
  derived: Derived,
  conflicts: z.array(Conflict),
  warnings: z.array(z.string()),
  grounding_score: z.number().min(0).max(1).nullable(),
});
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
