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

export interface LlmProvider {
  name: LlmProviderName;
  model: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}
