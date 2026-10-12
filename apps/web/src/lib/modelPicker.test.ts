import { describe, expect, it } from "vitest";
import type { ModelSelection, ModelsResponse } from "@nexus/shared";
import {
  buildPicker,
  effectiveSelection,
  providerLabel,
  readRemembered,
  resultModelLabel,
  shortModelName,
  shortReason,
  writeRemembered,
} from "./modelPicker.js";

const QWEN: ModelSelection = { provider: "ollama", model: "qwen2.5:7b-instruct" };
const GPT: ModelSelection = { provider: "openai", model: "gpt-5-mini" };
const CLAUDE: ModelSelection = { provider: "anthropic", model: "claude-sonnet-5-5" };

function models(overrides: Partial<Record<string, boolean>> = {}): ModelsResponse {
  const up = (name: string) => overrides[name] ?? true;
  return {
    default: QWEN,
    providers: [
      {
        provider: "ollama",
        available: up("ollama"),
        reason: up("ollama") ? null : "Ollama is not reachable at localhost:11434",
        models: up("ollama") ? ["llama3.2:3b", "qwen2.5:7b-instruct"] : [],
      },
      {
        provider: "openai",
        available: up("openai"),
        reason: up("openai") ? null : "OPENAI_API_KEY is not set",
        models: ["gpt-5-mini"],
      },
      {
        provider: "anthropic",
        available: up("anthropic"),
        reason: up("anthropic") ? null : "ANTHROPIC_API_KEY is not set",
        models: ["claude-sonnet-5-5"],
      },
    ],
  };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe("buildPicker", () => {
  it("groups the models by provider, with local first as the api sends them", () => {
    const picker = buildPicker(models(), null);

    expect(picker.groups.map((g) => [g.label, g.options.map((o) => o.label)])).toEqual([
      ["local", ["llama3.2:3b", "qwen2.5:7b"]],
      ["openai", ["gpt-5-mini"]],
      ["anthropic", ["claude-sonnet-5-5"]],
    ]);
    // The option keeps the full name, the label is only for reading.
    expect(picker.groups[0]?.options[1]).toMatchObject({ model: "qwen2.5:7b-instruct" });
  });

  it("disables the models of an unavailable provider and says why", () => {
    const picker = buildPicker(models({ openai: false }), null);
    const [local, openai] = picker.groups;

    expect(openai).toMatchObject({ available: false, reason: "OPENAI_API_KEY not set" });
    expect(openai?.options).toMatchObject([
      { model: "gpt-5-mini", disabled: true, reason: "OPENAI_API_KEY not set", selected: false },
    ]);
    expect(local?.options.every((o) => !o.disabled && o.reason === null)).toBe(true);
  });

  it("shows a provider with no models at all, so the reason has a place", () => {
    const picker = buildPicker(models({ ollama: false }), null);

    expect(picker.groups[0]).toMatchObject({
      label: "local",
      available: false,
      reason: "ollama not running",
      options: [],
    });
  });

  it("marks exactly one option as selected", () => {
    const picker = buildPicker(models(), GPT);
    const selected = picker.groups.flatMap((g) => g.options).filter((o) => o.selected);

    expect(selected).toMatchObject([GPT]);
    expect(picker.selected).toEqual(GPT);
  });
});

describe("effectiveSelection", () => {
  it("is the server's default when nothing is remembered", () => {
    expect(effectiveSelection(models(), null)).toEqual(QWEN);
  });

  it("is the remembered model while that model is available", () => {
    expect(effectiveSelection(models(), CLAUDE)).toEqual(CLAUDE);
  });

  it("falls back to the default when the remembered model cannot be used any more", () => {
    // The key was removed, or the model is no longer installed.
    expect(effectiveSelection(models({ anthropic: false }), CLAUDE)).toEqual(QWEN);
    expect(effectiveSelection(models(), { provider: "ollama", model: "mistral:7b" })).toEqual(QWEN);
  });

  it("falls back to the first model that works when the default does not", () => {
    expect(effectiveSelection(models({ ollama: false }), null)).toEqual(GPT);
    expect(effectiveSelection(models({ ollama: false, openai: false }), null)).toEqual(CLAUDE);
  });

  it("is null when no provider is available", () => {
    const none = models({ ollama: false, openai: false, anthropic: false });

    expect(effectiveSelection(none, GPT)).toBeNull();
    expect(buildPicker(none, GPT).selected).toBeNull();
  });
});

describe("the remembered choice", () => {
  it("is written and read back", () => {
    const storage = memoryStorage();

    writeRemembered(storage, GPT);

    expect(readRemembered(storage)).toEqual(GPT);
    expect(readRemembered(memoryStorage())).toBeNull();
  });

  it("ignores what is not a model selection", () => {
    for (const raw of ["{not json", '"gpt-5-mini"', '{"provider":"gemini","model":"x"}', "{}"]) {
      expect(readRemembered(memoryStorage({ "nexus.model": raw })), raw).toBeNull();
    }
  });

  it("survives a storage that is missing or throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };

    expect(readRemembered(undefined)).toBeNull();
    expect(readRemembered(broken)).toBeNull();
    expect(() => writeRemembered(broken, GPT)).not.toThrow();
    expect(() => writeRemembered(undefined, GPT)).not.toThrow();
  });
});

describe("labels", () => {
  it("names providers by where they run", () => {
    expect(providerLabel("ollama")).toBe("local");
    expect(providerLabel("openai")).toBe("openai");
    expect(providerLabel("something-new")).toBe("something-new");
  });

  it("shortens model names for chips", () => {
    expect(shortModelName("qwen2.5:7b-instruct")).toBe("qwen2.5:7b");
    expect(shortModelName("llama3.2:latest")).toBe("llama3.2");
    expect(shortModelName("gpt-5-mini")).toBe("gpt-5-mini");
  });

  it("labels a result with its model and where it ran", () => {
    expect(resultModelLabel("ollama", "qwen2.5:7b-instruct")).toBe("qwen2.5:7b · local");
    expect(resultModelLabel("openai", "gpt-5-mini")).toBe("gpt-5-mini · openai");
  });

  it("shortens the api's reasons", () => {
    expect(shortReason("OPENAI_API_KEY is not set")).toBe("OPENAI_API_KEY not set");
    expect(shortReason("Ollama is not reachable at localhost:11434")).toBe("ollama not running");
    expect(shortReason("Ollama has no chat model installed. Run: ollama pull <model>")).toBe(
      "no chat model installed",
    );
    expect(shortReason("something else")).toBe("something else");
    expect(shortReason(null)).toBe("not available");
  });
});
