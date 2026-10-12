import type { FastifyBaseLogger, FastifyPluginCallback } from "fastify";
import { z } from "zod";
import { SearchMode, type SearchResponse } from "@nexus/shared";
import {
  countStaleRetrievalChunks,
  hybridSearchRetrievalChunks,
  keywordSearchRetrievalChunks,
  LlmError,
  searchRetrievalChunks,
  type Db,
  type Embedder,
} from "@nexus/shared/node";
import { HttpError } from "../errors.js";

const SearchQuery = z.object({
  q: z.string().trim().min(1).max(1000),
  k: z.coerce.number().int().min(1).max(50).default(8),
  // Hybrid unless asked otherwise: exact wording and meaning each find things the other misses.
  mode: SearchMode.default("hybrid"),
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

  async function embedQuery(q: string, log: FastifyBaseLogger): Promise<Float32Array> {
    let embedding: Float32Array | undefined;
    try {
      [embedding] = await embedder.embed([q], "query", {
        timeoutMs: QUERY_EMBED_TIMEOUT_MS,
        onCall: (call) => log.debug({ ...call }, "search query embedded"),
      });
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
      log.warn({ kind: err.kind, err }, "could not embed the search query");
      // Retryable means the provider is slow or down right now. Anything else (a model that is
      // not pulled, a rejected key) stays broken until someone changes the setup.
      throw err.retryable
        ? new HttpError(503, "EMBEDDINGS_UNAVAILABLE", err.message)
        : new HttpError(502, "EMBEDDINGS_FAILED", err.message);
    }
    if (embedding === undefined) throw new Error("embedder returned no vector for the query");

    const stale = countStaleRetrievalChunks(db, embedder.model, embedding.length);
    if (stale > 0) {
      // They were embedded with another model, so the vector side of this search cannot see them.
      log.warn(
        { stale, embedModel: embedder.model, embedDim: embedding.length },
        "chunks from another embedding model were skipped, run npm run index:backfill",
      );
    }
    return embedding;
  }

  app.get("/search", async (request): Promise<SearchResponse> => {
    const { q, k, mode } = SearchQuery.parse(request.query);

    // Keyword search needs no embedding, so it also answers while the embeddings provider is down.
    if (mode === "keyword") return keywordSearchRetrievalChunks(db, { query: q, k });

    const embedding = await embedQuery(q, request.log);
    const vector = { embedding, embedModel: embedder.model, k };
    return mode === "vector"
      ? searchRetrievalChunks(db, vector)
      : hybridSearchRetrievalChunks(db, { ...vector, query: q });
  });

  done();
};
