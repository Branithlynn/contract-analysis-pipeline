import { z } from "zod";
import type { PageBreak } from "../chunk-pages.js";
import { PageBreakSchema } from "../schemas/api.js";
import type { Db } from "./client.js";
import type { DocumentRow } from "./repositories.js";

// The retrieval index: small chunks of document text with their embedding, and a full text index
// over the same chunks. Separate from the extractions, nothing here feeds the extracted fields.

export interface RetrievalChunkInput {
  chunk_index: number;
  // The pages the chunk's text is on. Both null for docx, which has no fixed pages.
  page_start: number | null;
  page_end: number | null;
  // Where a later page begins inside the text. Empty for a chunk on one page.
  page_breaks: readonly PageBreak[];
  text: string;
  // The injection detector matched this text. Stored so the index is complete, never searchable.
  injection_flagged: boolean;
  embedding: Float32Array;
}

export interface RetrievalChunkRow {
  id: number;
  document_id: string;
  chunk_index: number;
  page_start: number | null;
  page_end: number | null;
  // Json, see RetrievalChunkInput.page_breaks. Null on rows written before it was recorded.
  page_breaks: string | null;
  text: string;
  injection_flagged: number;
  embed_model: string;
  embed_dim: number;
  embedding: Buffer;
  created_at: string;
}

// sqlite-vec reads a blob as float32 values in the machine's byte order, which is little endian on
// everything this runs on. The view is copied, so a later change to the array can't reach the row.
function toBlob(vector: Float32Array): Buffer {
  return Buffer.from(new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength));
}

// Replaces whatever the document had: a retry or a backfill with another model must not leave
// chunks of the old run next to the new ones. One transaction, so a search never sees half a
// document. The full text index follows through the triggers on the table.
export function replaceRetrievalChunks(
  db: Db,
  documentId: string,
  embedModel: string,
  chunks: readonly RetrievalChunkInput[],
): void {
  const remove = db.prepare<[string]>("DELETE FROM retrieval_chunks WHERE document_id = ?");
  const insert = db.prepare<Record<string, unknown>>(
    `INSERT INTO retrieval_chunks
       (document_id, chunk_index, page_start, page_end, page_breaks, text, injection_flagged,
        embed_model, embed_dim, embedding, created_at)
     VALUES
       (@document_id, @chunk_index, @page_start, @page_end, @page_breaks, @text, @injection_flagged,
        @embed_model, @embed_dim, @embedding, @created_at)`,
  );
  const createdAt = new Date().toISOString();
  db.transaction(() => {
    remove.run(documentId);
    for (const chunk of chunks) {
      insert.run({
        document_id: documentId,
        chunk_index: chunk.chunk_index,
        page_start: chunk.page_start,
        page_end: chunk.page_end,
        page_breaks: JSON.stringify(chunk.page_breaks),
        text: chunk.text,
        injection_flagged: chunk.injection_flagged ? 1 : 0,
        embed_model: embedModel,
        embed_dim: chunk.embedding.length,
        embedding: toBlob(chunk.embedding),
        created_at: createdAt,
      });
    }
  })();
}

export function listRetrievalChunks(db: Db, documentId: string): RetrievalChunkRow[] {
  return db
    .prepare<[string], RetrievalChunkRow>(
      "SELECT * FROM retrieval_chunks WHERE document_id = ? ORDER BY chunk_index",
    )
    .all(documentId);
}

export interface ChunkHit {
  // The id a chat answer cites the chunk by. It changes when the document is indexed again.
  chunk_id: number;
  document_id: string;
  file_name: string;
  page_start: number | null;
  page_end: number | null;
  page_breaks: PageBreak[];
  text: string;
  // Higher is closer. What it measures depends on the search: cosine similarity for vector, the
  // negated bm25 for keyword, the fused rank score for hybrid. Not comparable between them.
  score: number;
}

// Json read from the db is a boundary too. Rows from before page breaks were recorded have null.
const StoredPageBreaks = z
  .string()
  .nullable()
  .transform((json, ctx): PageBreak[] => {
    if (json === null) return [];
    try {
      return z.array(PageBreakSchema).parse(JSON.parse(json));
    } catch {
      ctx.addIssue({ code: "custom", message: "page_breaks is not a list of page breaks" });
      return z.NEVER;
    }
  });

