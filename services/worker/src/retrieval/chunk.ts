import { splitPages } from "../extraction/grounding.js";

// Chunks for the search index. Not the extraction chunks: those are as large as the model's
// context allows (LLM_MAX_INPUT_CHARS), these are small so one embedding is about one thing and a
// hit points at a passage instead of four pages.

export interface RetrievalChunk {
  index: number;
  // The page the chunk's own text starts on. Null for docx, which has no fixed pages.
  page: number | null;
  // Document text only, without [[page N]] markers.
  text: string;
}

export const RETRIEVAL_CHUNK_CHARS = 1200;
// Repeated from the end of the previous chunk, so a sentence that needs the one before it is
// still found together with it.
export const RETRIEVAL_OVERLAP_CHARS = 200;

// A sentence, or a piece of one that was too long for a chunk.
interface Unit {
  text: string;
  // The whitespace the document had in front of it, put back when units are joined.
  lead: string;
  page: number | null;
}

const PARAGRAPH_BREAK = "\n\n";
// The same idea of a sentence end as the injection detector: ". " and the like. An abbreviation
// ("Ltd. ") ends a unit early, which costs nothing, the units are joined again in the same order.
const SENTENCE_END = /[.!?]["')\]]?\s+/g;

// Cuts at the last space that keeps the piece within the limit. A hard cut only when there is no
// space in the second half, e.g. a long run of table cells without any.
function splitOversized(text: string, limit: number): { text: string; lead: string }[] {
  const pieces: { text: string; lead: string }[] = [];
  let rest = text;
  let lead = "";
  while (rest.length > limit) {
    const space = rest.lastIndexOf(" ", limit);
    const cut = space > limit / 2 ? space : limit;
    pieces.push({ text: rest.slice(0, cut), lead });
    lead = cut === space ? " " : "";
    rest = rest.slice(cut === space ? cut + 1 : cut);
  }
  if (rest.length > 0) pieces.push({ text: rest, lead });
  return pieces;
}

function sentences(paragraph: string): { text: string; lead: string }[] {
  const out: { text: string; lead: string }[] = [];
  let start = 0;
  let lead = PARAGRAPH_BREAK;
  for (const m of paragraph.matchAll(SENTENCE_END)) {
    const end = m.index + m[0].trimEnd().length;
    out.push({ text: paragraph.slice(start, end), lead });
    lead = m[0].slice(m[0].trimEnd().length);
    start = m.index + m[0].length;
  }
  if (start < paragraph.length) out.push({ text: paragraph.slice(start), lead });
  return out;
}

function toUnits(fullText: string, limit: number): Unit[] {
  const units: Unit[] = [];
  for (const { page, text } of splitPages(fullText)) {
    for (const raw of text.split(/\n{2,}/)) {
      const paragraph = raw.trim();
      if (paragraph === "") continue;
      for (const sentence of sentences(paragraph)) {
        splitOversized(sentence.text, limit).forEach((piece, i) => {
          units.push({ text: piece.text, lead: i === 0 ? sentence.lead : piece.lead, page });
        });
      }
    }
  }
  return units;
}

function length(units: readonly Unit[]): number {
  return units.reduce((sum, u, i) => sum + u.text.length + (i > 0 ? u.lead.length : 0), 0);
}

function render(units: readonly Unit[]): string {
  return units.map((u, i) => (i > 0 ? u.lead : "") + u.text).join("");
}

// What the next chunk repeats: the last whole sentences that fit the overlap. When even the last
// sentence is longer, its tail from a word start, so there is always some shared text.
function overlapOf(units: readonly Unit[], overlapChars: number): Unit[] {
  const carry: Unit[] = [];
  for (let i = units.length - 1; i >= 0; i--) {
    const unit = units[i];
    if (unit === undefined || length([unit, ...carry]) > overlapChars) break;
    carry.unshift(unit);
  }
  if (carry.length > 0) return carry;

  const last = units.at(-1);
  if (last === undefined) return [];
  const tail = last.text.slice(-overlapChars);
  const space = tail.indexOf(" ");
  return [{ text: space >= 0 ? tail.slice(space + 1) : tail, lead: "", page: last.page }];
}

export function chunkForRetrieval(
  fullText: string,
  maxChars: number = RETRIEVAL_CHUNK_CHARS,
  overlapChars: number = RETRIEVAL_OVERLAP_CHARS,
): RetrievalChunk[] {
  if (!Number.isInteger(maxChars) || maxChars < 1) {
    throw new RangeError(`maxChars must be a positive integer, got ${String(maxChars)}`);
  }
  if (overlapChars < 0 || overlapChars >= maxChars) {
    throw new RangeError(
      `overlapChars must be between 0 and maxChars, got ${String(overlapChars)}`,
    );
  }

  const chunks: RetrievalChunk[] = [];
  let current: Unit[] = [];
  // How many units at the start of current are repeated from the previous chunk.
  let overlap = 0;

  const emit = (): void => {
    const page = (current[overlap] ?? current[0])?.page ?? null;
    chunks.push({ index: chunks.length, page, text: render(current) });
  };

  for (const unit of toUnits(fullText, maxChars)) {
    for (;;) {
      if (length([...current, unit]) <= maxChars) {
        current.push(unit);
        break;
      }
      if (current.length === overlap) {
        // Only the overlap is in the way, dropping it is the only way the unit fits.
        current = [unit];
        overlap = 0;
        break;
      }
      emit();
      current = overlapChars > 0 ? overlapOf(current, overlapChars) : [];
      overlap = current.length;
    }
  }
  if (current.length > overlap) emit();
  return chunks;
}
