// Measures the ask agent end to end: indexes the sample documents into an in-memory db, stores an
// extraction for each one (from the extraction eval's expected values, see seed.ts), asks the
// questions in cases.json through the same runAsk the api calls, and scores each answer. No http
// and no queue.
// Usage: npm run eval:ask -- --provider <p> --model <m> [--repeat <n>] [--embed-provider <p>] [--embed-model <m>]
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { LLMResult } from "@langchain/core/outputs";
import { z } from "zod";
import { MIME_FORMATS } from "@nexus/shared";
import {
  EmbedProviderName,
  createDocument,
  createEmbedder,
  createLogger,
  defaultModelSelection,
  insertExtraction,
  loadConfig,
  migrate,
  openMemoryDb,
  transitionStatus,
  type Db,
} from "@nexus/shared/node";
import { embedEnvFromArgs } from "../../scripts/lib/embed-env.js";
import { llmEnvFromArgs } from "../../scripts/lib/llm-env.js";
import { AskTimeoutError, runAsk, type AskDeps } from "../../services/api/src/ask/agent.js";
import { createChatModels, type ChatModels } from "../../services/api/src/ask/chat-models.js";
import { ASK_PROMPT_VERSION } from "../../services/api/src/ask/prompt.js";
import { createThreadStore } from "../../services/api/src/ask/threads.js";
import { readContext } from "../../services/api/src/services/dto.js";
import { findInjections } from "../../services/worker/src/extraction/injection.js";
import { parseDocument } from "../../services/worker/src/parse/index.js";
import {
  indexDocument,
  type IndexDeps,
} from "../../services/worker/src/retrieval/index-document.js";
import { readCase } from "../cases.js";
import { renderAskReport, type AskHeader, type AskRun } from "./ask-report.js";
import {
  fileName,
  readAskCases,
  scoreAsk,
  type AskCase,
  type AskCases,
  type AskOutcome,
  type NamedContract,
} from "./ask-score.js";
import { ASK_CLOCK, extractionFromExpected } from "./seed.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RESULTS_DIR = join(ROOT, "evals", "results");
const CASES = join(ROOT, "evals", "ask", "cases.json");
// One failed question can be a hiccup. Two in a row is a provider that is down or a key that is
// missing, and every question after that would fail the same way.
const MAX_ERRORS_IN_A_ROW = 2;

const USAGE = `usage: npm run eval:ask -- [--provider ollama|anthropic|openai|mock] [--model <name>] [--repeat <n>] [--embed-provider ${EmbedProviderName.options.join("|")}] [--embed-model <name>]`;

