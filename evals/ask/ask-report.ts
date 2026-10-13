// Turns an ask eval run into the markdown report. Pure, so the layout can be tested without a
// model. Same style as the extraction report in ../report.ts.
import type { AskCitation, AskStep } from "@nexus/shared";
import { CODE_LOOKUP_NOTE } from "../../services/api/src/ask/reminder.js";
import type { Ratio } from "../score.js";
import { askPassed, type AskOutcome, type AskScore } from "./ask-score.js";

export interface AskHeader {
  provider: string;
  model: string;
  prompt_version: string;
  embed_provider: string;
  embed_model: string;
  // The day the eval ran.
  date: string;
  // The fixed "today" the notice deadlines were computed against.
  clock: string;
  cpu: string;
  repeat: number;
  // ASK_MAX_STEPS and ASK_TIMEOUT_MS of the run.
  max_steps: number;
  timeout_ms: number;
}

export interface AskRun {
  // Case id, with " #2" and so on when --repeat is above 1.
  label: string;
  kind: string;
  question: string;
  status: AskOutcome["status"];
  // Why a run ended in "error".
  error_message: string | null;
  answer: string | null;
  citations: AskCitation[];
  // The trace: tool calls and the lookup reminder, as the chat shows them.
  steps: AskStep[];
  // How often the model was called, which is what ASK_MAX_STEPS counts.
  model_calls: number;
  // Wall clock for the whole question, also when it failed.
  latency_ms: number;
  // Null when the provider reported no usage (the mock).
  tokens: { input: number; output: number } | null;
  score: AskScore;
}

export interface AskReportInput {
  header: AskHeader;
  runs: readonly AskRun[];
  // Printed under the header, one paragraph each.
  notes?: readonly string[];
}

const NONE = "-";

function table(headers: string[], rows: string[][]): string[] {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ];
}

function ratio(r: Ratio): string {
  return r.total === 0 ? NONE : `${String(r.correct)}/${String(r.total)}`;
}

function percent(r: Ratio): string {
  if (r.total === 0) return NONE;
  return `${ratio(r)} (${String(Math.round((r.correct / r.total) * 100))}%)`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

// Nearest rank, so the value is always one that was really measured.
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length / 2) - 1] ?? 0;
}

function sum(runs: readonly AskRun[], pick: (score: AskScore) => Ratio): Ratio {
  return runs.reduce(
    (total, run) => ({
      correct: total.correct + pick(run.score).correct,
      total: total.total + pick(run.score).total,
    }),
    { correct: 0, total: 0 },
  );
}

// Table cells and list lines: no pipes and no line breaks.
function cell(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").replace(/\|/g, "/").trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
}

function result(run: AskRun): string {
  if (run.status !== "done") return `FAIL (${run.status})`;
  return askPassed(run.status, run.score) ? "pass" : "FAIL";
}

function caseRow(run: AskRun): string[] {
  const { score } = run;
  const answered = run.status === "done";
  return [
    run.label,
    run.kind,
    ratio(score.contracts),
    ratio(score.facts),
    score.tools_ok ? "ok" : "WRONG",
    percent(score.citations),
    answered ? (score.answered_without_lookup ? "YES" : "no") : NONE,
    String(score.nudges),
    String(run.model_calls),
    seconds(run.latency_ms),
    run.tokens === null ? NONE : `${String(run.tokens.input)} / ${String(run.tokens.output)}`,
    result(run),
  ];
}

export function askMismatches(run: AskRun): string[] {
  const { score, label } = run;
  const lines: string[] = [];
  if (run.status !== "done") {
    const why = run.error_message === null ? "" : ` (${cell(run.error_message, 200)})`;
    lines.push(`${label}.status: expected an answer, got ${run.status}${why}`);
  }
  for (const file of score.missed_contracts) {
    lines.push(`${label}.contracts: expected ${file}, not named or cited`);
  }
  for (const fact of score.missed_facts) {
    lines.push(`${label}.facts: expected ${JSON.stringify(fact)}, not in the answer`);
  }
  for (const tool of score.missed_tools) {
    const used = score.tools_used.length === 0 ? "none" : score.tools_used.join(", ");
    lines.push(`${label}.tools: expected ${tool}, used ${used}`);
  }
  for (const banned of score.forbidden) {
    lines.push(`${label}.must_not: ${JSON.stringify(banned)} is in the answer`);
  }
  for (const marker of score.invented_citations) {
    lines.push(`${label}.citations: ${marker} is invented, no tool returned that id`);
  }
  if (score.answered_without_lookup) {
    lines.push(`${label}.lookup: answered without calling a tool`);
  }
  return lines;
}

