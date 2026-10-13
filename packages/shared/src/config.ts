import { z } from "zod";
import { DEFAULT_MAX_FILES_PER_REQUEST, DEFAULT_MAX_UPLOAD_MB } from "./limits.js";
import { LlmProviderName, MOCK_MODELS } from "./providers.js";

// No anthropic here: it has no embeddings api.
export const EmbedProviderName = z.enum(["ollama", "openai", "mock"]);
export type EmbedProviderName = z.infer<typeof EmbedProviderName>;

export const DEFAULT_EMBED_MODELS: Record<EmbedProviderName, string> = {
  ollama: "nomic-embed-text",
  openai: "text-embedding-3-small",
  mock: "mock",
};

// The versions of the extraction prompt the worker has. Listed here so the config can validate the
// choice; the prompts themselves live in the worker.
export const ExtractPromptVersion = z.enum(["extract.v1", "extract.v2", "extract.v3"]);
export type ExtractPromptVersion = z.infer<typeof ExtractPromptVersion>;

// The same for the ask agent, whose prompts live in the api: the system prompt and the tool
// descriptions.
export const AskPromptVersion = z.enum(["ask.v2", "ask.v3"]);
export type AskPromptVersion = z.infer<typeof AskPromptVersion>;

const PositiveInt = z.coerce.number().int().positive();

// A comma separated list as an array without blanks and repeats, the default model first.
function modelList(csv: string, defaultModel: string | null): string[] {
  const listed = csv
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  return [...new Set(defaultModel === null ? listed : [defaultModel, ...listed])];
}

