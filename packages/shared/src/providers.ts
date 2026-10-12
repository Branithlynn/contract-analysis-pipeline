import { z } from "zod";

// Browser safe: the web client lists providers and sends a selection.

export const LlmProviderName = z.enum(["ollama", "anthropic", "openai", "mock"]);
export type LlmProviderName = z.infer<typeof LlmProviderName>;

// Two names for the same canned answer, so choosing a model, the dedupe key and reanalysis can
// be tried in dev and ci without a real model.
export const MOCK_MODELS: readonly string[] = ["mock", "mock-alt"];

// Which model analyzes a document: chosen per upload, retry or reanalysis. Without one the
// LLM_PROVIDER / LLM_MODEL from the environment apply.
export const ModelSelectionSchema = z.object({
  provider: LlmProviderName,
  model: z.string().trim().min(1).max(200),
});
export type ModelSelection = z.infer<typeof ModelSelectionSchema>;
