import { useCallback, useSyncExternalStore, type MouseEvent } from "react";

const PARAM = "doc";
// pushState fires no event of its own, so the setter announces the change with this one.
const CHANGE_EVENT = "nexus:selectionchange";

export function readSelectedId(search: string): string | null {
  return new URLSearchParams(search).get(PARAM) || null;
}

// Relative url that selects id (or nothing) and keeps any other query params.
export function selectionHref(search: string, id: string | null): string {
  const params = new URLSearchParams(search);
  if (id === null) params.delete(PARAM);
  else params.set(PARAM, id);
  const query = params.toString();
  return query === "" ? "." : `?${query}`;
}

// A modified click on a document link means "open in a new tab", which the browser does on its own.
export function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

// The selected document lives in ?doc=<id> and nowhere else, so a copied link opens the same document
// and back / forward move between selections.
export function useSelectedDocument(): [string | null, (id: string | null) => void] {
  const selectedId = useSyncExternalStore(subscribe, () => readSelectedId(window.location.search));
  const select = useCallback((id: string | null) => {
    if (id === readSelectedId(window.location.search)) return;
    window.history.pushState(null, "", selectionHref(window.location.search, id));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return [selectedId, select];
}
