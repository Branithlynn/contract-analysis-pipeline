import { ExtractedFieldName, type Confidence, type ExtractionResult } from "@nexus/shared";
import type { NormalizedExtraction } from "./normalize.js";

// The main defense against made up and injected values: a value only counts as verified when its
// quote is found in the real document text.

// The normalized fields with quote_verified / quote_page filled, taken from the stored type.
export type GroundedExtraction = Pick<ExtractionResult, keyof NormalizedExtraction>;

export interface QuoteCheck {
  verified: boolean;
  method: "exact" | "fuzzy" | null;
  // 1-based page the match starts on, null for docx or when not verified.
  page: number | null;
  score: number;
}

export interface Token {
  value: string;
  start: number;
}

export interface GroundingIndex {
  // Normalized document text, pages joined with a space.
  text: string;
  // Start offset of each page in `text`, ascending. Empty for docx.
  pageStarts: { page: number; start: number }[];
  // `text` without whitespace, plus the offset in `text` of each of its chars.
  compact: string;
  compactToText: number[];
  tokens: Token[];
  // Token value -> its indexes in `tokens`, ascending.
  positions: Map<string, number[]>;
}

const PAGE_MARKER = /\[\[\s*page\s*(\d+)\s*\]\]/gi;
const ELLIPSIS = /\.{3,}/;
// Shorter ellipsis segments are ignored, the 3b ended a cut quote with "...3.".
const MIN_SEGMENT_CHARS = 8;
// Below this many chars a fuzzy match is too easy to hit by accident ("USD 50,000" vs "USD 50,001").
const MIN_FUZZY_CHARS = 12;
const FUZZY_PASS = 0.9;
const ANCHORS = 2;

const NOT_FOUND: QuoteCheck = { verified: false, method: null, page: null, score: 0 };

// Applied to the document and to every quote, so both sides compare in the same form. NFKC also
// turns "…" into "...".
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―⁃−﹘﹣－]/g, "-")
    .replace(PAGE_MARKER, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitPages(fullText: string): { page: number | null; text: string }[] {
  const markers = [...fullText.matchAll(PAGE_MARKER)];
  if (markers.length === 0) return [{ page: null, text: fullText }];
  const pages: { page: number | null; text: string }[] = [];
  const first = markers[0]?.index ?? 0;
  if (first > 0) pages.push({ page: null, text: fullText.slice(0, first) });
  markers.forEach((m, i) => {
    const start = m.index + m[0].length;
    const end = markers[i + 1]?.index ?? fullText.length;
    pages.push({ page: Number(m[1]), text: fullText.slice(start, end) });
  });
  return pages;
}

// Splits on anything that isn't a letter or digit in any script. \w would cut "Kündigung" into "k"
// and "ndigung". Merge uses this too, so both compare tokens the same way.
export function tokenize(text: string): Token[] {
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ value: m[0], start: m.index }));
}

export function buildGroundingIndex(fullText: string): GroundingIndex {
  let text = "";
  const pageStarts: { page: number; start: number }[] = [];
  for (const { page, text: raw } of splitPages(fullText)) {
    const normalized = normalizeForMatch(raw);
    if (normalized === "") continue;
    if (text !== "") text += " ";
    if (page !== null) pageStarts.push({ page, start: text.length });
    text += normalized;
  }

  let compact = "";
  const compactToText: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === " ") continue;
    compact += text[i];
    compactToText.push(i);
  }

  const tokens = tokenize(text);
  const positions = new Map<string, number[]>();
  tokens.forEach((t, i) => {
    const list = positions.get(t.value);
    if (list) list.push(i);
    else positions.set(t.value, [i]);
  });

  return { text, pageStarts, compact, compactToText, tokens, positions };
}

function pageAt(index: GroundingIndex, offset: number): number | null {
  let page: number | null = null;
  for (const p of index.pageStarts) {
    if (p.start > offset) break;
    page = p.page;
  }
  return page;
}

