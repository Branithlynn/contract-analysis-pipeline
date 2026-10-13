// Measures the ask agent end to end: indexes the sample documents into an in-memory db, stores an
// extraction for each one (from the extraction eval's expected values, see seed.ts), asks the
// questions in cases.json through the same runAsk the api calls, and scores each answer. No http
// and no queue.
// Usage: npm run eval:ask -- --provider <p> --model <m> [--prompt <v>] [--cases <ids or globs>] [--repeat <n>] [--embed-provider <p>] [--embed-model <m>]
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { MIME_FORMATS } from "@nexus/shared";
import {
  AskPromptVersion,
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
import {
  AskTimeoutError,
  runAsk,
  type AskDeps,
  type AskUsage,
} from "../../services/api/src/ask/agent.js";
import { createChatModels } from "../../services/api/src/ask/chat-models.js";
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
  selectAskCases,
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

const USAGE = `usage: npm run eval:ask -- [--provider ollama|anthropic|openai|mock] [--model <name>] [--prompt ${AskPromptVersion.options.join("|")}] [--cases <id or glob, comma separated>] [--repeat <n>] [--embed-provider ${EmbedProviderName.options.join("|")}] [--embed-model <name>]`;

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

function fileSafe(text: string): string {
  return text.replace(/[^A-Za-z0-9._-]+/g, "_");
}

function localDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// With seconds: a --cases run started in the same minute as a full run used to write over it.
function localTime(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function main(): Promise<void> {
  let values: {
    provider?: string | undefined;
    model?: string | undefined;
    prompt?: string | undefined;
    cases?: string | undefined;
    repeat: string;
    "embed-provider"?: string | undefined;
    "embed-model"?: string | undefined;
  };
  try {
    ({ values } = parseArgs({
      options: {
        provider: { type: "string" },
        model: { type: "string" },
        prompt: { type: "string" },
        cases: { type: "string" },
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
  if (values.prompt !== undefined && !AskPromptVersion.safeParse(values.prompt).success) {
    fail(
      `unknown prompt version "${values.prompt}", there is ${AskPromptVersion.options.join(", ")}`,
    );
  }

  let env: Record<string, string | undefined>;
  try {
    const embed = embedEnvFromArgs({
      provider: values["embed-provider"],
      model: values["embed-model"],
    });
    env = {
      // --prompt is the ask prompt here. llmEnvFromArgs would take it for an extraction prompt.
      ...llmEnvFromArgs({ provider: values.provider, model: values.model }),
      ...(values.prompt === undefined ? {} : { ASK_PROMPT_VERSION: values.prompt }),
      EMBED_PROVIDER: embed.EMBED_PROVIDER,
      EMBED_MODEL: embed.EMBED_MODEL,
    };
  } catch (err) {
    fail(message(err));
  }
  // loadConfig's error lists field paths and problems, never the values, so keys can't leak here.
  const config = loadConfig(env);
  let cases: AskCases;
  let asked: AskCase[];
  try {
    cases = readAskCases(CASES);
    asked = values.cases === undefined ? cases.cases : selectAskCases(cases.cases, values.cases);
  } catch (err) {
    fail(message(err));
  }

  const db = openMemoryDb();
  migrate(db);
  const embedder = createEmbedder(config);
  // Errors only: the report is what this prints.
  const logger = createLogger("eval", "error");
  const chatModels = createChatModels({ config });
  const model = defaultModelSelection(config);
  const deps: AskDeps = {
    db,
    embedder,
    chatModels,
    threads: createThreadStore(db),
    maxSteps: config.ASK_MAX_STEPS,
    promptVersion: config.ASK_PROMPT_VERSION,
  };
  const context = readContext(
    new Date(`${ASK_CLOCK}T12:00:00Z`),
    config.GROUNDING_REVIEW_THRESHOLD,
  );

  async function runCase(test: AskCase, label: string, corpus: Contract[]): Promise<AskRun> {
    const scope = corpus.find((contract) => contract.file === test.scope);
    const started = performance.now();
    let outcome: AskOutcome;
    // A question that failed before anything came back has made no call that is known of.
    let usage: AskUsage = { model_calls: 0, tokens: null };
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
      usage = result.usage;
    } catch (err) {
      // One bad question must not stop the rest of the run.
      if (err instanceof AskTimeoutError) {
        outcome = { status: "timeout", answer: null, citations: [], steps: err.steps };
        usage = err.usage;
      } else {
        errorMessage = message(err);
        outcome = { status: "error", answer: null, citations: [], steps: [] };
      }
    }
    const latency = Math.round(performance.now() - started);
    return {
      label,
      kind: test.kind,
      question: test.question,
      status: outcome.status,
      error_message: errorMessage,
      answer: outcome.answer,
      citations: [...outcome.citations],
      steps: [...outcome.steps],
      model_calls: usage.model_calls,
      latency_ms: latency,
      tokens: usage.tokens,
      score: scoreAsk(test, corpus, outcome),
    };
  }

  const planned = asked.length * repeat;
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

    run: for (const test of asked) {
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
    await chatModels.close();
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
    prompt_version: config.ASK_PROMPT_VERSION,
    embed_provider: embedder.name,
    embed_model: embedder.model,
    date: localDate(now),
    clock: ASK_CLOCK,
    cpu: `${cpu[0]?.model.trim() ?? "unknown"} (${String(cpu.length)} threads)`,
    repeat,
    max_steps: config.ASK_MAX_STEPS,
    timeout_ms: config.ASK_TIMEOUT_MS,
  };
  // The whole corpus is indexed either way: a question about one contract is still asked with
  // the others there to be confused with.
  const partNote =
    asked.length === cases.cases.length
      ? null
      : `Only ${String(asked.length)} of ${String(cases.cases.length)} cases were asked (--cases ${values.cases ?? ""}): ${asked.map((c) => c.id).join(", ")}. The totals are not those of a full run.`;
  const notes = [partNote, stopNote].filter((note) => note !== null);
  const report = renderAskReport({ header, runs, ...(notes.length === 0 ? {} : { notes }) });

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
