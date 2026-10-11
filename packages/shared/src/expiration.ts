// Whether an extracted expiration date was really stated in the document. Pure and browser safe.
// deriveDates and the worker both ask this one function, so the review stored with the extraction
// and the alerts rebuilt on every read can't come to different answers.
//
// The prompt tells the model to leave the date null when the contract only gives a term. The 7b
// fills it anyway: for "continues for 24 months from the Effective Date and then expires" it
// returned 2028-09-10, one day late, with that sentence as the quote. The quote is real text, so it
// verifies. What gives it away is that the date is nowhere in it.

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

// 1 to 12 for a month name or an abbreviation of at least three letters ("Aug", "Sept"), else null.
function monthNumber(word: string): number | null {
  const lower = word.toLowerCase();
  if (lower.length < 3) return null;
  const index = MONTHS.findIndex((month) => month.startsWith(lower));
  return index < 0 ? null : index + 1;
}

const ORDINAL = "(?:st|nd|rd|th)?";
// 2026-08-31
const ISO = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
// 31 August 2026, 31st Aug. 2026, 31st day of August, 2026
const DAY_MONTH_YEAR = new RegExp(
  String.raw`\b(\d{1,2})${ORDINAL}(?:\s+day)?(?:\s+of)?\s+([a-z]{3,9})\.?,?\s+(\d{4})\b`,
  "gi",
);
// August 31, 2026 and Aug. 31st 2026
const MONTH_DAY_YEAR = new RegExp(
  String.raw`\b([a-z]{3,9})\.?\s+(\d{1,2})${ORDINAL},?\s+(\d{4})\b`,
  "gi",
);
// 31/08/2026, 31.08.2026, 31-08-2026, and the US order 08/31/2026
const NUMERIC = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g;

// True when `text` writes out the calendar date `iso` (YYYY-MM-DD) in one of the forms above.
// A numeric date counts in either day/month order: the question is whether this date is in the
// text, and 09/10/2028 can be read as either.
export function dateAppearsIn(iso: string, text: string): boolean {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!parts) return false;
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const same = (y: string | undefined, m: number | null, d: string | undefined) =>
    Number(y) === year && m === month && Number(d) === day;

  for (const m of text.matchAll(ISO)) {
    if (same(m[1], Number(m[2]), m[3])) return true;
  }
  for (const m of text.matchAll(DAY_MONTH_YEAR)) {
    if (same(m[3], monthNumber(m[2] ?? ""), m[1])) return true;
  }
  for (const m of text.matchAll(MONTH_DAY_YEAR)) {
    if (same(m[3], monthNumber(m[1] ?? ""), m[2])) return true;
  }
  for (const m of text.matchAll(NUMERIC)) {
    if (same(m[3], Number(m[2]), m[1]) || same(m[3], Number(m[1]), m[2])) return true;
  }
  return false;
}

export interface ExpirationField {
  value: string | null;
  quote: string | null;
  quote_verified: boolean;
}

// none: no date was extracted.
// stated: the quote was found in the document and has the date in it.
// model_computed: the quote was found but has no such date, so the model did the arithmetic.
// unverified: the quote was not found, whatever it says. The date may be made up.
export type ExpirationBasis = "none" | "stated" | "model_computed" | "unverified";

export function expirationBasis(field: ExpirationField): ExpirationBasis {
  if (field.value === null) return "none";
  if (!field.quote_verified || field.quote === null) return "unverified";
  return dateAppearsIn(field.value, field.quote) ? "stated" : "model_computed";
}
