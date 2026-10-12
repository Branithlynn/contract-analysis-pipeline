import { describe, expect, it, vi } from "vitest";
import { ModelsResponseSchema } from "@nexus/shared";
import { createLogger, loadConfig, type OllamaFetch } from "@nexus/shared/node";
import { createModelCatalog } from "./models.js";

// Shaped like real keys, because the point of the leak test is that nothing key-like gets out.
// Put together at runtime: no key-shaped string may stand in the source, the key check that
// runs before a commit has to stay silent.
const OPENAI_KEY = "sk" + "-proj-" + "q7".repeat(12);
const ANTHROPIC_KEY = "sk" + "-ant-" + "z4".repeat(12);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const down: OllamaFetch = () => Promise.reject(new TypeError("fetch failed"));

// An ollama with these models installed. show: what /api/show says a model can do; a model not
// listed there gets a reply without capabilities, like an older ollama.
function ollamaWith(
  tags: { name: string; family?: string }[],
  show: Record<string, string[]> = {},
): ReturnType<typeof vi.fn<OllamaFetch>> {
  return vi.fn<OllamaFetch>((url, init) => {
    if (url.endsWith("/api/tags")) {
      return Promise.resolve(
        json({ models: tags.map((t) => ({ name: t.name, details: { family: t.family } })) }),
      );
    }
    if (url.endsWith("/api/show")) {
      const { model } = JSON.parse(String(init.body)) as { model: string };
      const capabilities = show[model];
      return Promise.resolve(json(capabilities ? { capabilities } : { details: {} }));
    }
    return Promise.resolve(json({ error: "not found" }, 404));
  });
}

function catalog(env: Record<string, string>, fetch: OllamaFetch = down, now?: () => number) {
  return createModelCatalog({
    config: loadConfig(env),
    logger: createLogger("api", "silent"),
    fetch,
    ...(now ? { now } : {}),
  });
}

async function provider(env: Record<string, string>, name: string, fetch: OllamaFetch = down) {
  const body = await catalog(env, fetch).list();
  return ModelsResponseSchema.parse(body).providers.find((p) => p.provider === name);
}

describe("model catalog: hosted providers", () => {
  it("marks openai and anthropic unavailable without their key, with the reason", async () => {
    expect(await provider({}, "openai")).toEqual({
      provider: "openai",
      available: false,
      reason: "OPENAI_API_KEY is not set",
      models: ["gpt-5-mini"],
    });
    expect(await provider({}, "anthropic")).toEqual({
      provider: "anthropic",
      available: false,
      reason: "ANTHROPIC_API_KEY is not set",
      models: ["claude-sonnet-5-5"],
    });
  });

  it("marks them available when the key is set", async () => {
    const env = { OPENAI_API_KEY: OPENAI_KEY, ANTHROPIC_API_KEY: ANTHROPIC_KEY };

    expect(await provider(env, "openai")).toMatchObject({ available: true, reason: null });
    expect(await provider(env, "anthropic")).toMatchObject({ available: true, reason: null });
  });

  it("treats a blank key as not set, like the blank keys in .env.example", async () => {
    expect(await provider({ OPENAI_API_KEY: "" }, "openai")).toMatchObject({ available: false });
  });

  it("lists exactly the models of the allowlist", async () => {
    const env = {
      OPENAI_API_KEY: OPENAI_KEY,
      OPENAI_MODELS: " gpt-5-mini , gpt-5,,gpt-5-mini ",
      ANTHROPIC_MODELS: "claude-sonnet-5-5,claude-haiku-5-5",
    };

    expect((await provider(env, "openai"))?.models).toEqual(["gpt-5-mini", "gpt-5"]);
    expect((await provider(env, "anthropic"))?.models).toEqual([
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
    ]);
  });

  it("never returns a key or a part of one, anywhere in the answer", async () => {
    const env = {
      OPENAI_API_KEY: OPENAI_KEY,
      ANTHROPIC_API_KEY: ANTHROPIC_KEY,
      ALLOW_MOCK: "true",
    };
    const models = catalog(env);

    const text = JSON.stringify([
      await models.list(),
      await models.check({ provider: "openai", model: "not-listed" }),
      await models.check({ provider: "anthropic", model: "not-listed" }),
    ]);

    for (const key of [OPENAI_KEY, ANTHROPIC_KEY]) {
      expect(text).not.toContain(key);
      // Not the start, not the end either.
      expect(text).not.toContain(key.slice(0, 8));
      expect(text).not.toContain(key.slice(-6));
    }
  });
});

