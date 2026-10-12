// Turns --provider / --model for embeddings into the env that loadConfig reads. Shared by the
// index backfill and the retrieval eval so both refuse the same mistakes.
import { existsSync } from "node:fs";
import { EmbedProviderName } from "@nexus/shared/node";

export interface EmbedArgs {
  provider?: string | undefined;
  model?: string | undefined;
}

// Loads .env and lets the flags win over it. Throws with a message meant for the terminal.
export function embedEnvFromArgs(args: EmbedArgs): Record<string, string | undefined> {
  if (args.provider !== undefined && !EmbedProviderName.safeParse(args.provider).success) {
    throw new Error(
      `unknown embed provider "${args.provider}", there is ${EmbedProviderName.options.join(", ")}`,
    );
  }
  if (existsSync(".env")) process.loadEnvFile(".env");
  const env: Record<string, string | undefined> = { ...process.env };
  if (args.provider !== undefined) {
    env.EMBED_PROVIDER = args.provider;
    // EMBED_MODEL in .env belongs to the provider in .env, so without a model flag the new
    // provider gets its own default instead of e.g. a nomic model name sent to openai.
    env.EMBED_MODEL = args.model;
  } else if (args.model !== undefined) {
    env.EMBED_MODEL = args.model;
  }
  return env;
}