const HitRow = z.object({
  id: z.int(),
  document_id: z.string(),
  file_name: z.string(),
  page_start: z.int().nullable(),
  page_end: z.int().nullable(),
  page_breaks: StoredPageBreaks,
  text: z.string(),
  score: z.number(),
});
type RankedHit = z.infer<typeof HitRow>;

const HIT_COLUMNS = `c.id, c.document_id, d.original_name AS file_name,
              c.page_start, c.page_end, c.page_breaks, c.text`;

function toHit(row: RankedHit): ChunkHit {
  return {
    chunk_id: row.id,
    document_id: row.document_id,
    file_name: row.file_name,
    page_start: row.page_start,
    page_end: row.page_end,
    page_breaks: row.page_breaks,
    text: row.text,
    score: row.score,
  };
}

export interface VectorSearchInput {
  embedding: Float32Array;
  // The model the query was embedded with. Vectors of different models are not comparable, even
  // when they happen to have the same dimension.
  embedModel: string;
  k: number;
  // Only this document. In a search over everything a long contract takes every place in the
  // result and a short one that has the answer never shows up.
  documentId?: string | undefined;
}

// A scan over every chunk of this model: vec_distance_cosine comes from sqlite-vec, the rest is
// plain sql. The filters come first, so a vector of another dimension never reaches the function
// (it throws on a mismatch), and a flagged chunk has no way into the result.
function vectorRanking(db: Db, input: VectorSearchInput): RankedHit[] {
  const rows = db
    .prepare<Record<string, unknown>>(
      `SELECT ${HIT_COLUMNS},
              1 - vec_distance_cosine(c.embedding, @query) AS score
       FROM retrieval_chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE c.embed_model = @model AND c.embed_dim = @dim AND c.injection_flagged = 0
         AND (@document IS NULL OR c.document_id = @document)
       ORDER BY score DESC, c.id
       LIMIT @k`,
    )
    .all({
      query: toBlob(input.embedding),
      model: input.embedModel,
      dim: input.embedding.length,
      k: input.k,
      document: input.documentId ?? null,
    });
  return z.array(HitRow).parse(rows);
}

// Enough to give bm25 something to rank, not enough for a pasted page to become a huge query.
const MAX_QUERY_TERMS = 32;

// The words of a question as an fts5 query. Each word is quoted, so nothing the user types is
// read as fts syntax (AND, NEAR, a column filter, an unbalanced quote). Joined with OR: a question
// is not a list of required words, bm25 ranks the chunks that have the rare ones highest.
// Null when the text has no words.
export function toFtsQuery(text: string): string | null {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms = [...new Set(words)].slice(0, MAX_QUERY_TERMS);
  return terms.length === 0 ? null : terms.map((term) => `"${term}"`).join(" OR ");
}

export interface KeywordSearchInput {
  query: string;
  k: number;
  documentId?: string | undefined;
}

// Full text search over the same chunks, whatever model embedded them. bm25() is lower for a
// better match, so it is negated to read like the other scores.
function keywordRanking(db: Db, input: KeywordSearchInput): RankedHit[] {
  const match = toFtsQuery(input.query);
  if (match === null) return [];
  const rows = db
    .prepare<Record<string, unknown>>(
      `SELECT ${HIT_COLUMNS},
              -bm25(retrieval_chunks_fts) AS score
       FROM retrieval_chunks_fts
       JOIN retrieval_chunks c ON c.id = retrieval_chunks_fts.rowid
       JOIN documents d ON d.id = c.document_id
       WHERE retrieval_chunks_fts MATCH @match AND c.injection_flagged = 0
         AND (@document IS NULL OR c.document_id = @document)
       ORDER BY score DESC, c.id
       LIMIT @k`,
    )
    .all({ match, k: input.k, document: input.documentId ?? null });
  return z.array(HitRow).parse(rows);
}

export const RRF_K = 60;

