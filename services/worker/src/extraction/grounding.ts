import {
  ExtractedFieldName,
  verifyQuote,
  type Confidence,
  type ExtractionResult,
  type GroundingIndex,
} from "@nexus/shared";
import type { NormalizedExtraction } from "./normalize.js";

// The main defense against made up and injected values: a value only counts as verified when its
// quote is found in the real document text.

// The matching itself lives in shared, the api verifies the quotes of a chat answer with it.
export {
  buildGroundingIndex,
  normalizeForMatch,
  quoteSpans,
  splitPages,
  tokenize,
  verifyQuote,
  type GroundingIndex,
  type QuoteCheck,
  type Span,
  type Token,
} from "@nexus/shared";

// The normalized fields with quote_verified / quote_page filled, taken from the stored type.
export type GroundedExtraction = Pick<ExtractionResult, keyof NormalizedExtraction>;

interface UngroundedField {
  value: unknown;
  quote: string | null;
  confidence: Confidence;
}

const FIELD_NAMES = ExtractedFieldName.options;

// Every found value and every risk clause counts, quoted or not. Leaving out values without a quote
// would make a model that skips quotes look better grounded than one that quotes slightly wrong.
// Computed from the flags, so the merged result is scored the same way as a single chunk.
export function groundingScore(data: GroundedExtraction): number | null {
  const items = [
    ...FIELD_NAMES.map((name) => data[name]).filter((f) => f.value !== null),
    ...data.risk_clauses,
  ];
  if (items.length === 0) return null;
  return items.filter((i) => i.quote_verified).length / items.length;
}

export function groundExtraction(
  index: GroundingIndex,
  data: NormalizedExtraction,
): { data: GroundedExtraction; score: number | null } {
  function check(quote: string | null): { quote_verified: boolean; quote_page: number | null } {
    if (quote === null) return { quote_verified: false, quote_page: null };
    const result = verifyQuote(index, quote);
    return { quote_verified: result.verified, quote_page: result.page };
  }

  // A value whose quote isn't in the document may be made up or injected, so it keeps the value for
  // the reviewer but drops to low confidence.
  function ground<F extends UngroundedField>(field: F) {
    // A not-found field has nothing to verify and stays out of the score.
    if (field.value === null) return { ...field, quote_verified: false, quote_page: null };
    const flags = check(field.quote);
    const confidence: Confidence = flags.quote_verified ? field.confidence : "low";
    return { ...field, confidence, ...flags };
  }

  const grounded: GroundedExtraction = {
    document_type: ground(data.document_type),
    vendor_name: ground(data.vendor_name),
    customer_name: ground(data.customer_name),
    payment_terms: ground(data.payment_terms),
    governing_law: ground(data.governing_law),
    liability_cap: ground(data.liability_cap),
    effective_date: ground(data.effective_date),
    expiration_date: ground(data.expiration_date),
    initial_term_months: ground(data.initial_term_months),
    renewal_term_months: ground(data.renewal_term_months),
    termination_notice_days: ground(data.termination_notice_days),
    auto_renewal: ground(data.auto_renewal),
    total_contract_value: ground(data.total_contract_value),
    risk_clauses: data.risk_clauses.map((r) => ({ ...r, ...check(r.quote) })),
    summary: data.summary,
  };

  return { data: grounded, score: groundingScore(grounded) };
}
