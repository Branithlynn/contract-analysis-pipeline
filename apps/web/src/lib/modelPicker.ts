import {
  ModelSelectionSchema,
  type LlmProviderName,
  type ModelSelection,
  type ModelsResponse,
} from "@nexus/shared";

// What the model picker shows and which model is in effect. Pure, so it is tested without a browser.

const PROVIDER_LABELS: Record<LlmProviderName, string> = {
  ollama: "local",
  openai: "openai",
  anthropic: "anthropic",
  mock: "mock",
};

export function providerLabel(provider: string): string {
  return provider in PROVIDER_LABELS ? PROVIDER_LABELS[provider as LlmProviderName] : provider;
}

// "qwen2.5:7b-instruct" reads as "qwen2.5:7b" on a chip. The full name stays in the title.
export function shortModelName(model: string): string {
  return model.replace(/:latest$/, "").replace(/-instruct$/, "");
}

// The label on a row: the model that produced the values, and where it runs.
export function resultModelLabel(provider: string, model: string): string {
  return `${shortModelName(model)} · ${providerLabel(provider)}`;
}

// The api's reason, shortened to what fits under a disabled button.
export function shortReason(reason: string | null): string {
  if (reason === null) return "not available";
  const key = /^(\w+_API_KEY) is not set$/.exec(reason);
  if (key) return `${key[1] ?? "api key"} not set`;
  if (reason.startsWith("Ollama is not reachable")) return "ollama not running";
  if (reason.startsWith("Ollama has no chat model")) return "no chat model installed";
  return reason;
}

export interface PickerOption extends ModelSelection {
  label: string;
  selected: boolean;
  disabled: boolean;
  // Why it cannot be picked. Null for an option that can.
  reason: string | null;
}

export interface PickerGroup {
  provider: LlmProviderName;
  label: string;
  available: boolean;
  reason: string | null;
  options: PickerOption[];
}

export interface PickerModel {
  groups: PickerGroup[];
  // The model new uploads and re-analysis use. Null when nothing can be used right now.
  selected: ModelSelection | null;
}

function same(a: ModelSelection | null, b: ModelSelection): boolean {
  return a !== null && a.provider === b.provider && a.model === b.model;
}

// Which model is in effect: the remembered one while it can still be used, then the server's
// default, then the first one that works. A remembered model that is gone (key removed, ollama
// stopped) is not used silently and not forgotten either: it comes back when it does.
export function effectiveSelection(
  models: ModelsResponse,
  remembered: ModelSelection | null,
): ModelSelection | null {
  const usable = models.providers
    .filter((p) => p.available)
    .flatMap((p) => p.models.map((model): ModelSelection => ({ provider: p.provider, model })));
  const pick = (wanted: ModelSelection | null) => usable.find((option) => same(wanted, option));
  return pick(remembered) ?? pick(models.default) ?? usable[0] ?? null;
}

export function buildPicker(
  models: ModelsResponse,
  remembered: ModelSelection | null,
): PickerModel {
  const selected = effectiveSelection(models, remembered);
  const groups = models.providers.map((p): PickerGroup => {
    const reason = p.available ? null : shortReason(p.reason);
    return {
      provider: p.provider,
      label: providerLabel(p.provider),
      available: p.available,
      reason,
      options: p.models.map((model) => ({
        provider: p.provider,
        model,
        label: shortModelName(model),
        selected: same(selected, { provider: p.provider, model }),
        disabled: !p.available,
        reason,
      })),
    };
  });
  return { groups, selected };
}

const STORAGE_KEY = "nexus.model";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

// localStorage can be missing or throw (private mode, blocked site data). The choice is a
// convenience: without it the server's default applies.
export function readRemembered(storage: StorageLike | undefined): ModelSelection | null {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (raw == null) return null;
    const parsed = ModelSelectionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeRemembered(storage: StorageLike | undefined, selection: ModelSelection): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Nothing to do: the choice still holds for this page.
  }
}
