import type { Config, Db, Logger } from "@nexus/shared/node";
import type { LlmProvider } from "./llm/types.js";

export interface WorkerDeps {
  db: Db;
  config: Config;
  logger: Logger;
  // null until the llm layer exists.
  provider: LlmProvider | null;
  // Injected so date math and timestamps are testable.
  clock: () => Date;
}
