// When to give up on an eval run. Pure, so the rule is tested without a provider.

// A document that fails with this code never got an answer: the provider was unreachable or the
// call timed out.
const UNAVAILABLE = "LLM_UNAVAILABLE";
// One can be a hiccup or one slow document. Two in a row is a provider that is down or stuck, and
// every case after that would wait out the full timeout as well: a stuck ollama once cost 30
// minutes of 300 s timeouts.
export const MAX_UNAVAILABLE_IN_A_ROW = 2;

// Null to keep going, otherwise why the run stops. Takes the runs so far, oldest first.
export function stopReason(runs: readonly { error_code: string | null }[]): string | null {
  const last = runs.slice(-MAX_UNAVAILABLE_IN_A_ROW);
  if (last.length < MAX_UNAVAILABLE_IN_A_ROW) return null;
  if (!last.every((run) => run.error_code === UNAVAILABLE)) return null;
  return `${String(MAX_UNAVAILABLE_IN_A_ROW)} cases in a row failed with ${UNAVAILABLE}, so the provider is down or stuck`;
}
