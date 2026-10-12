import { z } from "zod";
import type { Db } from "./client.js";
import type { DocumentRow } from "./repositories.js";

// The retrieval index: small chunks of document text with their embedding. Separate from the
// extractions, nothing here feeds the extracted fields.

export interface RetrievalChunkInput {
  chunk_index: number;
  // Null for docx, which has no fixed pages.
  page: number | null;
  text: string;
  // The injection detector matched this text. Stored so the index is complete, never searchable.
  injection_flagged: boolean;
  embedding: Float32Array;
}

export interface RetrievalChunkRow {
  id: number;
  document_id: string;
  chunk_index: number;
  page: number | null;
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
// chunks of the old run next to the new ones. One transaction, so a search never sees half a document.
export function replaceRetrievalChunks(
  db: Db,
  documentId: string,
  embedModel: string,
  chunks: readonly RetrievalChunkInput[],
): void {
  const remove = db.prepare<[string]>("DELETE FROM retrieval_chunks WHERE document_id = ?");
  const insert = db.prepare<Record<string, unknown>>(
    `INSERT INTO retrieval_chunks
       (document_id, chunk_index, page, text, injection_flagged, embed_model, embed_dim, embedding, created_at)
     VALUES
       (@document_id, @chunk_index, @page, @text, @injection_flagged, @embed_model, @embed_dim, @embedding, @created_at)`,
  );
  const createdAt = new Date().toISOString();
  db.transaction(() => {
    remove.run(documentId);
    for (const chunk of chunks) {
      insert.run({
        document_id: documentId,
        chunk_index: chunk.chunk_index,
        page: chunk.page,
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

export interface SearchChunksInput {
  embedding: Float32Array;
  // The model the query was embedded with. Vectors of different models are not comparable, even
  // when they happen to have the same dimension.
  embedModel: string;
  k: number;
}

const SearchHitRow = z.object({
  document_id: z.string(),
  file_name: z.string(),
  page: z.int().nullable(),
  text: z.string(),
  distance: z.number(),
});

export interface ChunkHit {
  document_id: string;
  file_name: string;
  page: number | null;
  text: string;
  // Cosine similarity, 1 is the same direction.
  score: number;
}

// A scan over every chunk of this model: vec_distance_cosine comes from sqlite-vec, the rest is
// plain sql. The filters come first, so a vector of another dimension never reaches the function
// (it throws on a mismatch), and a flagged chunk has no way into the result.
export function searchRetrievalChunks(db: Db, input: SearchChunksInput): ChunkHit[] {
  const rows = db
    .prepare<Record<string, unknown>>(
      `SELECT c.document_id, d.original_name AS file_name, c.page, c.text,
              vec_distance_cosine(c.embedding, @query) AS distance
       FROM retrieval_chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE c.embed_model = @model AND c.embed_dim = @dim AND c.injection_flagged = 0
       ORDER BY distance, c.id
       LIMIT @k`,
    )
    .all({
      query: toBlob(input.embedding),
      model: input.embedModel,
      dim: input.embedding.length,
      k: input.k,
    });
  return z
    .array(SearchHitRow)
    .parse(rows)
    .map(({ distance, ...hit }) => ({ ...hit, score: 1 - distance }));
}

const CountRow = z.object({ n: z.int() });

// Chunks the search above skips because they were embedded with another model or dimension.
// More than zero after an EMBED_MODEL change means the backfill has to run.
export function countStaleRetrievalChunks(db: Db, embedModel: string, embedDim: number): number {
  const row = db
    .prepare<[string, number]>(
      "SELECT COUNT(*) AS n FROM retrieval_chunks WHERE NOT (embed_model = ? AND embed_dim = ?)",
    )
    .get(embedModel, embedDim);
  return CountRow.parse(row).n;
}

// What the backfill has to do: completed documents that were never indexed, failed to index, or
// hold chunks of another embedding model. Duplicates are left out, they reuse the original's
// extraction and would only put the same text into the results twice.
export function listDocumentsToIndex(db: Db, embedModel: string): DocumentRow[] {
  return db
    .prepare<[string], DocumentRow>(
      `SELECT d.* FROM documents d
       WHERE d.status = 'completed'
         AND d.duplicate_of IS NULL
         AND (
           d.index_status IS NOT 'indexed'
           OR EXISTS (
             SELECT 1 FROM retrieval_chunks c
             WHERE c.document_id = d.id AND c.embed_model <> ?
           )
         )
       ORDER BY d.created_at`,
    )
    .all(embedModel);
}
