import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ModelsResponse } from "@nexus/shared";
import { buildPicker, collapsedPicker } from "../lib/modelPicker.js";
import { ModelList, ModelTrigger } from "./ModelPicker.js";

// Rendered to markup, without a browser: what the collapsed picker shows, and that the list it
// opens is the one the sidebar has, disabled models and their reason included.

// Ollama is up, openai has no key.
const MODELS: ModelsResponse = {
  default: { provider: "ollama", model: "qwen2.5:7b-instruct" },
  providers: [
    { provider: "ollama", available: true, reason: null, models: ["qwen2.5:7b-instruct"] },
    {
      provider: "openai",
      available: false,
      reason: "OPENAI_API_KEY is not set",
      models: ["gpt-5-mini"],
    },
  ],
};
const NOTHING: ModelsResponse = {
  default: { provider: "ollama", model: "qwen2.5:7b-instruct" },
  providers: [
    {
      provider: "ollama",
      available: false,
      reason: "Ollama is not reachable at localhost:11434",
      models: [],
    },
  ],
};

const noop = () => undefined;

function trigger(models: ModelsResponse | undefined, failed = false, open = false): string {
  const picker = models === undefined ? undefined : buildPicker(models, null);
  return renderToStaticMarkup(
    <ModelTrigger
      state={collapsedPicker(picker, failed)}
      open={open}
      controls="popover-1"
      onClick={noop}
    />,
  );
}

function list(models: ModelsResponse | undefined, error: string | null = null): string {
  return renderToStaticMarkup(
    <ModelList
      picker={models === undefined ? undefined : buildPicker(models, null)}
      error={error}
      refreshing={false}
      onRefresh={noop}
      onPick={noop}
    />,
  );
}

describe("the collapsed model picker", () => {
  it("is one button with the name of the model in effect and a dot that says it is ready", () => {
    const html = trigger(MODELS);

    expect(html.match(/<button/g)).toHaveLength(1);
    // The short name, as on a chip. The full one is the tooltip.
    expect(html).toContain("qwen2.5:7b<");
    expect(html).toContain('title="qwen2.5:7b-instruct (local)"');
    expect(html).toContain('class="status-dot status-dot-ready"');
    // The dot is decoration, the words are for a screen reader.
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("Model: ");
    expect(html).toContain(", available, local");
  });

  it("says that it opens a popover and whether that is open", () => {
    const closed = trigger(MODELS);
    const open = trigger(MODELS, false, true);

    expect(closed).toContain('aria-haspopup="dialog"');
    expect(closed).toContain('aria-controls="popover-1"');
    expect(closed).toContain('aria-expanded="false"');
    expect(open).toContain('aria-expanded="true"');
    // Collapsed, the list is not in the button.
    expect(closed).not.toContain("model-option");
  });

  it("shows that no model is available", () => {
    const html = trigger(NOTHING);

    expect(html).toContain("No model");
    expect(html).toContain('class="status-dot status-dot-none"');
    expect(html).toContain(", no model is available");
  });

  it("shows loading, and that the models could not be loaded", () => {
    expect(trigger(undefined)).toContain('class="status-dot status-dot-loading"');
    expect(trigger(undefined)).toContain(", loading models");
    expect(trigger(undefined, true)).toContain('class="status-dot status-dot-error"');
    expect(trigger(undefined, true)).toContain(", could not load models");
  });
});

describe("the list the popover opens", () => {
  it("has every model, the one in effect marked", () => {
    const html = list(MODELS);

    expect(html).toContain("qwen2.5:7b<");
    expect(html).toContain("gpt-5-mini<");
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-pressed="true"[^>]*title="qwen2.5:7b-instruct"/);
  });

  it("keeps a model that cannot be used in the list, disabled, with the reason", () => {
    const html = list(MODELS);

    // Still a button that can take focus: aria-disabled, not disabled.
    expect(html).toMatch(
      /aria-pressed="false" aria-disabled="true"[^>]*title="OPENAI_API_KEY not set"/,
    );
    expect(html).not.toMatch(/model-option"[^>]* disabled=""/);
    // The reason is shown next to the provider and read out with the model.
    expect(html).toContain('<span class="model-group-reason">OPENAI_API_KEY not set</span>');
    expect(html).toContain("Not available: OPENAI_API_KEY not set");
    expect(html).toMatch(/aria-describedby="([^"]+)"[\s\S]*<span id="\1" class="visually-hidden">/);
    // The one that can be used has neither.
    expect(html).toMatch(/aria-pressed="true" aria-disabled="false" title="qwen2.5:7b-instruct"/);
  });

  it("says so when nothing can be used, with the reason per provider", () => {
    const html = list(NOTHING);

    expect(html).toContain('<span class="model-group-reason">ollama not running</span>');
    expect(html).toContain("No model is available.");
  });

  it("shows why the models could not be loaded", () => {
    expect(list(undefined, "Could not reach the server")).toContain(
      "Could not load models: Could not reach the server",
    );
    expect(list(undefined)).toContain('aria-label="Loading models"');
  });
});
