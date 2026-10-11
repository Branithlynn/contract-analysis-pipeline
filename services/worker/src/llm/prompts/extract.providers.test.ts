import { ExtractPromptVersion } from "@nexus/shared/node";
import { describe, expect, it } from "vitest";
import { createAnthropicProvider } from "../anthropic.js";
import { ollamaContextFloor } from "../factory.js";
import { buildChatBody } from "../ollama.js";
import { createOpenAIProvider } from "../openai.js";
import type { LlmRequest } from "../types.js";
import { extractPrompt } from "./extract.js";
import { MAX_OUTPUT_TOKENS, SCHEMA_NAME, buildUserMessage } from "./extract.v1.js";

// What each provider is really sent for an extraction: the system text and the schema, per prompt
// version. The descriptions come from the zod schema in shared and reach the model three ways
// (ollama's field guide, openai's strict schema, anthropic's schema hint), so a changed description
// changes a prompt without touching a prompt file. These snapshots are what keeps a stored
// "extract.v1" meaning the same thing. If one fails, the change belongs in a new version.

class Captured extends Error {}

function request(version: ExtractPromptVersion): LlmRequest {
  const prompt = extractPrompt(version);
  return {
    system: prompt.system,
    messages: [
      {
        role: "user",
        content: buildUserMessage({ filename: "a.pdf", text: "x", chunkIndex: 0, chunkCount: 1 }),
      },
    ],
    schema: prompt.schema,
    schemaName: SCHEMA_NAME,
    timeoutMs: 5000,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  };
}

// The provider is stopped right after it built its request body, so no reply has to be faked.
async function sentBy(send: (capture: (body: unknown) => never) => Promise<unknown>) {
  let sent: unknown;
  await send((body) => {
    sent = body;
    throw new Captured();
  }).catch((err: unknown) => {
    if (!(err instanceof Captured)) throw err;
  });
  return sent;
}

describe.each(ExtractPromptVersion.options)("%s as each provider sends it", (version) => {
  const req = request(version);

  it("ollama: system prompt with the field guide, and the capped schema as the grammar", () => {
    const body = buildChatBody("qwen2.5:7b-instruct", ollamaContextFloor(12000, version), req);

    expect(body.messages[0]).toMatchSnapshot("system message");
    expect(body.format).toMatchSnapshot("format");
    expect(body.options).toMatchSnapshot("options");
  });

  it("openai: instructions and the strict json schema", async () => {
    const body = await sentBy((capture) =>
      createOpenAIProvider({
        apiKey: "test-key",
        model: "gpt-test-model",
        client: { responses: { create: (params) => capture(params) } },
      }).complete(req),
    );

    expect(body).toMatchObject({ instructions: req.system });
    expect(body).toMatchSnapshot();
  });

  it("anthropic: system prompt with the schema as a hint", async () => {
    const body = await sentBy((capture) =>
      createAnthropicProvider({
        apiKey: "test-key",
        model: "claude-test-model",
        client: { messages: { create: (params) => capture(params) } },
      }).complete(req),
    );

    expect(body).toMatchSnapshot();
  });
});
