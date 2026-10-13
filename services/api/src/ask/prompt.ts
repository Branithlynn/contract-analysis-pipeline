import type { AskPromptVersion } from "@nexus/shared/node";
import * as v2 from "./prompt.v2.js";
import * as v3 from "./prompt.v3.js";

// The text of the ask agent that a model reads and that differs between versions: the system
// prompt says how to answer, the tool descriptions say when to use which tool. Versioned like the
// extraction prompts, so a change shows up in the logs and in the eval reports.
// What code says to the model while a question runs (the lookup reminder, a tool's reply to bad
// arguments) is not versioned: it belongs to the behaviour it comes with.

export interface AskToolDescriptions {
  find_contracts: string;
  search_clauses: string;
  get_contract: string;
}

export interface AskPrompt {
  version: AskPromptVersion;
  // documentId: the contract the chat was opened from.
  system: (today: string, documentId?: string) => string;
  tools: AskToolDescriptions;
}

// A Record, so a version added to the config has to get a prompt before the build passes.
const PROMPTS: Record<AskPromptVersion, AskPrompt> = {
  "ask.v2": {
    version: v2.PROMPT_VERSION,
    system: v2.buildSystemPrompt,
    tools: v2.TOOL_DESCRIPTIONS,
  },
  "ask.v3": {
    version: v3.PROMPT_VERSION,
    system: v3.buildSystemPrompt,
    tools: v3.TOOL_DESCRIPTIONS,
  },
};

export function askPrompt(version: AskPromptVersion): AskPrompt {
  return PROMPTS[version];
}
