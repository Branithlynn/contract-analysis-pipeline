import { nodeFetch, ollamaFetchFailure, type OllamaFetch } from "@nexus/shared/node";

export interface OllamaChatFetchOptions {
  // Raises node's 300s header and body limits, see createOllamaAgent.
  agent: Parameters<OllamaFetch>[1]["dispatcher"];
  // The limit of the whole question. Aborting it has to end the request to ollama.
  signal: AbortSignal;
  baseUrl: string;
  timeoutMs: number;
  fetch?: OllamaFetch;
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

// The fetch ChatOllama is given. Two things the package does not do on its own:
// - it sends no dispatcher, so node's fetch would give up after 300s without response headers;
// - it does not pass the caller's AbortSignal to the request. The ollama client makes its own
//   controller and ChatOllama only looks at ours between two stream chunks. Ollama sends nothing
//   until the first token, so while the model loads or waits behind an extraction an abort would
//   do nothing and the request would stay open on ollama.
// One wrapper per question, because the signal is the question's.
export function ollamaChatFetch(opts: OllamaChatFetchOptions): typeof fetch {
  const doFetch = opts.fetch ?? nodeFetch;
  return async (input, init) => {
    const signal = init?.signal == null ? opts.signal : AbortSignal.any([init.signal, opts.signal]);
    try {
      return await doFetch(urlOf(input), { ...init, signal, dispatcher: opts.agent });
    } catch (err) {
      throw ollamaFetchFailure(err, opts.baseUrl, opts.timeoutMs, opts.timeoutMs);
    }
  };
}
