// Turns --provider / --model into the env that loadConfig reads. Shared by llm-smoke and the eval
// runner so both refuse the same mistakes.
import { existsSync } from "node:fs";
import { LlmProviderName } from "@nexus/shared/node";

export interface LlmArgs {
  provider?: string | undefined;
  model?: string | undefined;
}

// Loads .env and lets the flags win over it. Throws with a message meant for the terminal.
export function llmEnvFromArgs(args: LlmArgs): Record<string, string | undefined> {
  if (args.provider !== undefined && !LlmProviderName.safeParse(args.provider).success) {
    throw new Error(`unknown provider "${args.provider}"`);
  }

  if (existsSync(".env")) process.loadEnvFile(".env");
  // LLM_MODEL in .env belongs to the provider in .env. Switching provider without a model would send
  // e.g. a qwen model name to anthropic. Blank counts as unset, like in loadConfig. The mock ignores
  // the model, so it doesn't need one.
  const envProvider =
    process.env.LLM_PROVIDER === undefined || process.env.LLM_PROVIDER === ""
      ? "ollama"
      : process.env.LLM_PROVIDER;
  if (
    args.provider !== undefined &&
    args.provider !== "mock" &&
    args.provider !== envProvider &&
    args.model === undefined
  ) {
    throw new Error(
      `--model is required when --provider differs from LLM_PROVIDER (${envProvider})`,
    );
  }
  const env: Record<string, string | undefined> = { ...process.env };
  if (args.provider !== undefined) env.LLM_PROVIDER = args.provider;
  if (args.model !== undefined) env.LLM_MODEL = args.model;
  return env;
}
