import { Check, RefreshCw } from "lucide-react";
import { useId } from "react";
import { useRefreshModels } from "../api/hooks.js";
import { useModelChoice } from "../lib/modelChoice.js";
import type { PickerGroup, PickerOption } from "../lib/modelPicker.js";
import { useToast } from "./Toasts.js";

function Option({ option, onPick }: { option: PickerOption; onPick: () => void }) {
  const reasonId = useId();
  return (
    <li>
      {/* aria-disabled and not disabled: the button stays focusable, so the reason is reachable
          by keyboard and read by screen readers instead of the model being skipped. */}
      <button
        type="button"
        className="model-option"
        aria-pressed={option.selected}
        aria-disabled={option.disabled}
        aria-describedby={option.reason === null ? undefined : reasonId}
        title={option.reason ?? option.model}
        onClick={() => {
          if (!option.disabled) onPick();
        }}
      >
        <span className="model-name">{option.label}</span>
        {option.selected && <Check size={14} aria-hidden="true" />}
      </button>
      {option.reason !== null && (
        <span id={reasonId} className="visually-hidden">
          Not available: {option.reason}
        </span>
      )}
    </li>
  );
}

function Group({ group, onPick }: { group: PickerGroup; onPick: (option: PickerOption) => void }) {
  return (
    <div className="model-group">
      <div className="model-group-head">
        <span className="model-group-name">{group.label}</span>
        {group.reason !== null && <span className="model-group-reason">{group.reason}</span>}
      </div>
      {group.options.length > 0 && (
        <ul className="plain-list">
          {group.options.map((option) => (
            <Option key={option.model} option={option} onPick={() => onPick(option)} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function ModelPicker() {
  const { picker, choose, error } = useModelChoice();
  const refresh = useRefreshModels();
  const toast = useToast();

  return (
    <section className="model-picker" aria-labelledby="model-picker-title">
      <div className="model-picker-head">
        <h2 id="model-picker-title">Model</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Check which models are available"
          title="Check which models are available"
          disabled={refresh.isPending}
          onClick={() =>
            refresh.mutate(undefined, {
              onSuccess: () => toast("Model availability checked"),
              onError: (err) => toast(`Could not check models: ${err.message}`, "error"),
            })
          }
        >
          <RefreshCw size={14} aria-hidden="true" className={refresh.isPending ? "spin" : ""} />
        </button>
      </div>

      {picker === undefined ? (
        error ? (
          <p className="tone-error small">Could not load models: {error.message}</p>
        ) : (
          <div className="skeleton-stack" aria-label="Loading models">
            <span className="skeleton" />
            <span className="skeleton" />
            <span className="skeleton" />
          </div>
        )
      ) : (
        <>
          {picker.groups.map((group) => (
            <Group
              key={group.provider}
              group={group}
              onPick={(option) => {
                choose({ provider: option.provider, model: option.model });
                toast(`Uploads and chat now use ${option.label}`);
              }}
            />
          ))}
          {picker.selected === null && (
            <p className="tone-warn small">
              No model is available. Start ollama or set an api key, then check again.
            </p>
          )}
        </>
      )}
    </section>
  );
}
