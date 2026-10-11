import type {
  Confidence,
  ExtractedFieldName,
  ExtractionResult,
  Severity,
  StrictMoney,
} from "@nexus/shared";
import type { z } from "zod";
import { normalizeForMatch, tokenize, type GroundedExtraction } from "./grounding.js";

// Merged in code, not with another llm call: the result is deterministic and every winning value
// has a rule behind it that can be explained.

export interface ChunkResult {
  chunkIndex: number;
  data: GroundedExtraction;
}

export type Conflict = ExtractionResult["conflicts"][number];

type Risk = GroundedExtraction["risk_clauses"][number];
type ScalarField = Exclude<ExtractedFieldName, "document_type">;
type Money = z.infer<typeof StrictMoney>;

const CONFIDENCE_RANK: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };
const SEVERITY_RANK: Record<Severity, number> = { high: 2, medium: 1, low: 0 };
// Same category and this much quote overlap means the same clause, usually reported twice because
// the overlap block between chunks went to both.
const DUPLICATE_JACCARD = 0.6;

interface Candidate<F> {
  chunkIndex: number;
  field: F;
}

function isMoney(value: unknown): value is Money {
  return typeof value === "object" && value !== null && "amount" in value && "currency" in value;
}

// Strings compare case and space insensitive, numbers and booleans exactly, money on both parts.
function sameKey(value: unknown): string {
  if (typeof value === "string") return `s:${value.toLowerCase().replace(/\s+/g, " ").trim()}`;
  if (isMoney(value)) return `m:${String(value.amount)} ${value.currency}`;
  return `${typeof value}:${String(value)}`;
}

function byStrength<F extends { quote_verified: boolean; confidence: Confidence }>(
  a: Candidate<F>,
  b: Candidate<F>,
): number {
  return (
    Number(b.field.quote_verified) - Number(a.field.quote_verified) ||
    CONFIDENCE_RANK[b.field.confidence] - CONFIDENCE_RANK[a.field.confidence] ||
    a.chunkIndex - b.chunkIndex
  );
}

function candidates<K extends ExtractedFieldName>(
  chunks: readonly ChunkResult[],
  name: K,
): Candidate<GroundedExtraction[K]>[] {
  return chunks
    .map((c) => ({ chunkIndex: c.chunkIndex, field: c.data[name] }))
    .filter((c) => c.field.value !== null);
}

// Each chunk only reports its own part, so a null from another chunk is "not in my part", never a
// vote against a value.
function mergeScalar<K extends ScalarField>(
  chunks: readonly ChunkResult[],
  first: GroundedExtraction,
  name: K,
  conflicts: Conflict[],
): GroundedExtraction[K] {
  const sorted = candidates(chunks, name).sort(byStrength);
  const winner = sorted[0];
  if (!winner) return first[name];

  // Only verified values can disagree: an unverified one may be made up, and it already lost.
  const distinct = new Map<string, Conflict["values"][number]>();
  for (const c of sorted) {
    if (!c.field.quote_verified || c.field.value === null) continue;
    const key = sameKey(c.field.value);
    if (!distinct.has(key)) {
      distinct.set(key, { value: c.field.value, chunk_index: c.chunkIndex, quote: c.field.quote });
    }
  }
  if (distinct.size > 1) conflicts.push({ field: name, values: [...distinct.values()] });
  return winner.field;
}

// A vote, since each chunk sees part of the same document: three chunks saying "contract" beat one
// saying "sow". On a tie the value seen first wins.
function mergeDocumentType(
  chunks: readonly ChunkResult[],
  first: GroundedExtraction,
): GroundedExtraction["document_type"] {
  const found = candidates(chunks, "document_type");
  const votes = new Map<string, { count: number; first: number }>();
  for (const c of found) {
    const key = c.field.value ?? "";
    const entry = votes.get(key);
    if (entry) entry.count++;
    else votes.set(key, { count: 1, first: c.chunkIndex });
  }
  const [winner] = [...votes].sort(([, a], [, b]) => b.count - a.count || a.first - b.first);
  const best = found.filter((c) => c.field.value === winner?.[0]).sort(byStrength)[0];
  return best?.field ?? first.document_type;
}

function quoteTokens(quote: string): Set<string> {
  return new Set(tokenize(normalizeForMatch(quote)).map((t) => t.value));
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

function strongerRisk(a: Risk, b: Risk): boolean {
  return (
    SEVERITY_RANK[a.severity] > SEVERITY_RANK[b.severity] ||
    (a.severity === b.severity && a.quote_verified && !b.quote_verified)
  );
}

// The duplicate keeps the position of the first one, so the list stays in document order.
function mergeRisks(chunks: readonly ChunkResult[]): Risk[] {
  const kept: { risk: Risk; tokens: Set<string> }[] = [];
  for (const risk of chunks.flatMap((c) => c.data.risk_clauses)) {
    const tokens = quoteTokens(risk.quote);
    const same = kept.find(
      (k) => k.risk.category === risk.category && jaccard(k.tokens, tokens) >= DUPLICATE_JACCARD,
    );
    if (!same) kept.push({ risk, tokens });
    else if (strongerRisk(risk, same.risk)) Object.assign(same, { risk, tokens });
  }
  return kept.map((k) => k.risk);
}

export function mergeExtractions(chunks: readonly ChunkResult[]): {
  data: GroundedExtraction;
  conflicts: Conflict[];
} {
  const sorted = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
  const first = sorted[0]?.data;
  if (!first) throw new Error("mergeExtractions needs at least one chunk");
  if (sorted.length === 1) return { data: first, conflicts: [] };

  const conflicts: Conflict[] = [];
  // All-null fields come from the first chunk, they are the same not-found shape everywhere.
  const scalar = <K extends ScalarField>(name: K) => mergeScalar(sorted, first, name, conflicts);

  const data: GroundedExtraction = {
    document_type: mergeDocumentType(sorted, first),
    vendor_name: scalar("vendor_name"),
    customer_name: scalar("customer_name"),
    payment_terms: scalar("payment_terms"),
    governing_law: scalar("governing_law"),
    liability_cap: scalar("liability_cap"),
    effective_date: scalar("effective_date"),
    expiration_date: scalar("expiration_date"),
    initial_term_months: scalar("initial_term_months"),
    renewal_term_months: scalar("renewal_term_months"),
    termination_notice_days: scalar("termination_notice_days"),
    auto_renewal: scalar("auto_renewal"),
    total_contract_value: scalar("total_contract_value"),
    risk_clauses: mergeRisks(sorted),
    // Each chunk's summary only covers its part; summarize writes the document's one.
    summary: "",
  };
  return { data, conflicts };
}
