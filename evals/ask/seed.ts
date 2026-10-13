// The extraction the ask eval stores for a sample: built from the hand-written expectation of the
// extraction eval, not by a model. The ask eval measures the agent, so it gets a register that is
// right. With a model's extraction in between, a wrong answer could be either one's fault.
import {
  deriveDates,
  ExtractedFieldName,
  ExtractionResultSchema,
  type ExtractionResult,
  type SuspectedInjection,
} from "@nexus/shared";
import type { ExpectedCase } from "../score.js";

// The same fixed day as the extraction eval, the one the expected dates were worked out for.
export const ASK_CLOCK = "2026-10-09";

const WithoutDerived = ExtractionResultSchema.omit({ derived: true });

// any_of takes the first option. contains_all is a list of words an answer has to have, not a
// value, so such a field stays empty.
function valueOf(want: unknown): unknown {
  if (want === undefined) return null;
  if (typeof want !== "object" || want === null) return want;
  if ("any_of" in want && Array.isArray(want.any_of)) return valueOf(want.any_of[0]);
  if ("contains_all" in want) return null;
  return want;
}

// A field the expectation does not list is empty here, whatever the document says: liability_cap
// and customer_name are in none of them. Quotes and risk clause texts are not in the expectations
// either, so there are none.
// Throws when the dates computed from the values are not the ones the expectation gives.
export function extractionFromExpected(
  expected: ExpectedCase,
  injections: readonly SuspectedInjection[],
  today: string,
  groundingThreshold: number,
): ExtractionResult {
  const fields: Record<string, unknown> = Object.fromEntries(
    ExtractedFieldName.options.map((name) => {
      const value = valueOf(expected.fields[name]);
      return [
        name,
        {
          value,
          quote: null,
          confidence: value === null ? "low" : "high",
          // The values are the checked ones, and get_contract shows this flag to the model.
          quote_verified: value !== null,
          quote_page: null,
        },
      ];
    }),
  );
  // A contract with an end date instead of a term: the expectations have the date only as a
  // derived one. Stored as stated, with a quote that has the date in it, or deriveDates would
  // take it for the model's own arithmetic.
  const stated = expected.derived.expiration_date ?? null;
  if (expected.fields.initial_term_months === undefined && stated !== null) {
    fields.expiration_date = {
      value: stated,
      quote: stated,
      confidence: "high",
      quote_verified: true,
      quote_page: null,
    };
  }

  const base = WithoutDerived.parse({
    ...fields,
    risk_clauses: expected.risk_categories.map((category) => ({
      category,
      // Not in the expectations. No case asks about severity.
      severity: "medium",
      title: category.replaceAll("_", " "),
      explanation: "",
      quote: "",
      quote_verified: false,
      quote_page: null,
    })),
    summary: "",
    conflicts: [],
    warnings: [],
    grounding_score: null,
    suspected_injections: injections,
  });
  const derived = deriveDates(
    base,
    base.risk_clauses,
    base.grounding_score,
    groundingThreshold,
    base.suspected_injections,
    today,
  );

  for (const key of ["expiration_date", "notice_deadline"] as const) {
    const want = expected.derived[key];
    if (want !== undefined && derived[key] !== want) {
      throw new Error(
        `${expected.file}: ${key} from the expected values is ${String(derived[key])}, the expectation says ${String(want)}`,
      );
    }
  }
  return { ...base, derived };
}