export function renderAskReport(input: AskReportInput): string {
  const { header, runs } = input;
  const latencies = runs.map((run) => run.latency_ms);
  const metered = runs.filter((run) => run.tokens !== null);
  const tokens = metered.reduce(
    (total, run) => ({
      input: total.input + (run.tokens?.input ?? 0),
      output: total.output + (run.tokens?.output ?? 0),
    }),
    { input: 0, output: 0 },
  );
  const answered = runs.filter((run) => run.status === "done");
  const toolsOk = runs.filter((run) => run.score.tools_ok).length;

  const lines: string[] = [
    `# Ask eval: ${header.provider} / ${header.model}`,
    "",
    `- provider: ${header.provider}`,
    `- model: ${header.model}`,
    `- prompt version: ${header.prompt_version}`,
    `- embeddings: ${header.embed_provider} / ${header.embed_model}`,
    `- date: ${header.date}`,
    `- clock for notice deadlines: ${header.clock}`,
    `- cpu: ${header.cpu}`,
    `- repeat: ${String(header.repeat)}`,
    `- limits per question: ${String(header.max_steps)} model calls, ${seconds(header.timeout_ms)}`,
    "",
    ...(input.notes ?? []).flatMap((note) => [note, ""]),
    "## Cases",
    "",
    ...table(
      [
        "case",
        "kind",
        "contracts",
        "facts",
        "tools",
        "citations verified",
        "no lookup",
        "nudges",
        "steps",
        "latency",
        "tokens in / out",
        "result",
      ],
      runs.map(caseRow),
    ),
    "",
    "Steps are model calls. A contract counts when the answer has its file name or its counterparty, or a verified citation of it. Citations, invented ones included, and extra contracts are reported, they do not decide the result.",
    "",
    "## Totals",
    "",
    `- cases passed: ${String(runs.filter((run) => askPassed(run.status, run.score)).length)}/${String(runs.length)}`,
    `- answered: ${String(answered.length)}/${String(runs.length)}`,
    `- expected contracts found: ${percent(sum(runs, (s) => s.contracts))}`,
    `- key facts found: ${percent(sum(runs, (s) => s.facts))}`,
    `- tool choice right: ${percent({ correct: toolsOk, total: runs.length })}`,
    `- citations verified: ${percent(sum(runs, (s) => s.citations))}`,
    `- invented citations: ${String(runs.reduce((n, run) => n + run.score.invented_citations.length, 0))} (should be 0)`,
    `- must-not strings in answers: ${String(runs.reduce((n, run) => n + run.score.forbidden.length, 0))}`,
    `- answered without lookup: ${String(runs.filter((run) => run.score.answered_without_lookup).length)} (should be 0)`,
    `- lookup reminders used: ${String(runs.reduce((n, run) => n + run.score.nudges, 0))}`,
    // Counted as the tool they ran, so a case can pass its tool check on a search the model
    // never asked for. This line says how often.
    `- searches made by the agent, not asked for by the model: ${String(runs.reduce((n, run) => n + run.steps.filter((step) => step.result.startsWith(CODE_LOOKUP_NOTE)).length, 0))}`,
    `- steps: ${String(runs.reduce((n, run) => n + run.model_calls, 0))} model calls, p50 ${String(median(runs.map((run) => run.model_calls)))} per question`,
    `- latency: p50 ${seconds(median(latencies))}, max ${seconds(Math.max(0, ...latencies))}`,
    `- tokens: ${metered.length === 0 ? "not reported by this provider" : `${String(tokens.input)} in, ${String(tokens.output)} out`}`,
    "",
    "## Mismatches",
    "",
  ];

  const missed = runs.flatMap(askMismatches);
  lines.push(...(missed.length === 0 ? ["None."] : missed.map((line) => `- ${line}`)), "");

  const extras = runs.filter((run) => run.score.extra_contracts.length > 0);
  lines.push("## Other contracts named (listed, not scored)", "");
  lines.push(
    ...(extras.length === 0
      ? ["None."]
      : extras.map((run) => `- ${run.label}: ${run.score.extra_contracts.join(", ")}`)),
    "",
  );

  lines.push("## Answers", "");
  for (const run of runs) {
    const tools = run.score.tools_used.length === 0 ? "no tool" : run.score.tools_used.join(", ");
    lines.push(
      `- ${run.label} (${tools}): ${run.answer === null ? `no answer, ${run.status}` : cell(run.answer, 400)}`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
