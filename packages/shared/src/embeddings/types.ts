import type { EmbedProviderName } from "../config.js";
import { LlmError } from "../llm/errors.js";

// Some embedding models are trained with a different instruction for the text being stored and
// the question being asked, so the caller always says which one it is.
export type EmbedKind = "document" | "query";

// One request to the provider, for logs.
export interface EmbedCallInfo {
  texts: number;
  durationMs: number;
  // From ollama's load_duration: the time until the model was ready for this request. Near
  // zero when it was still in memory, much more when ollama had to load it first. Null for
  // providers that do not report it.
  loadMs: number | null;
}

export interface EmbedOptions {
  timeoutMs: number;
  // Called once per request that got an answer.
  onCall?: (info: EmbedCallInfo) => void;
}

export interface Embedder {
  name: EmbedProviderName;
  model: string;
  // One vector per text, in the same order. Throws an LlmError.
  embed(texts: readonly string[], kind: EmbedKind, opts: EmbedOptions): Promise<Float32Array[]>;
  // For providers that hold connections open. Called once on shutdown.
  close?(): Promise<void>;
}

// A provider reply is a boundary: a missing vector or a second dimension would otherwise end up
// in the index and only show as wrong search results.
export function toVectors(
  raw: readonly (readonly number[])[],
  expected: number,
  who: string,
): Float32Array[] {
  if (raw.length !== expected) {
    throw new LlmError(
      "bad_output",
      `${who} returned ${raw.length} embeddings for ${expected} texts`,
    );
  }
  const dim = raw[0]?.length ?? 0;
  return raw.map((values) => {
    if (values.length === 0 || values.length !== dim || !values.every(Number.isFinite)) {
      throw new LlmError("bad_output", `${who} returned an embedding that is not ${dim} numbers`);
    }
    return Float32Array.from(values);
  });
}

// Texts per request. Keeps one request small enough to answer well inside the timeout on a cpu.
export const EMBED_BATCH_SIZE = 32;

// One request after the other, never in parallel: on ollama a second request would only wait in
// its queue with the timeout running, the same reason chat calls run one at a time there.
export async function embedInBatches(
  embedder: Embedder,
  texts: readonly string[],
  kind: EmbedKind,
  opts: EmbedOptions,
): Promise<Float32Array[]> {
  const vectors: Float32Array[] = [];
  for (let at = 0; at < texts.length; at += EMBED_BATCH_SIZE) {
    vectors.push(...(await embedder.embed(texts.slice(at, at + EMBED_BATCH_SIZE), kind, opts)));
  }
  return vectors;
}
