import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { TERMINAL_STATUSES, type DocumentStatus, type ModelSelection } from "@nexus/shared";
import {
  getChunk,
  getDocument,
  getDocumentRun,
  getDocuments,
  getModels,
  getThreads,
  reanalyzeDocument,
  retryDocument,
  uploadDocuments,
} from "./client.js";

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

export const MODELS_KEY = ["models"] as const;

// What can be picked right now. The api caches its ollama check for 30s, so asking more often
// than that changes nothing. The refresh button goes around both caches, see refreshModels.
export function useModels() {
  return useQuery({
    queryKey: MODELS_KEY,
    queryFn: ({ signal }) => getModels(false, signal),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

// For the refresh button: has the api check again, then replaces what the picker shows.
export function useRefreshModels() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => getModels(true),
    onSuccess: (models) => queryClient.setQueryData(MODELS_KEY, models),
  });
}

// One older run of a document, for the side by side comparison. A finished run never changes,
// so it is fetched once.
export function useDocumentRun(id: string, run: number | null) {
  return useQuery({
    queryKey: [...DOCUMENTS_KEY, id, "run", run],
    queryFn: run === null ? skipToken : ({ signal }) => getDocumentRun(id, run, signal),
    staleTime: Infinity,
  });
}

export function useReanalyze() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, model }: { id: string; model: ModelSelection }) =>
      reanalyzeDocument(id, model),
    // Settled, not success: a 409 means the document changed under us, so the cached copy is stale.
    onSettled: () => queryClient.invalidateQueries({ queryKey: DOCUMENTS_KEY }),
  });
}

// After files were uploaded one by one, outside a mutation.
export function useInvalidateDocuments() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: DOCUMENTS_KEY });
}

export const THREADS_KEY = ["threads"] as const;

// The earlier chats, or the ones a search finds. Refreshed by the chat itself after every answer:
// the key starts with THREADS_KEY, so that reaches the searches too.
export function useThreads(query = "") {
  return useQuery({
    queryKey: [...THREADS_KEY, query],
    queryFn: ({ signal }) => getThreads(query, signal),
    staleTime: 30_000,
    // The list that is up stays up while the next search loads, instead of a skeleton per word.
    placeholderData: keepPreviousData,
  });
}

// The passage behind a citation. A chunk does not change, a document that is indexed again
// gets new ones, so a miss is not asked for twice either.
export function useChunk(id: number | null) {
  return useQuery({
    queryKey: ["chunks", id],
    queryFn: id === null ? skipToken : ({ signal }) => getChunk(id, signal),
    staleTime: Infinity,
    retry: false,
  });
}
