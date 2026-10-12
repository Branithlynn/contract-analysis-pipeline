import type { EmbedKind, Embedder, EmbedOptions } from "./types.js";

export const MOCK_EMBED_DIM = 64;

// FNV-1a. Any stable string hash does, it only has to give the same number on every machine.
function hash(token: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Feature hashing: every word adds +1 or -1 to one of the dimensions, then the vector is scaled to
// length 1. Texts that share words end up close, so ranking can be tested without a model.
export function mockEmbedding(text: string, dim: number = MOCK_EMBED_DIM): Float32Array {
  const vector = new Float32Array(dim);
  for (const [token] of text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    const h = hash(token);
    const slot = h % dim;
    vector[slot] = (vector[slot] ?? 0) + ((h >>> 16) % 2 === 0 ? 1 : -1);
  }
  let norm = Math.hypot(...vector);
  if (norm === 0) {
    // No words, or words that cancelled out. A zero vector has no direction, and its cosine
    // distance to anything is not a number.
    vector[0] = 1;
    norm = 1;
  }
  return vector.map((value) => value / norm);
}

export interface MockEmbedderOptions {
  dim?: number;
  model?: string;
}

// For unit tests, CI and EMBED_PROVIDER=mock: the index and the search run without a model.
export class MockEmbedder implements Embedder {
  readonly name = "mock";
  readonly model: string;
  readonly calls: { texts: readonly string[]; kind: EmbedKind }[] = [];
  private readonly dim: number;

  constructor(opts: MockEmbedderOptions = {}) {
    this.dim = opts.dim ?? MOCK_EMBED_DIM;
    this.model = opts.model ?? "mock";
  }

  embed(texts: readonly string[], kind: EmbedKind, opts?: EmbedOptions): Promise<Float32Array[]> {
    this.calls.push({ texts, kind });
    opts?.onCall?.({ texts: texts.length, durationMs: 0, loadMs: null });
    return Promise.resolve(texts.map((text) => mockEmbedding(text, this.dim)));
  }
}
