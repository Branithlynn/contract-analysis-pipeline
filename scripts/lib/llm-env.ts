// Turns --provider / --model / --prompt into the env that loadConfig reads. Shared by llm-smoke and the eval
// runner so both refuse the same mistakes.
import { existsSync } from "node:fs";
import { ExtractPromptVersion, LlmProviderName } from "@nexus/shared/node";

export interface LlmArgs {
  provider?: string | undefined;
  model?: string | undefined;
  // An extraction prompt version.
  prompt?: string | undefined;
}

// Loads .env and lets the flags win over it. Throws with a message meant for the terminal.
export function llmEnvFromArgs(args: LlmArgs): Record<string, string | undefined> {
  if (args.provider !== undefined && !LlmProviderName.safeParse(args.provider).success) {
    throw new Error(`unknown provider "${args.provider}"`);
  }
  if (args.prompt !== undefined && !ExtractPromptVersion.safeParse(args.prompt).success) {
    throw new Error(
      `unknown prompt version "${args.prompt}", there is ${ExtractPromptVersion.options.join(", ")}`,
    );
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
  // Asking for the mock on the command line is the permission ALLOW_MOCK stands for.
  if (args.provider === "mock") env.ALLOW_MOCK = "true";
  if (args.model !== undefined) env.LLM_MODEL = args.model;
  if (args.prompt !== undefined) env.PROMPT_VERSION = args.prompt;
  return env;
}
