export type JsonParseResult = { ok: true; value: unknown } | { ok: false; error: unknown };

export function parseJson(text: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error };
  }
}