function fail(text: string): never {
  console.error(`${text}\n${USAGE}`);
  process.exit(1);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function mimeFor(file: string): string {
  const ext = extname(file).slice(1).toLowerCase();
  for (const [mime, format] of MIME_FORMATS) if (format === ext) return mime;
  return fail(`${file}: unsupported extension ".${ext}"`);
}

interface Contract extends NamedContract {
  id: string;
}

// One corpus document as the pipeline would have left it: indexed, completed, with an extraction.
async function seedContract(
  deps: IndexDeps,
  db: Db,
  entry: AskCases["corpus"][number],
  threshold: number,
): Promise<Contract> {
  const expected = readCase(join(ROOT, entry.expected));
  if (expected.file !== entry.file) {
    throw new Error(`${entry.expected} is about ${expected.file}, not ${entry.file}`);
  }
  const parsed = await parseDocument(resolve(ROOT, entry.file), mimeFor(entry.file), deps.logger);
  const id = randomUUID();
  createDocument(db, {
    id,
    original_name: fileName(entry.file),
    mime: mimeFor(entry.file),
    size_bytes: 0,
    sha256: id,
    storage_path: entry.file,
    status: "queued",
  });
  await indexDocument(deps, id, parsed.text);
  // The passages the worker would have stored, so the nda carries its injection alert.
  const result = extractionFromExpected(
    expected,
    findInjections(parsed.text),
    ASK_CLOCK,
    threshold,
  );
  transitionStatus(db, id, "processing", { from: "queued" });
  insertExtraction(db, {
    document_id: id,
    run: 1,
    provider: "eval",
    model: "expected-values",
    prompt_version: "none",
    result,
    grounding_score: null,
    chunk_count: 0,
    input_tokens: 0,
    output_tokens: 0,
    duration_ms: 0,
  });
  transitionStatus(db, id, "completed", {
    from: "processing",
    needs_review: expected.expect_needs_review ?? false,
  });
  return { id, file: fileName(entry.file), names: entry.names };
}

interface Usage {
  calls: number;
  tokens: { input: number; output: number } | null;
}

// The part of a chat generation that says what the call cost. Providers that report no usage
// (the mock) leave it out.
const Reported = z.object({
  message: z.object({
    usage_metadata: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
  }),
});

// runAsk returns the answer and the trace, not what the model calls cost. The chat models are
// handed out with a callback that counts the calls and adds up the usage each one reports.
function metered(models: ChatModels): { models: ChatModels; take: () => Usage } {
  let usage: Usage = { calls: 0, tokens: null };
  const handleLLMEnd = (output: LLMResult): void => {
    usage.calls += 1;
    for (const generation of output.generations.flat()) {
      const used = Reported.safeParse(generation);
      if (!used.success) continue;
      const { input_tokens, output_tokens } = used.data.message.usage_metadata;
      usage.tokens = {
        input: (usage.tokens?.input ?? 0) + input_tokens,
        output: (usage.tokens?.output ?? 0) + output_tokens,
      };
    }
  };
  return {
    models: {
      create(selection, signal) {
        const model = models.create(selection, signal);
        model.callbacks = [{ handleLLMEnd }];
        return model;
      },
      close: () => models.close(),
    },
    // What was used since the last call.
    take() {
      const taken = usage;
      usage = { calls: 0, tokens: null };
      return taken;
    },
  };
}

function fileSafe(text: string): string {
  return text.replace(/[^A-Za-z0-9._-]+/g, "_");
}

function localDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function localTime(now: Date): string {
  return `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
}

async function main(): Promise<void> {
  let values: {
    provider?: string | undefined;
    model?: string | undefined;
    repeat: string;
    "embed-provider"?: string | undefined;
    "embed-model"?: string | undefined;
  };
  try {
    ({ values } = parseArgs({
      options: {
        provider: { type: "string" },
        model: { type: "string" },
        repeat: { type: "string", default: "1" },
        "embed-provider": { type: "string" },
        "embed-model": { type: "string" },
      },
    }));
  } catch (err) {
    fail(message(err));
  }
  const repeat = Number(values.repeat);
  if (!Number.isInteger(repeat) || repeat < 1) fail(`--repeat must be a positive whole number`);

  let env: Record<string, string | undefined>;
  try {
    const embed = embedEnvFromArgs({
      provider: values["embed-provider"],
      model: values["embed-model"],
    });
    env = {
      ...llmEnvFromArgs(values),
      EMBED_PROVIDER: embed.EMBED_PROVIDER,
      EMBED_MODEL: embed.EMBED_MODEL,
    };
  } catch (err) {
    fail(message(err));
  }
  // loadConfig's error lists field paths and problems, never the values, so keys can't leak here.
  const config = loadConfig(env);
  let cases: AskCases;
  try {
    cases = readAskCases(CASES);
  } catch (err) {
    fail(message(err));
  }

  const db = openMemoryDb();
  migrate(db);
  const embedder = createEmbedder(config);
  // Errors only: the report is what this prints.
  const logger = createLogger("eval", "error");
  const chat = metered(createChatModels({ config }));
  const model = defaultModelSelection(config);
  const deps: AskDeps = {
    db,
    embedder,
    chatModels: chat.models,
    threads: createThreadStore(db),
    maxSteps: config.ASK_MAX_STEPS,
  };
  const context = readContext(
    new Date(`${ASK_CLOCK}T12:00:00Z`),
    config.GROUNDING_REVIEW_THRESHOLD,
  );

  async function runCase(test: AskCase, label: string, corpus: Contract[]): Promise<AskRun> {
    const scope = corpus.find((contract) => contract.file === test.scope);
    const started = performance.now();
    let outcome: AskOutcome;
    let errorMessage: string | null = null;
    try {
      const result = await runAsk(deps, {
        question: test.question,
        // A new thread per question: no case sees another one's answer.
        threadId: randomUUID(),
        model,
        documentId: scope?.id,
        signal: AbortSignal.timeout(config.ASK_TIMEOUT_MS),
        log: logger,
        context,
      });
      outcome = { ...result, status: result.stopped };
    } catch (err) {
      // One bad question must not stop the rest of the run.
      if (err instanceof AskTimeoutError) {
        outcome = { status: "timeout", answer: null, citations: [], steps: err.steps };
      } else {
        errorMessage = message(err);
        outcome = { status: "error", answer: null, citations: [], steps: [] };
      }
    }
    const latency = Math.round(performance.now() - started);
    const usage = chat.take();
    return {
      label,
      kind: test.kind,
      question: test.question,
      status: outcome.status,
      error_message: errorMessage,
      answer: outcome.answer,
      citations: [...outcome.citations],
      steps: [...outcome.steps],
      model_calls: usage.calls,
      latency_ms: latency,
      tokens: usage.tokens,
      score: scoreAsk(test, corpus, outcome),
    };
  }

  const planned = cases.cases.length * repeat;
  const runs: AskRun[] = [];
  let stopped: string | null = null;
  try {
    const corpus: Contract[] = [];
    try {
      for (const entry of cases.corpus) {
        console.error(`indexing ${entry.file}`);
        corpus.push(
          await seedContract(
            { db, config, logger, embedder },
            db,
            entry,
            context.groundingThreshold,
          ),
        );
      }
    } catch (err) {
      // An embedder that is down, a broken sample, a wrong expectation: nothing to ask about.
      console.error(`ask eval stopped, nothing was written: ${message(err)}`);
      process.exitCode = 1;
      return;
    }

    run: for (const test of cases.cases) {
      for (let attempt = 1; attempt <= repeat; attempt++) {
        const label = repeat === 1 ? test.id : `${test.id} #${String(attempt)}`;
        console.error(`asking ${label}`);
        runs.push(await runCase(test, label, corpus));
        const last = runs.slice(-MAX_ERRORS_IN_A_ROW);
        if (last.length === MAX_ERRORS_IN_A_ROW && last.every((run) => run.status === "error")) {
          stopped = `${String(MAX_ERRORS_IN_A_ROW)} questions in a row failed, so the provider is down or not set up`;
          break run;
        }
      }
    }
  } finally {
    await chat.models.close();
    await embedder.close?.();
    db.close();
  }
  // The questions that were asked are still written out. The note and the exit code keep the
  // report from passing for a full run.
  const stopNote =
    stopped === null
      ? null
      : `STOPPED EARLY after ${String(runs.length)} of ${String(planned)} runs: ${stopped}. The totals below cover only the runs that were made.`;

  const now = new Date();
  const cpu = cpus();
  const header: AskHeader = {
    provider: model.provider,
    model: model.model,
    prompt_version: ASK_PROMPT_VERSION,
    embed_provider: embedder.name,
    embed_model: embedder.model,
    date: localDate(now),
    clock: ASK_CLOCK,
    cpu: `${cpu[0]?.model.trim() ?? "unknown"} (${String(cpu.length)} threads)`,
    repeat,
    max_steps: config.ASK_MAX_STEPS,
    timeout_ms: config.ASK_TIMEOUT_MS,
  };
  const report = renderAskReport({
    header,
    runs,
    ...(stopNote === null ? {} : { notes: [stopNote] }),
  });

  // With the time, like the other evals, so two runs on one day do not replace each other.
  const name = [
    header.date,
    localTime(now),
    "ask",
    header.provider,
    header.model,
    header.prompt_version,
  ]
    .map(fileSafe)
    .join("-");
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, `${name}.md`), report);
  writeFileSync(
    join(RESULTS_DIR, `${name}.json`),
    `${JSON.stringify({ header, runs }, null, 2)}\n`,
  );

  console.log(report);
  console.error(`wrote evals/results/${name}.md and .json`);
  if (stopNote !== null) {
    console.error(stopNote);
    process.exitCode = 1;
  }
}

await main();
