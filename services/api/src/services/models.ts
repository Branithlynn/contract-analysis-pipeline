import { z } from "zod";
import type { ModelsResponse, ProviderAvailability } from "@nexus/shared";
import {
  createOllamaAgent,
  defaultModelSelection,
  hostedModels,
  MOCK_MODELS,
  nodeFetch,
  type Config,
  type HostedProvider,
  type Logger,
  type ModelSelection,
  type OllamaFetch,
} from "@nexus/shared/node";

// Which models a document can be analyzed with right now. The same answer feeds GET /api/models
// and the check an upload goes through, so the ui never offers something the api then refuses.
// Nothing in here returns a key or any part of one: only whether it is set.

export type ModelCheck = { ok: true } | { ok: false; reason: string };

export interface ModelCatalog {
  // refresh: ask ollama again instead of answering from the cache.
  list(opts?: { refresh?: boolean }): Promise<ModelsResponse>;
  check(selection: ModelSelection): Promise<ModelCheck>;
  close(): Promise<void>;
}

export type ModelCatalogConfig = Pick<
  Config,
  | "LLM_PROVIDER"
  | "LLM_MODEL"
  | "OLLAMA_URL"
  | "OPENAI_API_KEY"
  | "ANTHROPIC_API_KEY"
  | "OPENAI_MODELS"
  | "ANTHROPIC_MODELS"
  | "ALLOW_MOCK"
>;

export interface ModelCatalogOptions {
  config: ModelCatalogConfig;
  logger: Logger;
  fetch?: OllamaFetch;
  // Milliseconds, injected so the cache can be tested without waiting.
  now?: () => number;
}

// Listing models is instant on a healthy ollama. Short, because an upload waits for this answer.
const OLLAMA_TIMEOUT_MS = 2000;
// Long enough that a page load and the upload after it ask ollama once, short enough that a model
// pulled a moment ago shows up without a restart.
const OLLAMA_CACHE_MS = 30_000;
// A failure is kept for less time, so starting ollama is noticed quickly.
const OLLAMA_FAILURE_CACHE_MS = 5000;

const TagsBody = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      details: z
        .object({ family: z.string().nullish(), families: z.array(z.string()).nullish() })
        .nullish(),
    }),
  ),
});
type Tag = z.infer<typeof TagsBody>["models"][number];

// POST /api/show: newer ollama versions list what a model can do.
const ShowBody = z.object({ capabilities: z.array(z.string()).optional() });

const KEY_NAMES = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY" } as const;
const LIST_NAMES = { openai: "OPENAI_MODELS", anthropic: "ANTHROPIC_MODELS" } as const;

// For ollama versions that do not report capabilities: embedding models are bert based, and
// their names say so more often than not.
function looksLikeEmbedModel(tag: Tag): boolean {
  const families = [tag.details?.family ?? "", ...(tag.details?.families ?? [])];
  return /embed/i.test(tag.name) || families.some((family) => /bert/i.test(family));
}

// An OLLAMA_URL can carry credentials (http://user:pass@host). Only where it is goes into a reason.
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "the configured OLLAMA_URL";
  }
}

// A model pulled without a tag is listed as name:latest.
function sameOllamaModel(installed: string, wanted: string): boolean {
  return installed === wanted || installed === `${wanted}:latest`;
}

