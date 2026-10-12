import type { FastifyPluginCallback } from "fastify";
import { z } from "zod";
import type { SearchResponse } from "@nexus/shared";
import {
  countStaleRetrievalChunks,
  LlmError,
  searchRetrievalChunks,
  type Db,
  type Embedder,
} from "@nexus/shared/node";
import { HttpError } from "../errors.js";

const SearchQuery = z.object({
  q: z.string().trim().min(1).max(1000),
  k: z.coerce.number().int().min(1).max(50).default(8),
});

// One short text. Much less than LLM_TIMEOUT_MS on purpose: that one is sized for a whole
// extraction chunk on a local gpu, and a search request should not hang for minutes when ollama
// is busy with one. It answers 503 instead and can be asked again.
const QUERY_EMBED_TIMEOUT_MS = 30_000;

export interface SearchRouteDeps {
  db: Db;
  embedder: Embedder;
}

export const searchRoutes: FastifyPluginCallback<SearchRouteDeps> = (app, deps, done) => {
  const { db, embedder } = deps;

  app.get("/search", async (request): Promise<SearchResponse> => {
    const { q, k } = SearchQuery.parse(request.query);

    let embedding: Float32Array | undefined;
    try {
      [embedding] = await embedder.embed([q], "query", {
        timeoutMs: QUERY_EMBED_TIMEOUT_MS,
        onCall: (call) => request.log.debug({ ...call }, "search query embedded"),
      });
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
      request.log.warn({ kind: err.kind, err }, "could not embed the search query");
      // Retryable means the provider is slow or down right now. Anything else (a model that is
      // not pulled, a rejected key) stays broken until someone changes the setup.
      throw err.retryable
        ? new HttpError(503, "EMBEDDINGS_UNAVAILABLE", err.message)
        : new HttpError(502, "EMBEDDINGS_FAILED", err.message);
    }
    if (embedding === undefined) throw new Error("embedder returned no vector for the query");

    const hits = searchRetrievalChunks(db, { embedding, embedModel: embedder.model, k });
    const stale = countStaleRetrievalChunks(db, embedder.model, embedding.length);
    if (stale > 0) {
      // They were embedded with another model, so this search cannot see them.
      request.log.warn(
        { stale, embedModel: embedder.model, embedDim: embedding.length },
        "chunks from another embedding model were skipped, run npm run index:backfill",
      );
    }
    return hits;
  });

  done();
};