// First index in the sorted array whose value is >= target.
function lowerBound(sorted: readonly number[], target: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] ?? 0) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface Match {
  start: number;
  end: number;
  method: "exact" | "fuzzy";
  score: number;
}

// The whitespace-free retry catches spaces the model dropped or added at a pdf line break, e.g. qwen
// wrote "(the Customer).1. Services" where the pdf has a line break after the period.
function exactMatch(index: GroundingIndex, segment: string, from: number): Match | null {
  const at = index.text.indexOf(segment, from);
  if (at >= 0) return { start: at, end: at + segment.length, method: "exact", score: 1 };

  const needle = segment.replaceAll(" ", "");
  const compactAt = index.compact.indexOf(needle, lowerBound(index.compactToText, from));
  if (compactAt < 0) return null;
  const start = index.compactToText[compactAt] ?? 0;
  const end = (index.compactToText[compactAt + needle.length - 1] ?? start) + 1;
  return { start, end, method: "exact", score: 1 };
}

function overlap(window: readonly Token[], quote: readonly string[]): number {
  const counts = new Map<string, number>();
  for (const t of window) counts.set(t.value, (counts.get(t.value) ?? 0) + 1);
  let shared = 0;
  for (const q of quote) {
    const n = counts.get(q) ?? 0;
    if (n > 0) {
      shared++;
      counts.set(q, n - 1);
    }
  }
  return shared;
}

// Anchors on the quote's rarest tokens, so only a few candidate windows get scored instead of every
// position in the document. Each window is as long as the quote and lined up with the anchor.
function fuzzyMatch(
  index: GroundingIndex,
  segment: string,
  from: number,
): Match | { score: number } {
  const quote = tokenize(segment).map((t) => t.value);
  if (quote.length === 0) return { score: 0 };
  const anchors = [...new Set(quote)]
    .filter((t) => index.positions.has(t))
    .sort((a, b) => (index.positions.get(a)?.length ?? 0) - (index.positions.get(b)?.length ?? 0))
    .slice(0, ANCHORS);

  let best: { score: number; first: number; last: number } = { score: 0, first: -1, last: -1 };
  for (const anchor of anchors) {
    const q = quote.indexOf(anchor);
    for (const p of index.positions.get(anchor) ?? []) {
      const first = p - q;
      const last = first + quote.length - 1;
      const head = index.tokens[first];
      if (!head || head.start < from || last >= index.tokens.length) continue;
      const score = overlap(index.tokens.slice(first, last + 1), quote) / quote.length;
      if (score > best.score) best = { score, first, last };
    }
  }

  const head = index.tokens[best.first];
  const tail = index.tokens[best.last];
  if (best.score < FUZZY_PASS || !head || !tail) return { score: best.score };
  return {
    start: head.start,
    end: tail.start + tail.value.length,
    method: "fuzzy",
    score: best.score,
  };
}

export function verifyQuote(index: GroundingIndex, quote: string): QuoteCheck {
  // A quote the model shortened with "..." must match piece by piece, in order.
  const segments = normalizeForMatch(quote)
    .split(ELLIPSIS)
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_SEGMENT_CHARS);
  if (segments.length === 0) return NOT_FOUND;

  let from = 0;
  let start: number | null = null;
  let score = 1;
  let method: "exact" | "fuzzy" = "exact";
  for (const segment of segments) {
    let match: Match | { score: number } | null = exactMatch(index, segment, from);
    if (!match && segment.length >= MIN_FUZZY_CHARS) match = fuzzyMatch(index, segment, from);
    if (!match || !("start" in match)) return { ...NOT_FOUND, score: match?.score ?? 0 };
    start ??= match.start;
    from = match.end;
    score = Math.min(score, match.score);
    if (match.method === "fuzzy") method = "fuzzy";
  }
  return { verified: true, method, page: pageAt(index, start ?? 0), score };
}

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
