import type { Logger } from "@nexus/shared/node";
import type { LlmProvider } from "./types.js";

// One local gpu: a second ollama request just waits in ollama's queue while its timeout keeps
// running, or ollama runs both and the kv cache doubles and spills onto the cpu. So anything that
// fans out llm calls (jobs, chunks) runs one at a time on ollama. Hosted providers keep the
// configured value.
export function concurrencyFor(
  provider: Pick<LlmProvider, "name">,
  configured: number,
  setting: string,
  logger: Logger,
): number {
  if (provider.name !== "ollama") return configured;
  if (configured > 1) {
    logger.info({ configured, setting }, `ollama runs one call at a time, ignoring ${setting}`);
  }
  return 1;
}
