import {
  ErrorCode,
  LlmExtractionSchema,
  llmExtractionJsonSchema,
  type LlmExtraction,
} from "@nexus/shared";
import { z } from "zod";
import { LlmError } from "../llm/errors.js";
import {
  EMPTY_REPLY_NOTE,
  MAX_OUTPUT_TOKENS,
  SCHEMA_NAME,
  TRUNCATED_NOTE,
  buildRepairConversation,
  buildRetryConversation,
  buildSystemPrompt,
  buildUserMessage,
} from "../llm/prompts/extract.v1.js";
import type {
  LlmCallInfo,
  LlmMessage,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmUsage,
} from "../llm/types.js";
import { PermanentError } from "../pipeline/errors.js";
import type { Chunk } from "./chunk.js";

export interface ExtractOptions {
  filename: string;
  chunkCount: number;
  timeoutMs: number;
}

export interface ChunkExtraction {
  chunkIndex: number;
  data: LlmExtraction;
  usage: LlmUsage;
  repaired: boolean;
  latencyMs: number;
  // One entry per provider call, in order: the first attempt, then the repair or retry if any.
  calls: LlmCallInfo[];
}

// Enough for the model to see what to fix, small enough not to blow up the repair prompt.
const MAX_REPAIR_ERRORS_CHARS = 2000;
const NOT_JSON = "Reply was not valid JSON";

type Timing = Pick<LlmCallInfo, "durationMs" | "numCtx">;

type Attempt = Timing &
  (
    | { ok: true; data: LlmExtraction; usage: LlmUsage }
    | {
        ok: false;
        usage: LlmUsage;
        errors: string;
        retryKind: "repair" | "retry";
        retry: (doc: string) => LlmMessage[];
      }
  );

const ZERO: LlmUsage = { inputTokens: 0, outputTokens: 0 };

function lower(value: unknown): unknown {
  return typeof value === "string" ? value.toLowerCase() : value;
}

function lowerKeys(node: unknown, keys: readonly string[]): unknown {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return node;
  const copy: Record<string, unknown> = { ...node };
  for (const key of keys) if (key in copy) copy[key] = lower(copy[key]);
  return copy;
}

// Models capitalize enum values ("High", "Contract") often enough that a whole repair call for it
// would be most of our repairs. Only enum positions are touched, free text keeps its case.
function lowercaseEnums(json: unknown): unknown {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return json;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(json)) {
    if (key === "risk_clauses" && Array.isArray(value)) {
      out[key] = value.map((clause) => lowerKeys(clause, ["category", "severity"]));
    } else if (key === "document_type") {
      out[key] = lowerKeys(value, ["value", "confidence"]);
    } else {
      out[key] = lowerKeys(value, ["confidence"]);
    }
  }
  return out;
}

function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}

async function attempt(
  provider: LlmProvider,
  messages: LlmMessage[],
  timeoutMs: number,
): Promise<Attempt> {
  const req: LlmRequest = {
    system: buildSystemPrompt(),
    messages,
    schema: llmExtractionJsonSchema(),
    schemaName: SCHEMA_NAME,
    timeoutMs,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  };
  const numCtx = provider.numCtx?.(req) ?? null;
  const started = performance.now();
  const timing = (): Timing => ({ durationMs: Math.round(performance.now() - started), numCtx });
  let res: LlmResponse;
  try {
    res = await provider.complete(req);
  } catch (err) {
    // Timeouts, rate limits and the rest are bullmq's to retry, not something a repair can fix.
    if (!(err instanceof LlmError) || err.kind !== "bad_output") throw err;
    const rawText = err.rawText ?? "";
    // A cut-off or empty reply never goes back as the assistant turn, see buildRetryConversation.
    const note = err.truncated ? TRUNCATED_NOTE : rawText.trim() === "" ? EMPTY_REPLY_NOTE : null;
    return {
      ...timing(),
      ok: false,
      usage: err.usage ?? ZERO,
      errors: note === null ? `${NOT_JSON}: ${err.message}` : err.message,
      retryKind: note === null ? "repair" : "retry",
      retry:
        note === null
          ? (doc) => buildRepairConversation(doc, rawText, NOT_JSON)
          : (doc) => buildRetryConversation(doc, note),
    };
  }

  const parsed = LlmExtractionSchema.safeParse(lowercaseEnums(res.json));
  if (parsed.success) return { ...timing(), ok: true, data: parsed.data, usage: res.usage };
  const errors = z.prettifyError(parsed.error).slice(0, MAX_REPAIR_ERRORS_CHARS);
  return {
    ...timing(),
    ok: false,
    usage: res.usage,
    errors,
    retryKind: "repair",
    retry: (doc) => buildRepairConversation(doc, res.rawText, errors),
  };
}

// One repair only: if the same prompt on the same text gives broken structure twice, more attempts
// just hide the problem, and the job fails visibly with the errors instead.
export async function extractChunk(
  provider: LlmProvider,
  chunk: Chunk,
  { filename, chunkCount, timeoutMs }: ExtractOptions,
): Promise<ChunkExtraction> {
  const started = performance.now();
  const doc = buildUserMessage({ filename, text: chunk.text, chunkIndex: chunk.index, chunkCount });
  const calls: LlmCallInfo[] = [];
  const record = (kind: LlmCallInfo["kind"], a: Attempt): void => {
    calls.push({
      kind,
      chunkIndex: chunk.index,
      ok: a.ok,
      durationMs: a.durationMs,
      usage: a.usage,
      numCtx: a.numCtx,
    });
  };
  const done = (data: LlmExtraction, usage: LlmUsage, repaired: boolean): ChunkExtraction => ({
    chunkIndex: chunk.index,
    data,
    usage,
    repaired,
    latencyMs: Math.round(performance.now() - started),
    calls,
  });

  const first = await attempt(provider, [{ role: "user", content: doc }], timeoutMs);
  record("extract", first);
  if (first.ok) return done(first.data, first.usage, false);

  const second = await attempt(provider, first.retry(doc), timeoutMs);
  record(first.retryKind, second);
  const usage = addUsage(first.usage, second.usage);
  if (second.ok) return done(second.data, usage, true);

  throw new PermanentError(
    ErrorCode.EXTRACTION_INVALID,
    `Chunk ${String(chunk.index + 1)} of ${String(chunkCount)} still invalid after one repair: ${second.errors}`,
  );
}