export function createModelCatalog(opts: ModelCatalogOptions): ModelCatalog {
  const { config, logger } = opts;
  const doFetch: OllamaFetch = opts.fetch ?? nodeFetch;
  const now = opts.now ?? (() => Date.now());
  const baseUrl = config.OLLAMA_URL.replace(/\/+$/, "");
  const agent = createOllamaAgent(OLLAMA_TIMEOUT_MS);

  async function ollamaJson(path: string, body?: unknown): Promise<unknown> {
    const res = await doFetch(`${baseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
      dispatcher: agent,
    });
    if (res.status !== 200) throw new Error(`ollama answered ${String(res.status)} for ${path}`);
    return res.json();
  }

  async function isChatModel(tag: Tag): Promise<boolean> {
    try {
      const show = ShowBody.safeParse(await ollamaJson("/api/show", { model: tag.name }));
      if (show.success && show.data.capabilities !== undefined) {
        return show.data.capabilities.includes("completion");
      }
    } catch (err) {
      logger.debug({ model: tag.name, err }, "ollama show failed, guessing from the name");
    }
    return !looksLikeEmbedModel(tag);
  }

  async function probeOllama(): Promise<ProviderAvailability> {
    const unavailable = (reason: string): ProviderAvailability => ({
      provider: "ollama",
      available: false,
      reason,
      models: [],
    });
    let tags: Tag[];
    try {
      const parsed = TagsBody.safeParse(await ollamaJson("/api/tags"));
      if (!parsed.success) return unavailable(`${hostOf(baseUrl)} did not answer like Ollama`);
      tags = parsed.data.models;
    } catch (err) {
      logger.debug({ err }, "ollama is not reachable");
      return unavailable(`Ollama is not reachable at ${hostOf(baseUrl)}`);
    }
    const models: string[] = [];
    for (const tag of tags) if (await isChatModel(tag)) models.push(tag.name);
    if (models.length === 0) {
      return unavailable("Ollama has no chat model installed. Run: ollama pull <model>");
    }
    return { provider: "ollama", available: true, reason: null, models: models.sort() };
  }

  let cached: { value: ProviderAvailability; until: number } | undefined;
  let inFlight: Promise<ProviderAvailability> | undefined;

  // Requests that arrive while ollama is being asked share that one question.
  function ollama(): Promise<ProviderAvailability> {
    if (cached && cached.until > now()) return Promise.resolve(cached.value);
    inFlight ??= probeOllama()
      .then((value) => {
        const ttl = value.available ? OLLAMA_CACHE_MS : OLLAMA_FAILURE_CACHE_MS;
        cached = { value, until: now() + ttl };
        return value;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  }

  function hosted(provider: HostedProvider): ProviderAvailability {
    const hasKey = config[KEY_NAMES[provider]] !== undefined;
    return {
      provider,
      available: hasKey,
      reason: hasKey ? null : `${KEY_NAMES[provider]} is not set`,
      // Listed without a key too, so the ui can show what would be there.
      models: [...hostedModels(config, provider)],
    };
  }

  const mock = (): ProviderAvailability => ({
    provider: "mock",
    available: true,
    reason: null,
    models: [...MOCK_MODELS],
  });

  return {
    async list(opts = {}) {
      // The refresh button in the ui: someone just started ollama or pulled a model and does not
      // want to wait for the cache to run out.
      if (opts.refresh) cached = undefined;
      const providers = [await ollama(), hosted("openai"), hosted("anthropic")];
      // Not listed at all when it is off: a production ui should not even show it greyed out.
      if (config.ALLOW_MOCK) providers.push(mock());
      return { default: defaultModelSelection(config), providers };
    },

    async check({ provider, model }) {
      if (provider === "mock") {
        if (!config.ALLOW_MOCK) {
          return { ok: false, reason: "The mock provider is off (ALLOW_MOCK is not true)" };
        }
        return MOCK_MODELS.includes(model)
          ? { ok: true }
          : { ok: false, reason: `Model ${model} is not a mock model` };
      }
      if (provider === "ollama") {
        const state = await ollama();
        if (!state.available) return { ok: false, reason: state.reason ?? "Ollama is unavailable" };
        return state.models.some((installed) => sameOllamaModel(installed, model))
          ? { ok: true }
          : {
              ok: false,
              reason: `Model ${model} is not installed in Ollama. Run: ollama pull ${model}`,
            };
      }
      const state = hosted(provider);
      if (!state.available)
        return { ok: false, reason: state.reason ?? `${provider} is unavailable` };
      return state.models.includes(model)
        ? { ok: true }
        : { ok: false, reason: `Model ${model} is not in ${LIST_NAMES[provider]}` };
    },

    close: () => agent.close(),
  };
}
