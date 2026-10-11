import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TERMINAL_STATUSES, type DocumentStatus } from "@nexus/shared";
import { getDocument, getDocuments, retryDocument, uploadDocuments } from "./client.js";

// The detail key starts with the list key, so invalidating the list also refreshes the open document.
const DOCUMENTS_KEY = ["documents"] as const;

const POLL_MS = 2000;

// Polling instead of SSE: it survives proxies and api restarts with no extra code, and a document takes
// about 75s on a local model, so 2s of lag does not matter. It stops when nothing can change anymore.
export function pollInterval(statuses: readonly DocumentStatus[]): number | false {
  return statuses.some((status) => !TERMINAL_STATUSES.includes(status)) ? POLL_MS : false;
}

export function useDocuments() {
  return useQuery({
    queryKey: DOCUMENTS_KEY,
    queryFn: ({ signal }) => getDocuments(signal),
    refetchInterval: (query) => pollInterval((query.state.data ?? []).map((doc) => doc.status)),
    refetchOnWindowFocus: true,
  });
}

export function useDocument(id: string | null) {
  return useQuery({
    queryKey: [...DOCUMENTS_KEY, id],
    queryFn: id === null ? skipToken : ({ signal }) => getDocument(id, signal),
    refetchInterval: (query) => pollInterval(query.state.data ? [query.state.data.status] : []),
    refetchOnWindowFocus: true,
  });
}

export function useUpload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (files: readonly File[]) => uploadDocuments(files),
    // Settled, not success: a request that fails halfway can still have stored its first files.
    onSettled: () => queryClient.invalidateQueries({ queryKey: DOCUMENTS_KEY }),
  });
}

export function useRetry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => retryDocument(id),
    // Settled, not success: a 409 means the document changed under us, so the cached copy is stale.
    onSettled: () => queryClient.invalidateQueries({ queryKey: DOCUMENTS_KEY }),
  });
}
