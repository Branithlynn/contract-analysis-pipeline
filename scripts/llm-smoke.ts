// One real extraction call against one file, to check a provider end to end by hand.
// Usage: npm run llm-smoke -- <file> [--provider ollama|anthropic|openai|mock] [--model <name>] [--prompt <version>]
// The flags override .env, so all providers can be tried without editing it.
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { parseArgs } from "node:util";
import { LlmExtractionSchema, MIME_FORMATS } from "@nexus/shared";
import { ExtractPromptVersion, createLogger, loadConfig } from "@nexus/shared/node";
import { z } from "zod";
import { LlmError } from "../services/worker/src/llm/errors.js";
import { createProvider, ollamaContextFloor } from "../services/worker/src/llm/factory.js";
import { buildChatBody } from "../services/worker/src/llm/ollama.js";
import { extractPrompt } from "../services/worker/src/llm/prompts/extract.js";
import {
  MAX_OUTPUT_TOKENS,
  SCHEMA_NAME,
  buildUserMessage,
} from "../services/worker/src/llm/prompts/extract.v1.js";
import type { LlmRequest } from "../services/worker/src/llm/types.js";
import { parseDocument } from "../services/worker/src/parse/index.js";
import { llmEnvFromArgs } from "./lib/llm-env.js";
// How much of the document to show in the printed ollama request body.
const PREVIEW_CHARS = 300;

const USAGE = `usage: npm run llm-smoke -- <file> [--provider ollama|anthropic|openai|mock] [--model <name>] [--prompt ${ExtractPromptVersion.options.join("|")}]`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function mimeFor(file: string): string {
  const ext = extname(file).slice(1).toLowerCase();
  for (const [mime, format] of MIME_FORMATS) if (format === ext) return mime;
  return fail(`unsupported file extension ".${ext}", expected .pdf or .docx`);
}

function section(title: string): void {
  console.log(`\n== ${title}`);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      provider: { type: "string" },
      model: { type: "string" },
      prompt: { type: "string" },
    },
  });
  const file = positionals[0];
  if (file === undefined || positionals.length > 1) fail(USAGE);
  if (!existsSync(file)) fail(`file not found: ${file}`);

  let env: Record<string, string | undefined>;
  try {
    env = llmEnvFromArgs(values);
  } catch (err) {
    fail(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`);
  }
  // loadConfig's error lists field paths and problems, never the values, so keys can't leak here.
  const config = loadConfig(env);
  const logger = createLogger("llm-smoke", "warn");

  const parsed = await parseDocument(file, mimeFor(file), logger);
  let text = parsed.text;
  if (text.length > config.LLM_MAX_INPUT_CHARS) {
    console.warn(
      `warning: text is ${text.length} chars, cut to LLM_MAX_INPUT_CHARS=${config.LLM_MAX_INPUT_CHARS}. ` +
        "Real chunking comes next phase.",
    );
    text = text.slice(0, config.LLM_MAX_INPUT_CHARS);
  }

  const filename = file.split(/[\\/]/).pop() ?? file;
  const prompt = extractPrompt(config.PROMPT_VERSION);
  const request: LlmRequest = {
    system: prompt.system,
    messages: [
      { role: "user", content: buildUserMessage({ filename, text, chunkIndex: 0, chunkCount: 1 }) },
    ],
    schema: prompt.schema,
    schemaName: SCHEMA_NAME,
    timeoutMs: config.LLM_TIMEOUT_MS,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  };

  const provider = createProvider(config);
  // Only these two, never the config object: it holds the api keys.
  console.log(`provider: ${provider.name}\nmodel:    ${provider.model}`);
  console.log(`input:    ${filename}, ${parsed.format}, ${text.length} chars`);

  if (provider.name === "ollama") {
    const preview: LlmRequest = {
      ...request,
      messages: [
        {
          role: "user",
          content: buildUserMessage({
            filename,
            text: `${text.slice(0, PREVIEW_CHARS)}\n[... ${Math.max(0, text.length - PREVIEW_CHARS)} more chars]`,
            chunkIndex: 0,
            chunkCount: 1,
          }),
        },
      ],
    };
    section("ollama request body (document shortened, schema replaced)");
    const body = {
      ...buildChatBody(
        provider.model,
        ollamaContextFloor(config.LLM_MAX_INPUT_CHARS, config.PROMPT_VERSION),
        preview,
      ),
      format: "<schema>",
    };
    console.log(JSON.stringify(body, null, 2));
  }

  let response;
  try {
    response = await provider.complete(request);
  } catch (err) {
    if (!(err instanceof LlmError)) throw err;
    section(`llm error: ${err.kind}${err.retryable ? " (retryable)" : ""}`);
    console.log(err.message);
    if (err.rawText !== undefined) {
      section("raw output");
      console.log(err.rawText);
    }
    process.exitCode = 1;
    return;
  }

  section("response");
  console.log(`model:    ${response.model}`);
  console.log(`latency:  ${response.latencyMs} ms`);
  console.log(`usage:    ${response.usage.inputTokens} in, ${response.usage.outputTokens} out`);

  section("json");
  console.log(JSON.stringify(response.json, null, 2));

  section("LlmExtractionSchema");
  const result = LlmExtractionSchema.safeParse(response.json);
  if (result.success) {
    console.log("ok");
  } else {
    console.log(z.prettifyError(result.error));
    process.exitCode = 1;
  }
}

await main();
