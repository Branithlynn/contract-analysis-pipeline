import type {
  Confidence,
  ExtractedFieldName,
  ExtractionResult,
  LlmExtraction,
} from "@nexus/shared";
import { format, isValid, parseISO } from "date-fns";

// The strict stored shape before grounding adds quote_verified / quote_page. Derived from
// ExtractionResult instead of a second schema, so the two can't drift apart.
type Unverified<T> = Omit<T, "quote_verified" | "quote_page">;

export type NormalizedExtraction = {
  [K in ExtractedFieldName]: Unverified<ExtractionResult[K]>;
} & {
  risk_clauses: Unverified<ExtractionResult["risk_clauses"][number]>[];
  summary: string;
};

export interface NormalizeResult {
  data: NormalizedExtraction;
  warnings: string[];
}

type Check<In, Out> = (value: In) => { value: Out } | { reason: string };

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;
const MAX_MONTHS = 1200;
const MAX_DAYS = 3650;

// Models write "not found" as text instead of null. That is a missing value, not a bad one, so it
// becomes null without a warning.
const NOT_FOUND_WORDS = new Set(["null", "none", "n/a", "not stated", "not specified"]);

// Trimmed, and blank becomes null. One pair of wrapping braces goes because qwen sometimes returns
// values like "{12 months before the claim}", copying the braces from the schema's object syntax.
function cleanText(value: string): string | null {
  let text = value.trim();
  if (text.startsWith("{") && text.endsWith("}")) text = text.slice(1, -1).trim();
  return text === "" || NOT_FOUND_WORDS.has(text.toLowerCase()) ? null : text;
}

// Models write both "" and the string "null" for a missing quote.
function cleanQuote(quote: string): string | null {
  const text = quote.trim();
  return text === "" || text.toLowerCase() === "null" ? null : text;
}

const text: Check<string, string | null> = (value) => ({ value: cleanText(value) });

// Both models answered with codes ("USA", "LUX", "DE" for Delaware, which reads as Germany), and
// the 7b once put "2023-01-01" here with the governing law sentence as its quote. No jurisdiction
// has a name of two or three letters, so a value that short is a code. So is a subdivision code:
// two or three letters, a dash, one to three letters or digits ("US-NY", "GB-ENG", "USA-NY"). A
// code can't be shown to a reviewer as the governing law, and a wrong reading of it is worse than
// an empty field.
const JURISDICTION_CODE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,3})?$/;

const jurisdiction: Check<string, string | null> = (value) => {
  const cleaned = cleanText(value);
  if (cleaned === null) return { value: null };
  if (DATE_SHAPE.test(cleaned)) return { reason: "a date, not a jurisdiction" };
  if (JURISDICTION_CODE.test(cleaned)) return { reason: "a code, not the name of a jurisdiction" };
  return { value: cleaned };
};

const isoDate: Check<string, string | null> = (value) => {
  const cleaned = cleanText(value);
  if (cleaned === null) return { value: null };
  if (!DATE_SHAPE.test(cleaned)) return { reason: "not YYYY-MM-DD" };
  // The round trip catches dates in the right shape that don't exist, like 2026-02-30.
  const parsed = parseISO(cleaned);
  if (!isValid(parsed) || format(parsed, "yyyy-MM-dd") !== cleaned) {
    return { reason: "not a real date" };
  }
  return { value: cleaned };
};

function count(max: number): Check<number, number> {
  return (value) =>
    Number.isInteger(value) && value >= 0 && value <= max
      ? { value }
      : { reason: `not a whole number in 0..${String(max)}` };
}

type Money = NonNullable<LlmExtraction["total_contract_value"]["value"]>;

const money: Check<Money, Money> = ({ amount, currency }) => {
  const code = currency.trim().toUpperCase();
  if (!CURRENCY.test(code)) return { reason: "currency is not a 3-letter code" };
  if (!Number.isFinite(amount) || amount < 0) {
    return { reason: "amount is not a finite number >= 0" };
  }
  return { value: { amount, currency: code } };
};

const same = <T>(value: T): { value: T } => ({ value });

interface LooseField<T> {
  value: T | null;
  quote: string;
  confidence: Confidence;
}

interface StrictField<T> {
  value: T | null;
  quote: string | null;
  confidence: Confidence;
}

export function normalizeExtraction(input: LlmExtraction): NormalizeResult {
  const warnings: string[] = [];

  // Nothing bad is saved quietly: a value that fails its check is dropped, and the warning shows
  // what the model actually sent.
  function field<In, Out>(
    name: ExtractedFieldName,
    loose: LooseField<In>,
    check: Check<In, Out | null>,
  ): StrictField<Out> {
    let value: Out | null = null;
    if (loose.value !== null) {
      const result = check(loose.value);
      if ("reason" in result) {
        warnings.push(`${name}: dropped ${JSON.stringify(loose.value)} (${result.reason})`);
      } else {
        value = result.value;
      }
    }
    // Models fill a quote on fields they couldn't find (seen with qwen). Without a value that quote
    // supports nothing, so it must not count toward grounding.
    if (value === null) return { value: null, quote: null, confidence: "low" };
    return { value, quote: cleanQuote(loose.quote), confidence: loose.confidence };
  }

  const data: NormalizedExtraction = {
    document_type: field("document_type", input.document_type, same),
    vendor_name: field("vendor_name", input.vendor_name, text),
    customer_name: field("customer_name", input.customer_name, text),
    payment_terms: field("payment_terms", input.payment_terms, text),
    governing_law: field("governing_law", input.governing_law, jurisdiction),
    liability_cap: field("liability_cap", input.liability_cap, text),
    effective_date: field("effective_date", input.effective_date, isoDate),
    expiration_date: field("expiration_date", input.expiration_date, isoDate),
    initial_term_months: field("initial_term_months", input.initial_term_months, count(MAX_MONTHS)),
    renewal_term_months: field("renewal_term_months", input.renewal_term_months, count(MAX_MONTHS)),
    termination_notice_days: field(
      "termination_notice_days",
      input.termination_notice_days,
      count(MAX_DAYS),
    ),
    auto_renewal: field("auto_renewal", input.auto_renewal, same),
    total_contract_value: field("total_contract_value", input.total_contract_value, money),
    risk_clauses: [],
    summary: input.summary.trim(),
  };

  // A risk without a quote can't be checked against the document, so it isn't shown as a finding.
  for (const clause of input.risk_clauses) {
    const quote = cleanQuote(clause.quote);
    if (quote === null) {
      warnings.push(
        `risk_clauses: dropped ${JSON.stringify(clause.title.trim())} (quote was ${JSON.stringify(clause.quote)})`,
      );
      continue;
    }
    data.risk_clauses.push({
      category: clause.category,
      severity: clause.severity,
      title: clause.title.trim(),
      explanation: clause.explanation.trim(),
      quote,
    });
  }

  return { data, warnings };
}
