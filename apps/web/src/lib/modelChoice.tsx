import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { ModelSelection } from "@nexus/shared";
import { useModels } from "../api/hooks.js";
import { buildPicker, readRemembered, writeRemembered, type PickerModel } from "./modelPicker.js";

// The model picked in the sidebar, shared with the upload zone and the re-analyze button.

interface ModelChoice {
  // Undefined until the api has answered.
  picker: PickerModel | undefined;
  // The model new uploads and re-analysis use. Null while loading or when nothing is available:
  // an upload then goes without a model and the api applies its default.
  selected: ModelSelection | null;
  choose: (selection: ModelSelection) => void;
  error: Error | null;
}

const Context = createContext<ModelChoice | null>(null);

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    // Reading the property itself throws when site data is blocked.
    return undefined;
  }
}

export function ModelChoiceProvider({ children }: { children: ReactNode }) {
  const models = useModels();
  const [remembered, setRemembered] = useState(() => readRemembered(storage()));

  const choose = useCallback((selection: ModelSelection) => {
    setRemembered(selection);
    writeRemembered(storage(), selection);
  }, []);

  const value = useMemo((): ModelChoice => {
    const picker = models.data ? buildPicker(models.data, remembered) : undefined;
    return { picker, selected: picker?.selected ?? null, choose, error: models.error };
  }, [models.data, models.error, remembered, choose]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useModelChoice(): ModelChoice {
  const value = useContext(Context);
  if (!value) throw new Error("useModelChoice needs a ModelChoiceProvider above it");
  return value;
}