const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    API_PORT: PositiveInt.max(65535).default(3000),
    DATABASE_PATH: z.string().default("./data/app.db"),
    UPLOAD_DIR: z.string().default("./data/uploads"),
    REDIS_URL: z.url().default("redis://localhost:6379"),
    MAX_UPLOAD_MB: PositiveInt.default(DEFAULT_MAX_UPLOAD_MB),
    MAX_FILES_PER_REQUEST: PositiveInt.default(DEFAULT_MAX_FILES_PER_REQUEST),
    LLM_PROVIDER: LlmProviderName.default("ollama"),
    LLM_MODEL: z.string().default("qwen2.5:7b-instruct"),
    // Stored on every extraction, so results from different versions can be told apart. v3 is the
    // default because it won the evals on both models (see evals/results). v1 and v2 stay
    // selectable so those runs can be repeated.
    PROMPT_VERSION: ExtractPromptVersion.default("extract.v3"),
    // Chosen separately from LLM_PROVIDER, so extraction can run on anthropic while embeddings
    // stay local. The model defaults to the provider's entry in DEFAULT_EMBED_MODELS.
    EMBED_PROVIDER: EmbedProviderName.default("ollama"),
    EMBED_MODEL: z.string().optional(),
    // Sent as options.num_gpu on ollama embed requests: how many layers go to the gpu. 0 keeps the
    // embedding model in system ram, so it needs no vram and stays loaded next to the chat model
    // instead of making ollama swap the two on every document. -1 lets ollama decide.
    EMBED_OLLAMA_NUM_GPU: z.coerce.number().int().min(-1).default(0),
    OLLAMA_URL: z.url().default("http://localhost:11434"),
    // The num_ctx of every chat call to ollama: the worker's extraction calls and the api's
    // ask agent. One setting, because ollama reloads a model whenever num_ctx changes, and the
    // two would otherwise push each other out on every switch. The default is what a full chunk
    // needs with the default LLM_MAX_INPUT_CHARS. The worker warns at startup when a chunk
    // needs more, and a single call that does not fit (a repair) still gets more for itself.
    OLLAMA_NUM_CTX: PositiveInt.default(10240),
    ANTHROPIC_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    // The hosted models a request may pick, comma separated. An allowlist, so a client cannot
    // send any model name it likes and run up a bill. LLM_MODEL is always added to the list of
    // its own provider, the default has to be selectable.
    OPENAI_MODELS: z.string().default("gpt-5-mini"),
    ANTHROPIC_MODELS: z.string().default("claude-sonnet-5-5"),
    // The mock answers with a canned extraction. Off unless asked for, so a deployment can never
    // be told to analyze a contract with it. On in dev and ci.
    ALLOW_MOCK: z.enum(["true", "false"]).default("false"),
    // Per llm call. Hosted providers answer in seconds; this is for a full chunk on a local gpu.
    LLM_TIMEOUT_MS: PositiveInt.default(300000),
    // Sized so qwen2.5:7b mostly fits a 6 GB GPU (num_ctx 10240). Longer documents are chunked.
    // Raising it means raising OLLAMA_NUM_CTX with it.
    LLM_MAX_INPUT_CHARS: PositiveInt.default(12000),
    LLM_CHUNK_CONCURRENCY: PositiveInt.default(1),
    WORKER_CONCURRENCY: PositiveInt.default(2),
    JOB_ATTEMPTS: PositiveInt.default(3),
    GROUNDING_REVIEW_THRESHOLD: z.coerce.number().min(0).max(1).default(0.8),
    // POST /api/ask. One limit for the whole answer, every model call and tool call included.
    // Sized for a local model: a hosted one is done in seconds.
    ASK_TIMEOUT_MS: PositiveInt.default(180000),
    // How many times the model may be called for one question. Each call either asks for tools
    // or gives the answer, so 6 is at most 5 rounds of tools.
    // Not below 3. A model that answers without a lookup is sent back once, then the agent
    // searches for it, and only the third call answers from what was found. With fewer calls an
    // answer with nothing behind it would have to be taken as it is.
    ASK_MAX_STEPS: PositiveInt.min(
      3,
      "ASK_MAX_STEPS has to be at least 3: a reply without a lookup is sent back once, then the agent makes the search itself, and the third call is the one that answers from it",
    ).default(6),
    // Ollama only: how long a question waits for the gpu while the worker is extracting, before
    // it is answered with MODEL_BUSY.
    ASK_BUSY_WAIT_MS: PositiveInt.default(5000),
    // Logged with every question and in the ask eval's report name. v2 stays selectable so the
    // eval runs made with it can be repeated.
    ASK_PROMPT_VERSION: AskPromptVersion.default("ask.v3"),
  })
  .superRefine(
    (config, ctx) => {
      const required = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" } as const;
      if (config.LLM_PROVIDER === "anthropic" || config.LLM_PROVIDER === "openai") {
        const key = required[config.LLM_PROVIDER];
        if (config[key] === undefined) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `required when LLM_PROVIDER=${config.LLM_PROVIDER}`,
          });
        }
      }
      if (config.LLM_PROVIDER === "mock" && config.ALLOW_MOCK !== "true") {
        ctx.addIssue({
          code: "custom",
          path: ["ALLOW_MOCK"],
          message: "has to be true when LLM_PROVIDER=mock",
        });
      }
      if (
        config.EMBED_PROVIDER === "openai" &&
        config.LLM_PROVIDER !== "openai" &&
        config.OPENAI_API_KEY === undefined
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["OPENAI_API_KEY"],
          message: "required when EMBED_PROVIDER=openai",
        });
      }
    },
    // zod skips refinements once a field fails its type check, which would hide a missing key behind
    // e.g. a bad API_PORT. Always run it so the boot error lists everything. It only compares strings,
    // so partially invalid input is safe here.
    { when: () => true },
  )
  .transform((config) => ({
    ...config,
    EMBED_MODEL: config.EMBED_MODEL ?? DEFAULT_EMBED_MODELS[config.EMBED_PROVIDER],
    // LLM_MODEL in .env usually still names a real model when the provider is switched to the
    // mock. The mock has its own names, so the default becomes the first of them.
    LLM_MODEL:
      config.LLM_PROVIDER === "mock" && !MOCK_MODELS.includes(config.LLM_MODEL)
        ? (MOCK_MODELS[0] ?? "mock")
        : config.LLM_MODEL,
    ALLOW_MOCK: config.ALLOW_MOCK === "true",
    OPENAI_MODELS: modelList(
      config.OPENAI_MODELS,
      config.LLM_PROVIDER === "openai" ? config.LLM_MODEL : null,
    ),
    ANTHROPIC_MODELS: modelList(
      config.ANTHROPIC_MODELS,
      config.LLM_PROVIDER === "anthropic" ? config.LLM_MODEL : null,
    ),
  }));
export type Config = z.infer<typeof ConfigSchema>;

type Env = Record<string, string | undefined>;

// Keyed by the env object so process.env is parsed once per process, while tests can pass their own objects.
const cache = new WeakMap<Env, Config>();

export function loadConfig(env: Env = process.env): Config {
  const cached = cache.get(env);
  if (cached) return cached;

  // .env.example ships blank keys (ANTHROPIC_API_KEY=), and compose passes those through as "".
  // Blank means unset, so defaults apply and optional keys stay undefined.
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""));

  const parsed = ConfigSchema.safeParse(present);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new Error(`Invalid configuration:\n${lines.join("\n")}`);
  }
  cache.set(env, parsed.data);
  return parsed.data;
}
