import type { Config } from "./config.js";
import type { LlmProviderName, ModelSelection } from "./providers.js";

// What the api and the worker both have to agree on about model selection.

export function defaultModelSelection(
  config: Pick<Config, "LLM_PROVIDER" | "LLM_MODEL">,
): ModelSelection {
  return { provider: config.LLM_PROVIDER, model: config.LLM_MODEL };
}

export type HostedProvider = "openai" | "anthropic";

// The hosted models a request may ask for. An allowlist, so nobody can name an expensive model in
// a request and run up a bill. loadConfig already added LLM_MODEL to the list of its own provider.
export function hostedModels(
  config: Pick<Config, "OPENAI_MODELS" | "ANTHROPIC_MODELS">,
  provider: HostedProvider,
): readonly string[] {
  return provider === "openai" ? config.OPENAI_MODELS : config.ANTHROPIC_MODELS;
}

// What a document row or a job payload says, or the default when it says nothing: rows and jobs
// from before model selection existed carry no model.
export function selectionOr(
  stored: { provider?: LlmProviderName | null | undefined; model?: string | null | undefined },
  fallback: ModelSelection,
): ModelSelection {
  return stored.provider != null && stored.model != null
    ? { provider: stored.provider, model: stored.model }
    : fallback;
}
