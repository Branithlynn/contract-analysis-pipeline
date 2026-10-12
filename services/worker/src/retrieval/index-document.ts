import { embedInBatches, replaceRetrievalChunks } from "@nexus/shared/node";
import type { WorkerDeps } from "../deps.js";
import { findInjections } from "../extraction/injection.js";
import { chunkForRetrieval } from "./chunk.js";

// No queue and no status: processJob and the backfill script decide what a failure means.
export type IndexDeps = Pick<WorkerDeps, "db" | "config" | "logger" | "embedder">;

export interface IndexSummary {
  chunks: number;
  // Chunks the injection detector matched. Stored, never returned by search.
  flagged: number;
  embedModel: string;
  // Null when the document produced no chunks, so nothing was embedded.
  embedDim: number | null;
}

// Takes the parsed text, page markers included. Replaces whatever index the document had.
export async function indexDocument(
  deps: IndexDeps,
  documentId: string,
  text: string,
): Promise<IndexSummary> {
  const { db, config, logger, embedder } = deps;
  const chunks = chunkForRetrieval(text);
  // Per chunk, not the document's passages from the extraction: a chunk is what a search returns
  // and what a later prompt gets, so the question is whether this piece of text talks to an ai.
  const flagged = chunks.map((chunk) => findInjections(chunk.text).length > 0);

  const vectors = await embedInBatches(
    embedder,
    chunks.map((chunk) => chunk.text),
    "document",
    {
      timeoutMs: config.LLM_TIMEOUT_MS,
      // loadMs well above zero on every document means ollama keeps swapping the embedding model
      // with the chat model.
      onCall: (call) => logger.debug({ ...call, embedModel: embedder.model }, "chunks embedded"),
    },
  );

  replaceRetrievalChunks(
    db,
    documentId,
    embedder.model,
    chunks.map((chunk, i) => {
      const embedding = vectors[i];
      // embedInBatches returns one vector per text; this keeps a short reply from storing a
      // chunk under the wrong vector.
      if (embedding === undefined) {
        throw new Error(`no embedding for chunk ${String(i)} of ${String(chunks.length)}`);
      }
      return {
        chunk_index: chunk.index,
        page_start: chunk.page_start,
        page_end: chunk.page_end,
        page_breaks: chunk.page_breaks,
        text: chunk.text,
        injection_flagged: flagged[i] === true,
        embedding,
      };
    }),
  );

  const summary: IndexSummary = {
    chunks: chunks.length,
    flagged: flagged.filter(Boolean).length,
    embedModel: embedder.model,
    embedDim: vectors[0]?.length ?? null,
  };
  if (summary.flagged > 0) {
    // No documentId here: both callers pass a child logger that already carries it.
    logger.warn(
      { flagged: summary.flagged },
      "chunks with text addressed to an ai are stored but kept out of search",
    );
  }
  return summary;
}
