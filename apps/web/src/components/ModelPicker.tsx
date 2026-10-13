import { Check, ChevronDown, RefreshCw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type Ref,
} from "react";
import { useRefreshModels } from "../api/hooks.js";
import { focusableIn, MODAL_DRAWER_QUERY, trapTarget, useMediaQuery } from "../lib/focusTrap.js";
import { useModelChoice } from "../lib/modelChoice.js";
import {
  collapsedPicker,
  type CollapsedPicker,
  type PickerGroup,
  type PickerModel,
  type PickerOption,
} from "../lib/modelPicker.js";
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

const TITLE_ID = "model-picker-title";

interface ListProps {
  picker: PickerModel | undefined;
  // Why the models could not be loaded. Null while loading and once they are there.
  error: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  onPick: (option: PickerOption) => void;
}

// The picker itself: the heading with the refresh button and every provider's models, the ones
// that cannot be used greyed out with the reason. The sidebar shows it as it is, a narrow screen
// puts the same list into a popover.
export function ModelList({ picker, error, refreshing, onRefresh, onPick }: ListProps) {
  return (
    <>
      <div className="model-picker-head">
        <h2 id={TITLE_ID}>Model</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Check which models are available"
          title="Check which models are available"
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RefreshCw size={14} aria-hidden="true" className={refreshing ? "spin" : ""} />
        </button>
      </div>

      {picker === undefined ? (
        error !== null ? (
          <p className="tone-error small">Could not load models: {error}</p>
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
            <Group key={group.provider} group={group} onPick={onPick} />
          ))}
          {picker.selected === null && (
            <p className="tone-warn small">
              No model is available. Start ollama or set an api key, then check again.
            </p>
          )}
        </>
      )}
    </>
  );
}

interface TriggerProps {
  state: CollapsedPicker;
  open: boolean;
  // The id of the popover the button opens.
  controls: string;
  onClick: () => void;
  ref?: Ref<HTMLButtonElement>;
}

// What a narrow screen shows instead of the list: the model in effect and a dot for whether
// there is one. The dot has a shape per state, and the same in words for a screen reader.
export function ModelTrigger({ state, open, controls, onClick, ref }: TriggerProps) {
  return (
    <button
      ref={ref}
      type="button"
      className="button model-trigger"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={controls}
      title={state.title ?? state.statusText}
      onClick={onClick}
    >
      <span className={`status-dot status-dot-${state.status}`} aria-hidden="true" />
      <span className="model-name">
        <span className="visually-hidden">Model: </span>
        {state.label}
        <span className="visually-hidden">, {state.statusText}</span>
      </span>
      <ChevronDown size={14} aria-hidden="true" />
    </button>
  );
}

const POPOVER_GAP = 4;
const POPOVER_MARGIN = 16;
const POPOVER_MIN_HEIGHT = 160;

function CollapsedModelPicker({ list }: { list: ListProps }) {
  const [open, setOpen] = useState(false);
  // Where the popover goes, in the window: the sidebar it belongs to scrolls and would cut off
  // anything positioned inside it.
  const [place, setPlace] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLElement>(null);
  const popoverId = useId();

  // toTrigger: back to the button, for a close that came from the keyboard or from a pick. Not
  // after a click somewhere else, which has put focus where the user wants it.
  const close = useCallback((toTrigger: boolean) => {
    setOpen(false);
    if (toTrigger) triggerRef.current?.focus();
  }, []);

  function toggle() {
    if (open) {
      close(true);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    const top = rect.bottom + POPOVER_GAP;
    setPlace({
      top,
      left: rect.left,
      maxHeight: Math.max(POPOVER_MIN_HEIGHT, window.innerHeight - top - POPOVER_MARGIN),
    });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const popover = popoverRef.current;
    // Focus moves in, onto the model in effect when there is one, so the next tab or enter
    // continues from there.
    const current = popover?.querySelector<HTMLElement>("[aria-pressed=true]");
    (current ?? popover)?.focus();

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popover?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    // The place was measured for the window as it was.
    const onResize = () => close(false);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onResize);
    };
  }, [open, close]);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      // Only the popover closes, not a drawer that also listens for the key.
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    // Tab stays inside while it is open, the same way the document drawer keeps it as a dialog.
    if (event.key !== "Tab" || popoverRef.current === null) return;
    const stops = focusableIn(popoverRef.current);
    const active = window.document.activeElement;
    const at = active instanceof HTMLElement ? stops.indexOf(active) : -1;
    const target = trapTarget(stops.length, at, event.shiftKey);
    if (target === null) return;
    event.preventDefault();
    stops[target]?.focus();
  }

  return (
    <div className="model-collapsed">
      <ModelTrigger
        ref={triggerRef}
        state={collapsedPicker(list.picker, list.error !== null)}
        open={open}
        controls={popoverId}
        onClick={toggle}
      />
      {open && (
        <section
          ref={popoverRef}
          id={popoverId}
          className="model-picker model-popover"
          role="dialog"
          aria-labelledby={TITLE_ID}
          tabIndex={-1}
          style={place}
          onKeyDown={onKeyDown}
        >
          <ModelList
            {...list}
            onPick={(option) => {
              list.onPick(option);
              close(true);
            }}
          />
        </section>
      )}
    </div>
  );
}

export function ModelPicker() {
  const { picker, choose, error } = useModelChoice();
  const refresh = useRefreshModels();
  const toast = useToast();
  // The width at which the sidebar moves on top of the page, where a full list would take the
  // room the page needs.
  const narrow = useMediaQuery(MODAL_DRAWER_QUERY);

  const list: ListProps = {
    picker,
    error: error?.message ?? null,
    refreshing: refresh.isPending,
    onRefresh: () => {
      refresh.mutate(undefined, {
        onSuccess: () => toast("Model availability checked"),
        onError: (err) => toast(`Could not check models: ${err.message}`, "error"),
      });
    },
    onPick: (option) => {
      choose({ provider: option.provider, model: option.model });
      toast(`Uploads and chat now use ${option.label}`);
    },
  };

  if (narrow) return <CollapsedModelPicker list={list} />;
  return (
    <section className="model-picker" aria-labelledby={TITLE_ID}>
      <ModelList {...list} />
    </section>
  );
}