describe("model catalog: check", () => {
  it("accepts a hosted model on the allowlist and refuses one that is not", async () => {
    const models = catalog({ OPENAI_API_KEY: OPENAI_KEY, OPENAI_MODELS: "gpt-5-mini,gpt-5" });

    expect(await models.check({ provider: "openai", model: "gpt-5" })).toEqual({ ok: true });
    expect(await models.check({ provider: "openai", model: "gpt-5-pro" })).toEqual({
      ok: false,
      reason: "Model gpt-5-pro is not in OPENAI_MODELS",
    });
  });

  it("refuses a hosted model without the key, whatever the allowlist says", async () => {
    const models = catalog({});

    expect(await models.check({ provider: "openai", model: "gpt-5-mini" })).toEqual({
      ok: false,
      reason: "OPENAI_API_KEY is not set",
    });
    expect(await models.check({ provider: "anthropic", model: "claude-sonnet-5-5" })).toEqual({
      ok: false,
      reason: "ANTHROPIC_API_KEY is not set",
    });
  });

  it("puts the default model on its provider's allowlist, so the default is always selectable", async () => {
    const models = catalog({
      LLM_PROVIDER: "anthropic",
      LLM_MODEL: "claude-opus-5-5",
      ANTHROPIC_API_KEY: ANTHROPIC_KEY,
    });

    const body = await models.list();

    expect(body.default).toEqual({ provider: "anthropic", model: "claude-opus-5-5" });
    expect(body.providers.find((p) => p.provider === "anthropic")?.models).toEqual([
      "claude-opus-5-5",
      "claude-sonnet-5-5",
    ]);
    expect(await models.check(body.default)).toEqual({ ok: true });
    // Only on its own provider's list.
    expect(body.providers.find((p) => p.provider === "openai")?.models).toEqual(["gpt-5-mini"]);
  });
});

describe("model catalog: mock", () => {
  it("is not listed and cannot be selected unless ALLOW_MOCK is true", async () => {
    const models = catalog({});

    expect((await models.list()).providers.map((p) => p.provider)).toEqual([
      "ollama",
      "openai",
      "anthropic",
    ]);
    expect(await models.check({ provider: "mock", model: "mock" })).toEqual({
      ok: false,
      reason: "The mock provider is off (ALLOW_MOCK is not true)",
    });
  });

  it("is listed with its models when ALLOW_MOCK is true", async () => {
    const models = catalog({ ALLOW_MOCK: "true" });

    expect(await provider({ ALLOW_MOCK: "true" }, "mock")).toEqual({
      provider: "mock",
      available: true,
      reason: null,
      models: ["mock", "mock-alt"],
    });
    expect(await models.check({ provider: "mock", model: "mock-alt" })).toEqual({ ok: true });
    expect(await models.check({ provider: "mock", model: "gpt-5" })).toMatchObject({ ok: false });
  });
});

