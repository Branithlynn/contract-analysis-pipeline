export interface Chunk {
  index: number;
  text: string;
}

interface Block {
  text: string;
  heading: boolean;
  // Page in effect where the block starts, from the last [[page N]] at or before it.
  page: number | undefined;
}

const HEADING_LINE =
  /^\s*(?:(?:ARTICLE|SECTION|CLAUSE|SCHEDULE|EXHIBIT|ANNEX|APPENDIX)\b|\d{1,2}(?:\.\d{1,2}){0,3}\.?\s+\S)/i;
const PAGE_MARKER_LINE = /^\[\[page (\d+)\]\]$/;
const PAGE_MARKERS = /^\[\[page (\d+)\]\]$/gm;
const SEPARATOR = "\n\n";
// A short trailing block is repeated at the start of the next chunk, so a clause that refers to
// the paragraph right before it still has that context. Longer ones would eat too much budget.
const MAX_OVERLAP_CHARS = 1500;

function isHeading(text: string): boolean {
  const [first = "", second = ""] = text.split("\n", 2);
  return HEADING_LINE.test(PAGE_MARKER_LINE.test(first) ? second : first);
}

function startsWithMarker(text: string): boolean {
  return PAGE_MARKER_LINE.test(text.split("\n", 1)[0] ?? "");
}

function markerFor(page: number): string {
  return `[[page ${String(page)}]]\n`;
}

// Cuts at the last ". " that keeps the piece within the limit, so the period stays on the piece
// and the next one starts on a new sentence. A hard cut only when there is no sentence end at all.
function splitOversized(text: string, limit: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const dot = rest.lastIndexOf(". ", limit - 1);
    if (dot > 0) {
      pieces.push(rest.slice(0, dot + 1));
      rest = rest.slice(dot + 2);
    } else {
      pieces.push(rest.slice(0, limit));
      rest = rest.slice(limit);
    }
  }
  if (rest.length > 0) pieces.push(rest);
  return pieces;
}

function toBlocks(text: string, budget: number): Block[] {
  const blocks: Block[] = [];
  let page: number | undefined;
  for (const raw of text.split(/\n{2,}/)) {
    if (raw.trim().length === 0) continue;
    const own = PAGE_MARKER_LINE.exec(raw.split("\n", 1)[0] ?? "");
    const startPage = own ? Number(own[1]) : page;
    splitOversized(raw, budget).forEach((piece, i) => {
      blocks.push({ text: piece, heading: i === 0 && isHeading(piece), page: startPage });
    });
    for (const m of raw.matchAll(PAGE_MARKERS)) page = Number(m[1]);
  }
  return blocks;
}

function length(blocks: readonly Block[]): number {
  return blocks.reduce((sum, b, i) => sum + b.text.length + (i > 0 ? SEPARATOR.length : 0), 0);
}

function render(blocks: readonly Block[]): string {
  const text = blocks.map((b) => b.text).join(SEPARATOR);
  const page = blocks[0]?.page;
  return page === undefined || startsWithMarker(text) ? text : markerFor(page) + text;
}

// Where to end the current chunk when the next block won't fit: at the last heading, so the
// heading and its clause body stay together, but only if that heading is past the middle. An early
// heading would leave a mostly empty chunk. Index 0 and overlap blocks never count, cutting there
// would emit nothing new.
function cutIndex(blocks: readonly Block[], overlap: number): number {
  const total = length(blocks);
  for (let i = blocks.length - 1; i > overlap; i--) {
    if (!blocks[i]?.heading) continue;
    const offset = length(blocks.slice(0, i)) + SEPARATOR.length;
    return offset > total / 2 ? i : blocks.length;
  }
  return blocks.length;
}

export function chunkText(text: string, maxChars: number): Chunk[] {
  if (text.length <= maxChars) return [{ index: 0, text }];

  // Room for the marker a chunk may get prepended, so no chunk ends up over maxChars.
  let maxPage = 0;
  for (const m of text.matchAll(PAGE_MARKERS)) maxPage = Math.max(maxPage, Number(m[1]));
  const budget = maxChars - (maxPage > 0 ? markerFor(maxPage).length : 0);
  if (budget < 1) throw new RangeError(`maxChars ${String(maxChars)} leaves no room for text`);

  const chunks: Block[][] = [];
  let current: Block[] = [];
  let overlap = 0;

  for (const block of toBlocks(text, budget)) {
    for (;;) {
      if (length([...current, block]) <= budget) {
        current.push(block);
        break;
      }
      if (current.length === overlap) {
        // Only the overlap is in the way, dropping it is the only way the block fits.
        current = [block];
        overlap = 0;
        break;
      }
      const cut = cutIndex(current, overlap);
      const emitted = current.slice(0, cut);
      chunks.push(emitted);
      const last = emitted.at(-1);
      const carry = last !== undefined && last.text.length <= MAX_OVERLAP_CHARS ? [last] : [];
      current = [...carry, ...current.slice(cut)];
      overlap = carry.length;
    }
  }
  if (current.length > overlap) chunks.push(current);

  return chunks.map((blocks, index) => ({ index, text: render(blocks) }));
}
