import { z } from "zod";

export const LlmProviderName = z.enum(["ollama", "anthropic", "openai", "mock"]);
export type LlmProviderName = z.infer<typeof LlmProviderName>;

const PositiveInt = z.coerce.number().int().positive();

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
    MAX_UPLOAD_MB: PositiveInt.default(20),
    MAX_FILES_PER_REQUEST: PositiveInt.default(10),
    LLM_PROVIDER: LlmProviderName.default("ollama"),
    LLM_MODEL: z.string().default("qwen2.5:7b-instruct"),
    OLLAMA_URL: z.url().default("http://localhost:11434"),
    ANTHROPIC_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    // Per llm call. Hosted providers answer in seconds; this is for a full chunk on a local gpu.
    LLM_TIMEOUT_MS: PositiveInt.default(300000),
    // Sized so qwen2.5:7b mostly fits a 6 GB GPU (num_ctx 10240). Longer documents are chunked.
    LLM_MAX_INPUT_CHARS: PositiveInt.default(12000),
    LLM_CHUNK_CONCURRENCY: PositiveInt.default(1),
    WORKER_CONCURRENCY: PositiveInt.default(2),
    JOB_ATTEMPTS: PositiveInt.default(3),
    GROUNDING_REVIEW_THRESHOLD: z.coerce.number().min(0).max(1).default(0.8),
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
    },
    // zod skips refinements once a field fails its type check, which would hide a missing key behind
    // e.g. a bad API_PORT. Always run it so the boot error lists everything. It only compares strings,
    // so partially invalid input is safe here.
    { when: () => true },
  );
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
