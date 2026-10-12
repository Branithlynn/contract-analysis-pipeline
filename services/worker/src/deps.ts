import type { Config, Db, Embedder, Logger } from "@nexus/shared/node";
import type { ProviderRegistry } from "./llm/factory.js";

export interface WorkerDeps {
  db: Db;
  config: Config;
  logger: Logger;
  // Gives the provider for the model a job asks for. Per job, not one for the whole worker.
  providers: Pick<ProviderRegistry, "get">;
  // For the retrieval index. Its own provider and model, see EMBED_PROVIDER.
  embedder: Embedder;
  // Injected so date math and timestamps are testable.
  clock: () => Date;
}
