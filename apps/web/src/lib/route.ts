import { useCallback, useSyncExternalStore } from "react";
import { CHANGE_EVENT } from "./selection.js";

// Which page is shown lives in the url next to ?doc=, so a reload and a copied link open the
// same view: ?view=chat, with the thread once it has one, or the contract a new chat is about.

export interface Route {
  view: "documents" | "chat";
  threadId: string | null;
  aboutId: string | null;
}

const VIEW = "view";
const THREAD = "thread";
const ABOUT = "about";

export function readRoute(search: string): Route {
  const params = new URLSearchParams(search);
  const chat = params.get(VIEW) === "chat";
  return {
    view: chat ? "chat" : "documents",
    threadId: chat ? params.get(THREAD) || null : null,
    aboutId: chat ? params.get(ABOUT) || null : null,
  };
}

// Relative url for a route. Other params (?doc=) stay as they are.
export function routeHref(search: string, route: Route): string {
  const params = new URLSearchParams(search);
  params.delete(VIEW);
  params.delete(THREAD);
  params.delete(ABOUT);
  if (route.view === "chat") {
    params.set(VIEW, "chat");
    // A thread already knows its contract, so the two never go together.
    if (route.threadId !== null) params.set(THREAD, route.threadId);
    else if (route.aboutId !== null) params.set(ABOUT, route.aboutId);
  }
  const query = params.toString();
  return query === "" ? "." : `?${query}`;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

// replace: for a change that is not a step the back button should return to, like a new chat
// getting its thread id.
export function useRoute(): [Route, (route: Route, opts?: { replace?: boolean }) => void] {
  // The search string is the snapshot: a new object per read would never compare equal.
  const search = useSyncExternalStore(subscribe, () => window.location.search);
  const navigate = useCallback((route: Route, opts: { replace?: boolean } = {}) => {
    const href = routeHref(window.location.search, route);
    if (href === routeHref(window.location.search, readRoute(window.location.search))) return;
    if (opts.replace) window.history.replaceState(null, "", href);
    else window.history.pushState(null, "", href);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return [readRoute(search), navigate];
}
