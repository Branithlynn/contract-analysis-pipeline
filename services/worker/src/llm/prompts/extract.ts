import { llmExtractionJsonSchema } from "@nexus/shared";
import type { ExtractPromptVersion } from "@nexus/shared/node";
import * as v1 from "./extract.v1.js";
import * as v2 from "./extract.v2.js";

// What differs between versions of the extraction prompt: the system prompt and the descriptions
// in the json schema. The user message, the repair and retry wording, the schema name and the
// output budget are shared and stay in extract.v1.ts.
export interface ExtractPrompt {
  // Stored on every extraction row and in the eval report name.
  version: ExtractPromptVersion;
  system: string;
  // What the provider gets as the schema. The reply is validated with the same zod schema in
  // every version.
  schema: Record<string, unknown>;
}

// A Record, so a version added to the config has to get a prompt before the build passes.
const PROMPTS: Record<ExtractPromptVersion, () => ExtractPrompt> = {
  "extract.v1": () => ({
    version: v1.PROMPT_VERSION,
    system: v1.buildSystemPrompt(),
    schema: llmExtractionJsonSchema(),
  }),
  "extract.v2": () => ({
    version: v2.PROMPT_VERSION,
    system: v2.buildSystemPrompt(),
    schema: v2.extractionJsonSchema(),
  }),
};

export function extractPrompt(version: ExtractPromptVersion): ExtractPrompt {
  return PROMPTS[version]();
}
