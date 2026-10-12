// Scoring for the retrieval eval: is the expected passage among the chunks a search returned, and
// do a document's chunks cover its text. Pure, the runner in retrieval.ts does the io.
import { readFileSync } from "node:fs";
import { z } from "zod";

const QuestionSchema = z.strictObject({
  id: z.string().min(1),
  question: z.string().min(1),
  // File name of the document that holds the answer, one of the corpus files.
  document: z.string().min(1),
  // The page the quote is on. Null for docx, which has no fixed pages.
  page: z.int().positive().nullable(),
  // A phrase copied from that page. A returned chunk is the right one when it is from the
  // expected document and contains this phrase. The page alone would not do: one page holds
  // several chunks, and a chunk that starts at the bottom of the page before can hold the answer.
  quote: z.string().min(10),
});
export type RetrievalQuestion = z.infer<typeof QuestionSchema>;

export const RetrievalCasesSchema = z
  .strictObject({
    // Paths from the repo root. The documents the questions are asked over.
    corpus: z.array(z.string().min(1)).min(1),
    questions: z.array(QuestionSchema).min(1),
  })
  .superRefine((cases, ctx) => {
    const names = new Set(cases.corpus.map(fileName));
    const seen = new Set<string>();
    cases.questions.forEach((q, i) => {
      if (seen.has(q.id)) {
        ctx.addIssue({ code: "custom", path: ["questions", i, "id"], message: "duplicate id" });
      }
      seen.add(q.id);
      if (!names.has(q.document)) {
        ctx.addIssue({
          code: "custom",
          path: ["questions", i, "document"],
          message: `${q.document} is not in the corpus`,
        });
      }
    });
  });
export type RetrievalCases = z.infer<typeof RetrievalCasesSchema>;

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

// Throws with a message meant for the terminal.
export function readRetrievalCases(path: string): RetrievalCases {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(
      `${path} could not be read: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  const parsed = RetrievalCasesSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`${path} is not a valid retrieval eval:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

// A pdf breaks lines where a docx does not, so phrases are compared with whitespace collapsed.
function flat(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function containsQuote(text: string, quote: string): boolean {
  return flat(text).includes(flat(quote));
}

export interface ReturnedChunk {
  // File name, as the search returns it.
  document: string;
  page_start: number | null;
  page_end: number | null;
  text: string;
  score: number;
}

// 1 for the first result. Null when the expected passage is not among them.
export function rankOfExpected(
  question: Pick<RetrievalQuestion, "document" | "quote">,
  results: readonly ReturnedChunk[],
): number | null {
  const at = results.findIndex(
    (r) => r.document === question.document && containsQuote(r.text, question.quote),
  );
  return at < 0 ? null : at + 1;
}

export interface Ratio {
  correct: number;
  total: number;
}

export interface RetrievalMetrics {
  recallAt3: Ratio;
  recallAt5: Ratio;
  // Mean of 1/rank over all questions, 0 for a question whose passage was not returned.
  mrr: number;
}

export function retrievalMetrics(ranks: readonly (number | null)[]): RetrievalMetrics {
  const within = (k: number): Ratio => ({
    correct: ranks.filter((rank) => rank !== null && rank <= k).length,
    total: ranks.length,
  });
  const reciprocal = ranks.reduce<number>((sum, rank) => sum + (rank === null ? 0 : 1 / rank), 0);
  return {
    recallAt3: within(3),
    recallAt5: within(5),
    mrr: ranks.length === 0 ? 0 : reciprocal / ranks.length,
  };
}

export interface Coverage {
  // All counts are characters that are not whitespace: chunking is free to change line breaks
  // and spaces at the seams, it is not free to drop words.
  parsedChars: number;
  // Sum over the chunks, so text repeated as overlap counts twice here.
  chunkChars: number;
  // Characters of the document that are in at least one chunk.
  coveredChars: number;
  overlapChars: number;
  // Chunks whose text was not found in the document at all. Should be 0.
  unlocatedChunks: number;
  // The first stretch of the document no chunk covers, for looking it up. Null when all is covered.
  firstGap: string | null;
}

const PAGE_MARKER_LINE = /^\[\[page \d+\]\]$/gm;

function compact(text: string): string {
  return text.replace(PAGE_MARKER_LINE, "").replace(/\s+/g, "");
}

// Takes the parsed text (page markers and all) and the chunk texts in order. Each chunk is looked
// up in the document, the union of what they cover is compared with the whole.
export function chunkCoverage(parsedText: string, chunkTexts: readonly string[]): Coverage {
  const doc = compact(parsedText);
  const covered = new Uint8Array(doc.length);
  let chunkChars = 0;
  let locatedChars = 0;
  let unlocatedChunks = 0;
  let from = 0;

  for (const text of chunkTexts) {
    const chunk = compact(text);
    chunkChars += chunk.length;
    if (chunk === "") continue;
    // Chunks are in document order and each starts after the one before it started, so the
    // search begins there. That keeps a repeated clause from matching its first occurrence.
    let at = doc.indexOf(chunk, from);
    if (at < 0) at = doc.indexOf(chunk);
    if (at < 0) {
      unlocatedChunks++;
      continue;
    }
    covered.fill(1, at, at + chunk.length);
    locatedChars += chunk.length;
    from = at + 1;
  }

  let coveredChars = 0;
  let gapStart = -1;
  let gapEnd = -1;
  for (let i = 0; i < doc.length; i++) {
    if (covered[i] === 1) {
      coveredChars++;
      if (gapStart >= 0 && gapEnd < 0) gapEnd = i;
    } else if (gapStart < 0) gapStart = i;
  }
  if (gapStart >= 0 && gapEnd < 0) gapEnd = doc.length;
  return {
    parsedChars: doc.length,
    chunkChars,
    coveredChars,
    // Only chunks that were found: one that was not is reported above, not counted as overlap.
    overlapChars: locatedChars - coveredChars,
    unlocatedChunks,
    firstGap: gapStart < 0 ? null : doc.slice(gapStart, Math.min(gapEnd, gapStart + 80)),
  };
}
