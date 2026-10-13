import { Search, X } from "lucide-react";
import { useEffect, useId, useState, type KeyboardEvent, type RefObject } from "react";

interface Props {
  // What the field is for, read out by a screen reader. Also the placeholder.
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  // Shown in the placeholder, for a field that a key focuses.
  shortcut?: string;
}

// One search field for the documents and for the earlier chats: an icon, the input, a button
// that clears it. Escape clears it too, and only then: an empty field lets the key through, so
// it still closes whatever is open around it.
export function SearchField({ label, value, onChange, inputRef, shortcut }: Props) {
  const id = useId();

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Escape" || value === "") return;
    event.preventDefault();
    event.stopPropagation();
    onChange("");
  }

  return (
    <div className="search-field">
      <label htmlFor={id} className="visually-hidden">
        {label}
      </label>
      <Search size={14} aria-hidden="true" className="search-field-icon" />
      <input
        id={id}
        ref={inputRef}
        // Not type="search": browsers add their own clear button to it, each a different one.
        type="text"
        role="searchbox"
        autoComplete="off"
        spellCheck={false}
        maxLength={200}
        placeholder={shortcut === undefined ? label : `${label} (${shortcut})`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {value !== "" && (
        <button
          type="button"
          className="icon-button search-field-clear"
          aria-label="Clear the search"
          title="Clear (Esc)"
          onClick={() => {
            onChange("");
            inputRef?.current?.focus();
          }}
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

// The value a moment after the last change, so a list is not filtered on every keystroke.
// Clearing is not delayed: an emptied field should give the whole list back at once.
export function useDebounced(value: string, delayMs: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), value === "" ? 0 : delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

// "/" puts the cursor in the field, unless the key is being typed into something.
export function useSlashFocus(inputRef: RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (typingInto(event.target) || inputRef.current === null) return;
      event.preventDefault();
      inputRef.current.focus();
      inputRef.current.select();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inputRef]);
}