// Reciprocal rank fusion: every list gives an item 1 / (k + its rank), and the sums are compared.
// Only ranks are used, so a cosine similarity and a bm25 score never have to be put on one scale.
// With k = 60 being second in two lists (2/62) beats being first in one (1/61).
// Takes lists of ids, best first. Returns every id that is in any list, best first.
export function reciprocalRankFusion(
  rankings: readonly (readonly number[])[],
  k: number = RRF_K,
): { id: number; score: number }[] {
  const scores = new Map<number, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, i) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
    });
  }
  return [...scores]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id - b.id);
}

// How many results each search contributes to the fusion. More than any k the api accepts, so a
// chunk that is 30th by meaning and 2nd by wording can still come out on top.
const FUSION_DEPTH = 50;

export function searchRetrievalChunks(db: Db, input: VectorSearchInput): ChunkHit[] {
  return vectorRanking(db, input).map(toHit);
}

export function keywordSearchRetrievalChunks(db: Db, input: KeywordSearchInput): ChunkHit[] {
  return keywordRanking(db, input).map(toHit);
}

export type HybridSearchInput = VectorSearchInput & KeywordSearchInput;

// Vector search finds a passage that means the same in other words, keyword search finds the one
// that has the words. Both are asked and their rankings fused.
export function hybridSearchRetrievalChunks(db: Db, input: HybridSearchInput): ChunkHit[] {
  const depth = Math.max(FUSION_DEPTH, input.k);
  const byVector = vectorRanking(db, { ...input, k: depth });
  const byKeyword = keywordRanking(db, { ...input, k: depth });
  const rows = new Map<number, RankedHit>();
  for (const row of [...byVector, ...byKeyword]) rows.set(row.id, row);

  const fused = reciprocalRankFusion([
    byVector.map((row) => row.id),
    byKeyword.map((row) => row.id),
  ]);
  const hits: ChunkHit[] = [];
  for (const { id, score } of fused.slice(0, input.k)) {
    const row = rows.get(id);
    if (row) hits.push(toHit({ ...row, score }));
  }
  return hits;
}

// One chunk by the id a search returned it with, for checking a citation. A flagged chunk is not
// found, the same as in the searches: no path hands its text out.
export function getRetrievalChunk(db: Db, id: number): ChunkHit | undefined {
  const row = db
    .prepare<[number]>(
      `SELECT ${HIT_COLUMNS}, 0 AS score
       FROM retrieval_chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE c.id = ? AND c.injection_flagged = 0`,
    )
    .get(id);
  return row === undefined ? undefined : toHit(HitRow.parse(row));
}

const CountRow = z.object({ n: z.int() });

// Chunks the vector search skips because they were embedded with another model or dimension.
// More than zero after an EMBED_MODEL change means the backfill has to run.
export function countStaleRetrievalChunks(db: Db, embedModel: string, embedDim: number): number {
  const row = db
    .prepare<[string, number]>(
      "SELECT COUNT(*) AS n FROM retrieval_chunks WHERE NOT (embed_model = ? AND embed_dim = ?)",
    )
    .get(embedModel, embedDim);
  return CountRow.parse(row).n;
}

export interface DocumentsToIndexOptions {
  // Every completed document, also the ones that are indexed. For rebuilding the index after
  // the chunking changed.
  all?: boolean;
}

// What the backfill has to do: completed documents that were never indexed, failed to index, or
// hold chunks of another embedding model. Duplicates are left out, they reuse the original's
// extraction and would only put the same text into the results twice.
export function listDocumentsToIndex(
  db: Db,
  embedModel: string,
  opts: DocumentsToIndexOptions = {},
): DocumentRow[] {
  return db
    .prepare<[number, string], DocumentRow>(
      `SELECT d.* FROM documents d
       WHERE d.status = 'completed'
         AND d.duplicate_of IS NULL
         AND (
           ? = 1
           OR d.index_status IS NOT 'indexed'
           OR EXISTS (
             SELECT 1 FROM retrieval_chunks c
             WHERE c.document_id = d.id AND c.embed_model <> ?
           )
         )
       ORDER BY d.created_at`,
    )
    .all(opts.all ? 1 : 0, embedModel);
}
