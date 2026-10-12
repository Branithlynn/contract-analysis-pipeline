import type { LlmProviderName } from "@nexus/shared/node";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  // Plain JSON Schema (from z.toJSONSchema) so each provider can pass it to its own structured output api.
  schema: Record<string, unknown>;
  schemaName: string;
  timeoutMs: number;
  maxOutputTokens: number;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmResponse {
  // Parsed but unvalidated: the caller runs it through zod.
  json: unknown;
  rawText: string;
  usage: LlmUsage;
  model: string;
  latencyMs: number;
}

// One provider call as the eval report shows it. Recorded for failed calls too: a reply that could
// not be used still took the time.
export interface LlmCallInfo {
  // "repair" sends the bad reply back with the errors, "retry" asks again after a cut-off or empty one.
  kind: "extract" | "repair" | "retry" | "summary";
  // 0-based, null for the summary.
  chunkIndex: number | null;
  ok: boolean;
  durationMs: number;
  usage: LlmUsage;
  // Null for providers without a context size setting.
  numCtx: number | null;
}

export interface LlmProvider {
  name: LlmProviderName;
  model: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
  // The context size this request would be sent with. Only ollama has one, and it reloads the model
  // when it changes, so the eval records it per call.
  numCtx?(req: LlmRequest): number;
  // A cheap question that fails fast when the provider can't do the work: not reachable, or the
  // model is not there. Throws an LlmError. Only ollama has one: it is the provider that can sit
  // on a call for the whole timeout, and asking a hosted api would cost a request.
  check?(): Promise<void>;
  // For providers that hold connections open. Called once on worker shutdown.
  close?(): Promise<void>;
}
