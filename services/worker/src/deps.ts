import type { Config, Db, Embedder, Logger } from "@nexus/shared/node";
import type { LlmProvider } from "./llm/types.js";

export interface WorkerDeps {
  db: Db;
  config: Config;
  logger: Logger;
  provider: LlmProvider;
  // For the retrieval index. Its own provider and model, see EMBED_PROVIDER.
  embedder: Embedder;
  // Injected so date math and timestamps are testable.
  clock: () => Date;
}
