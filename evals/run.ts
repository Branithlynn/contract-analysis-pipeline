// Runs the extraction pipeline over the generated samples and scores each one against its
// hand-written expectation. No queue and no db: this measures extraction quality, not infra.
// Usage: npm run eval -- --provider <p> --model <m> [--cases <name or glob>] [--repeat <n>]
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { MIME_FORMATS } from "@nexus/shared";
import { createLogger, loadConfig } from "@nexus/shared/node";
import { llmEnvFromArgs } from "../scripts/lib/llm-env.js";
import { createProvider } from "../services/worker/src/llm/factory.js";
import { PROMPT_VERSION } from "../services/worker/src/llm/prompts/extract.v1.js";
import { analyzeDocument, type AnalyzeDeps } from "../services/worker/src/pipeline/analyze.js";
import { classifyError } from "../services/worker/src/pipeline/errors.js";
import { CASE_SUFFIX, caseNames, expectedStatus, findCaseFiles, readCase } from "./cases.js";
import { renderReport, type CaseRun, type ReportHeader } from "./report.js";
import { scoreCase, type CaseOutcome, type ExpectedCase } from "./score.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const RESULTS_DIR = join(ROOT, "evals", "results");
const DEFAULT_CASES = "evals/cases/*.expected.json";
// Derived dates depend on today. A fixed day keeps a run from last week comparable with one from
// today, and it is the day the expected dates were worked out for.
const CLOCK = "2026-10-09";

const USAGE =
  "usage: npm run eval -- [--provider ollama|anthropic|openai|mock] [--model <name>] [--cases <name or glob>] [--repeat <n>]";

function fail(message: string): never {
  console.error(`${message}\n${USAGE}`);
  process.exit(1);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface LoadedCase {
  name: string;
  expected: ExpectedCase;
}

function loadCases(pattern: string): LoadedCase[] {
  const files = findCaseFiles(pattern, ROOT);
  if (files.length === 0) {
    const names = caseNames(ROOT).map((name) => `  ${name}`);
    fail(`no case matches "${pattern}". Available cases:\n${names.join("\n")}`);
  }
  return files.map((file) => {
    try {
      return { name: basename(file, CASE_SUFFIX), expected: readCase(join(ROOT, file)) };
    } catch (err) {
      return fail(message(err));
    }
  });
}

function mimeFor(file: string): string {
  const ext = extname(file).slice(1).toLowerCase();
  for (const [mime, format] of MIME_FORMATS) if (format === ext) return mime;
  return fail(`${file}: unsupported extension ".${ext}"`);
}

// The stored result goes into the raw json only, for looking up why a case scored the way it did.
interface RawRun extends CaseRun {
  result: CaseOutcome["result"];
}

async function runCase(test: LoadedCase, label: string, deps: AnalyzeDeps): Promise<RawRun> {
  const { expected } = test;
  const started = performance.now();
  let outcome: CaseOutcome;
  let errorMessage: string | null = null;
  let meta: CaseRun["meta"] = null;
  try {
    const analysis = await analyzeDocument(
      {
        // Absolute, so resolving it against UPLOAD_DIR leaves it alone.
        path: resolve(ROOT, expected.file),
        mime: mimeFor(expected.file),
        filename: basename(expected.file),
      },
      deps,
    );
    outcome = {
      status: "completed",
      error_code: null,
      needs_review: analysis.needsReview,
      result: analysis.result,
    };
    meta = {
      chunks: analysis.meta.chunkCount,
      inputTokens: analysis.meta.tokens.inputTokens,
      outputTokens: analysis.meta.tokens.outputTokens,
      calls: analysis.meta.calls,
    };
  } catch (err) {
    // The same classification the job runner stores on a failed document. One bad case must not
    // stop the rest of the run.
    const classified = classifyError(err);
    errorMessage = classified.message;
    outcome = { status: "failed", error_code: classified.code, needs_review: false, result: null };
  }
  return {
    label,
    status: outcome.status,
    error_code: outcome.error_code,
    error_message: errorMessage,
    latency_ms: Math.round(performance.now() - started),
    meta,
    score: scoreCase(expected, outcome),
    result: outcome.result,
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
  const { values } = parseArgs({
    options: {
      provider: { type: "string" },
      model: { type: "string" },
      cases: { type: "string", default: DEFAULT_CASES },
      repeat: { type: "string", default: "1" },
    },
  });
  const repeat = Number(values.repeat);
  if (!Number.isInteger(repeat) || repeat < 1) fail(`--repeat must be a positive whole number`);

  let env: Record<string, string | undefined>;
  try {
    env = llmEnvFromArgs(values);
  } catch (err) {
    fail(message(err));
  }
  // loadConfig's error lists field paths and problems, never the values, so keys can't leak here.
  const config = loadConfig(env);
  const cases = loadCases(values.cases);

  const provider = createProvider(config);
  const deps: AnalyzeDeps = {
    config,
    // Errors only: the report is what this prints, per-chunk info lines would bury it.
    logger: createLogger("eval", "error"),
    provider,
    clock: () => new Date(`${CLOCK}T12:00:00Z`),
  };

  const runs: RawRun[] = [];
  const expectedStatuses: string[] = [];
  try {
    for (const test of cases) {
      for (let attempt = 1; attempt <= repeat; attempt++) {
        const label = repeat === 1 ? test.name : `${test.name} #${String(attempt)}`;
        console.error(`running ${label}`);
        runs.push(await runCase(test, label, deps));
        expectedStatuses.push(expectedStatus(test.expected));
      }
    }
  } finally {
    await provider.close?.();
  }

  const now = new Date();
  const cpu = cpus();
  const header: ReportHeader = {
    provider: provider.name,
    model: provider.model,
    prompt_version: PROMPT_VERSION,
    date: localDate(now),
    clock: CLOCK,
    cpu: `${cpu[0]?.model.trim() ?? "unknown"} (${String(cpu.length)} threads)`,
    repeat,
  };
  const report = renderReport({ header, runs, expectedStatuses });

  // With the time, so a partial --cases run later the same day never replaces a full one.
  const name = [header.date, localTime(now), header.provider, header.model, header.prompt_version]
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
}

await main();