describe("model catalog: ollama", () => {
  it("is unavailable with a reason when ollama does not answer", async () => {
    expect(await provider({ OLLAMA_URL: "http://ollama:11434" }, "ollama")).toEqual({
      provider: "ollama",
      available: false,
      reason: "Ollama is not reachable at ollama:11434",
      models: [],
    });
    expect(await catalog({}).check({ provider: "ollama", model: "qwen2.5:7b-instruct" })).toEqual({
      ok: false,
      reason: "Ollama is not reachable at localhost:11434",
    });
  });

  it("leaves credentials in OLLAMA_URL out of the reason", async () => {
    const state = await provider({ OLLAMA_URL: "http://user:secret-pass@gpu-box:11434" }, "ollama");

    expect(state?.reason).toBe("Ollama is not reachable at gpu-box:11434");
    expect(JSON.stringify(state)).not.toContain("secret-pass");
  });

  it("is unavailable when what answers is not ollama, or answers with an error", async () => {
    const html: OllamaFetch = () => Promise.resolve(json({ hello: "world" }));
    const broken: OllamaFetch = () => Promise.resolve(json({ error: "boom" }, 500));

    expect(await provider({}, "ollama", html)).toMatchObject({
      available: false,
      reason: "localhost:11434 did not answer like Ollama",
    });
    expect(await provider({}, "ollama", broken)).toMatchObject({
      available: false,
      reason: "Ollama is not reachable at localhost:11434",
    });
  });

  it("lists the installed chat models and leaves embedding models out", async () => {
    const fetch = ollamaWith(
      [
        { name: "qwen2.5:7b-instruct", family: "qwen2" },
        { name: "nomic-embed-text:latest", family: "nomic-bert" },
        { name: "llama3.2:3b", family: "llama" },
        // An embedding model whose name does not say so.
        { name: "bge-m3:latest", family: "bert" },
      ],
      {
        "qwen2.5:7b-instruct": ["completion", "tools"],
        "nomic-embed-text:latest": ["embedding"],
        "llama3.2:3b": ["completion"],
        "bge-m3:latest": ["embedding"],
      },
    );

    expect(await provider({}, "ollama", fetch)).toEqual({
      provider: "ollama",
      available: true,
      reason: null,
      models: ["llama3.2:3b", "qwen2.5:7b-instruct"],
    });
  });

  it("falls back to the name and family when ollama does not report capabilities", async () => {
    const fetch = ollamaWith([
      { name: "qwen2.5:7b-instruct", family: "qwen2" },
      { name: "nomic-embed-text:latest", family: "nomic-bert" },
      { name: "mxbai-embed-large:latest", family: "bert" },
      { name: "all-minilm:latest", family: "bert" },
    ]);

    expect((await provider({}, "ollama", fetch))?.models).toEqual(["qwen2.5:7b-instruct"]);
  });

  it("is unavailable when only embedding models are installed", async () => {
    const fetch = ollamaWith([{ name: "nomic-embed-text:latest", family: "nomic-bert" }], {
      "nomic-embed-text:latest": ["embedding"],
    });

    expect(await provider({}, "ollama", fetch)).toEqual({
      provider: "ollama",
      available: false,
      reason: "Ollama has no chat model installed. Run: ollama pull <model>",
      models: [],
    });
  });

  it("accepts an installed model, also without the :latest tag, and refuses one that is not there", async () => {
    const models = catalog(
      {},
      ollamaWith([{ name: "qwen2.5:7b-instruct" }, { name: "llama3.2:latest" }], {
        "qwen2.5:7b-instruct": ["completion"],
        "llama3.2:latest": ["completion"],
      }),
    );

    expect(await models.check({ provider: "ollama", model: "qwen2.5:7b-instruct" })).toEqual({
      ok: true,
    });
    expect(await models.check({ provider: "ollama", model: "llama3.2" })).toEqual({ ok: true });
    expect(await models.check({ provider: "ollama", model: "mistral:7b" })).toEqual({
      ok: false,
      reason: "Model mistral:7b is not installed in Ollama. Run: ollama pull mistral:7b",
    });
  });

  it("refuses an installed embedding model as a chat model", async () => {
    const models = catalog(
      {},
      ollamaWith([{ name: "qwen2.5:7b-instruct" }, { name: "nomic-embed-text:latest" }], {
        "qwen2.5:7b-instruct": ["completion"],
        "nomic-embed-text:latest": ["embedding"],
      }),
    );

    expect(await models.check({ provider: "ollama", model: "nomic-embed-text" })).toMatchObject({
      ok: false,
    });
  });

  it("asks ollama with a short timeout and through its own agent", async () => {
    const fetch = ollamaWith([{ name: "qwen2.5:7b-instruct" }], {
      "qwen2.5:7b-instruct": ["completion"],
    });

    await catalog({ OLLAMA_URL: "http://ollama:11434/" }, fetch).list();

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("http://ollama:11434/api/tags");
    expect(init?.method).toBe("GET");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.dispatcher).toBeDefined();
  });

  it("asks ollama once for 30 seconds, then again", async () => {
    let clock = 1_000_000;
    const fetch = ollamaWith([{ name: "qwen2.5:7b-instruct" }], {
      "qwen2.5:7b-instruct": ["completion"],
    });
    const models = catalog({}, fetch, () => clock);
    const tagCalls = () => fetch.mock.calls.filter(([url]) => url.endsWith("/api/tags")).length;

    await models.list();
    await models.check({ provider: "ollama", model: "qwen2.5:7b-instruct" });
    clock += 29_000;
    await models.list();
    expect(tagCalls()).toBe(1);

    clock += 2000;
    await models.list();
    expect(tagCalls()).toBe(2);
  });

  it("keeps a failure for only 5 seconds, so a started ollama shows up soon", async () => {
    let clock = 1_000_000;
    let up = false;
    const fetch = vi.fn<OllamaFetch>((url) => {
      if (!up) return Promise.reject(new TypeError("fetch failed"));
      return Promise.resolve(
        url.endsWith("/api/tags")
          ? json({ models: [{ name: "qwen2.5:7b-instruct" }] })
          : json({ capabilities: ["completion"] }),
      );
    });
    const models = catalog({}, fetch, () => clock);
    const available = async () =>
      (await models.list()).providers.find((p) => p.provider === "ollama")?.available;

    expect(await available()).toBe(false);
    up = true;
    clock += 4000;
    expect(await available()).toBe(false);
    clock += 2000;
    expect(await available()).toBe(true);
  });

  it("shares one question between requests that arrive together", async () => {
    const fetch = ollamaWith([{ name: "qwen2.5:7b-instruct" }], {
      "qwen2.5:7b-instruct": ["completion"],
    });
    const models = catalog({}, fetch);

    await Promise.all([models.list(), models.list(), models.list()]);

    expect(fetch.mock.calls.filter(([url]) => url.endsWith("/api/tags"))).toHaveLength(1);
  });
});

describe("model catalog: default", () => {
  it("returns LLM_PROVIDER and LLM_MODEL as the default selection", async () => {
    expect((await catalog({}).list()).default).toEqual({
      provider: "ollama",
      model: "qwen2.5:7b-instruct",
    });
    expect((await catalog({ LLM_PROVIDER: "mock", ALLOW_MOCK: "true" }).list()).default).toEqual({
      provider: "mock",
      model: "mock",
    });
  });
});
