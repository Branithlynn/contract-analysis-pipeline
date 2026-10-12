import { useSyncExternalStore } from "react";

// At these widths the drawer lies over the page with a backdrop and is a modal dialog. Wider, it
// sits beside or over part of the table, which stays usable. The same number is in styles.css.
export const MODAL_DRAWER_QUERY = "(max-width: 960px)";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

// What tab can reach inside root, in document order. An element with no box is skipped: that is
// how the content of a closed details element shows up.
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.getClientRects().length > 0,
  );
}

// Where a tab press goes inside a focus trap.
// count: how many elements can take focus. current: the index of the focused one, -1 when focus
// is on none of them (on the dialog itself, or still outside it).
// Returns the index to focus, null to let the browser move focus (the next stop is inside anyway),
// or -1 when there is nothing to focus and the key press only has to be swallowed.
export function trapTarget(count: number, current: number, backwards: boolean): number | null {
  if (count === 0) return -1;
  const last = count - 1;
  if (current < 0 || current > last) return backwards ? last : 0;
  if (backwards) return current === 0 ? last : null;
  return current === last ? 0 : null;
}
