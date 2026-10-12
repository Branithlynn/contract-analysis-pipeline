// Turns scored runs into the markdown report. Pure, so the layout can be tested without a model.
import { casePassed, rate, type CaseScore, type Ratio } from "./score.js";

// One provider call. The same shape the worker records, repeated here so the report stays free of
// worker imports.
export interface CallInfo {
  kind: "extract" | "repair" | "retry" | "summary";
  // 0-based, null for the summary.
  chunkIndex: number | null;
  ok: boolean;
  durationMs: number;
  usage: { inputTokens: number; outputTokens: number };
  // Null for providers without a context size (everything but ollama).
  numCtx: number | null;
  // How long ollama needed to get the model ready for this call. Missing in runs saved before it
  // was recorded, null for providers that do not report it.
  loadMs?: number | null | undefined;
  // The model's reply as it came back. Missing in runs saved before it was recorded, null when
  // the call failed without a reply. Stays in the json, the report does not print it.
  rawText?: string | null | undefined;
}

export interface RunMeta {
  chunks: number;
  inputTokens: number;
  outputTokens: number;
  // Missing in runs saved before calls were recorded.
  calls?: CallInfo[] | undefined;
}

export interface CaseRun {
  // Case name, with " #2" and so on when --repeat is above 1.
  label: string;
  status: string;
  error_code: string | null;
  error_message: string | null;
  // Wall clock for the whole case, also when it failed.
  latency_ms: number;
  // Null when the document failed before an extraction existed.
  meta: RunMeta | null;
  score: CaseScore;
}

export interface ReportHeader {
  provider: string;
  model: string;
  prompt_version: string;
  // The day the eval ran.
  date: string;
  // The fixed "today" the derived dates were computed against.
  clock: string;
  cpu: string;
  repeat: number;
}

const NONE = "-";

function ratio(r: Ratio): string {
  return r.total === 0 ? NONE : `${String(r.correct)}/${String(r.total)}`;
}

function percent(r: Ratio): string {
  const value = rate(r);
  return value === null ? NONE : `${ratio(r)} (${String(Math.round(value * 100))}%)`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function show(value: unknown): string {
  return value === undefined ? "nothing" : JSON.stringify(value);
}

function sum(runs: readonly CaseRun[], pick: (score: CaseScore) => Ratio): Ratio {
  return runs.reduce(
    (total, run) => ({
      correct: total.correct + pick(run.score).correct,
      total: total.total + pick(run.score).total,
    }),
    { correct: 0, total: 0 },
  );
}

// Nearest rank, so the value is always one that was really measured.
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length / 2) - 1] ?? 0;
}

function table(headers: string[], rows: string[][]): string[] {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ];
}

function injection(score: CaseScore): string {
  return score.injection_passed === null ? NONE : score.injection_passed ? "pass" : "FAIL";
}

function caseRow(run: CaseRun): string[] {
  const { score, meta } = run;
  return [
    run.label,
    ratio(score.field_accuracy),
    ratio(score.null_precision),
    ratio(score.risk_recall),
    String(score.false_alarms.length),
    ratio(score.derived_accuracy),
    injection(score),
    score.grounding_score === null ? NONE : score.grounding_score.toFixed(2),
    run.status === "completed" ? (score.needs_review ? "yes" : "no") : NONE,
    meta === null ? NONE : String(meta.chunks),
    seconds(run.latency_ms),
    meta === null ? NONE : `${String(meta.inputTokens)} / ${String(meta.outputTokens)}`,
    casePassed(score) ? "pass" : "FAIL",
  ];
}

export function mismatches(run: CaseRun, expectedStatus: string): string[] {
  const { score, label } = run;
  const lines: string[] = [];
  if (!score.status_ok) {
    const got = run.error_code === null ? run.status : `${run.status} ${run.error_code}`;
    const why = run.error_message === null ? "" : ` (${run.error_message})`;
    lines.push(`${label}.status: expected ${expectedStatus}, got ${got}${why}`);
  }
  for (const miss of score.wrong_fields) {
    lines.push(`${label}.${miss.field}: expected ${show(miss.expected)}, got ${show(miss.actual)}`);
  }
  for (const field of score.not_null) {
    lines.push(`${label}.${field}: expected null, got a value`);
  }
  for (const category of score.missed_risks) {
    lines.push(`${label}.risk_categories: expected ${category}, not reported`);
  }
  for (const category of score.false_alarms) {
    lines.push(`${label}.risk_categories: expected no ${category}, got one`);
  }
  for (const miss of score.wrong_derived) {
    lines.push(
      `${label}.derived.${miss.key}: expected ${show(miss.expected)}, got ${show(miss.actual)}`,
    );
  }
  if (score.injection_passed === false) {
    lines.push(
      `${label}.injection: expected the injected amount to be ignored, got it in the result`,
    );
  }
  if (score.needs_review_ok === false) {
    lines.push(
      `${label}.needs_review: expected ${String(!score.needs_review)}, got ${String(score.needs_review)}`,
    );
  }
  for (const code of score.missing_alerts) {
    lines.push(`${label}.alerts: expected ${code}, not raised`);
  }
  return lines;
}

// A slow document is easier to explain call by call: a repair doubles the work, and a changed
// num_ctx makes ollama load the model again before it answers.
function callLines(runs: readonly CaseRun[]): string[] {
  const recorded = runs.filter((run) => run.meta?.calls !== undefined);
  if (recorded.length === 0) return ["Not recorded for this run."];

  const rows: string[][] = [];
  const changes: string[] = [];
  let previous: { numCtx: number; label: string } | null = null;
  for (const run of recorded) {
    for (const [i, call] of (run.meta?.calls ?? []).entries()) {
      rows.push([
        run.label,
        String(i + 1),
        call.ok ? call.kind : `${call.kind} (unusable reply)`,
        call.chunkIndex === null ? NONE : String(call.chunkIndex + 1),
        seconds(call.durationMs),
        `${String(call.usage.inputTokens)} / ${String(call.usage.outputTokens)}`,
        call.numCtx === null ? NONE : String(call.numCtx),
        call.loadMs === null || call.loadMs === undefined ? NONE : seconds(call.loadMs),
      ]);
      if (call.numCtx === null) continue;
      if (previous !== null && previous.numCtx !== call.numCtx) {
        const from =
          previous.label === run.label
            ? `the call before it in the same document used ${String(previous.numCtx)}`
            : `the last call of ${previous.label} used ${String(previous.numCtx)}`;
        changes.push(
          `- ${run.label}: call ${String(i + 1)} (${call.kind}) ran with num_ctx ${String(call.numCtx)}, ${from}`,
        );
      }
      previous = { numCtx: call.numCtx, label: run.label };
    }
  }

  const lines = table(
    ["case", "call", "kind", "chunk", "duration", "tokens in / out", "num_ctx", "model load"],
    rows,
  );
  lines.push("");
  if (previous === null) lines.push("This provider has no num_ctx.");
  else if (changes.length === 0) lines.push("num_ctx was the same for every call.");
  else {
    lines.push(
      "num_ctx changed between calls. Ollama reloads the model when num_ctx changes, so each of these calls includes a model load:",
      "",
      ...changes,
    );
  }
  return lines;
}

export interface ReportInput {
  header: ReportHeader;
  runs: readonly CaseRun[];
  // The status each run was expected to end in, e.g. "failed NO_TEXT_LAYER". Same order as runs.
  expectedStatuses: readonly string[];
  // Printed under the header, one paragraph each. A rescore says here what it did not rerun.
  notes?: readonly string[];
}

export function renderReport(input: ReportInput): string {
  const { header, runs, expectedStatuses } = input;
  const lines: string[] = [
    `# Eval: ${header.provider} / ${header.model}`,
    "",
    `- provider: ${header.provider}`,
    `- model: ${header.model}`,
    `- prompt version: ${header.prompt_version}`,
    `- date: ${header.date}`,
    `- clock for derived dates: ${header.clock}`,
    `- cpu: ${header.cpu}`,
    `- repeat: ${String(header.repeat)}`,
    "",
    ...(input.notes ?? []).flatMap((note) => [note, ""]),
    "## Cases",
    "",
    ...table(
      [
        "case",
        "field acc",
        "null precision",
        "risk recall",
        "false alarms",
        "derived acc",
        "injection",
        "grounding",
        "needs review",
        "chunks",
        "latency",
        "tokens in / out",
        "result",
      ],
      runs.map(caseRow),
    ),
    "",
    "## Totals",
    "",
  ];

  const injections = runs.filter((run) => run.score.injection_passed !== null);
  const latencies = runs.map((run) => run.latency_ms);
  const tokens = runs.reduce(
    (total, run) => ({
      input: total.input + (run.meta?.inputTokens ?? 0),
      output: total.output + (run.meta?.outputTokens ?? 0),
    }),
    { input: 0, output: 0 },
  );
  lines.push(
    `- cases passed: ${String(runs.filter((run) => casePassed(run.score)).length)}/${String(runs.length)}`,
    `- field accuracy: ${percent(sum(runs, (s) => s.field_accuracy))}`,
    `- null precision: ${percent(sum(runs, (s) => s.null_precision))}`,
    `- risk recall: ${percent(sum(runs, (s) => s.risk_recall))}`,
    `- false alarms: ${String(runs.reduce((n, run) => n + run.score.false_alarms.length, 0))}`,
    `- derived accuracy: ${percent(sum(runs, (s) => s.derived_accuracy))}`,
    `- injection passes: ${
      injections.length === 0
        ? NONE
        : `${String(injections.filter((run) => run.score.injection_passed).length)}/${String(injections.length)}`
    }`,
    `- latency: p50 ${seconds(median(latencies))}, max ${seconds(Math.max(0, ...latencies))}`,
    `- tokens: ${String(tokens.input)} in, ${String(tokens.output)} out`,
    "",
    "## Mismatches",
    "",
  );

  const missed = runs.flatMap((run, i) => mismatches(run, expectedStatuses[i] ?? "?"));
  lines.push(...(missed.length === 0 ? ["None."] : missed.map((line) => `- ${line}`)), "");

  const extras = runs.filter((run) => run.score.extra_risks.length > 0);
  lines.push("## Extra risks (listed, not scored)", "");
  lines.push(
    ...(extras.length === 0
      ? ["None."]
      : extras.map((run) => `- ${run.label}: ${run.score.extra_risks.join(", ")}`)),
    "",
  );

  const notes = runs.filter(
    (run) => run.score.review_reasons.length > 0 || run.score.conflicts.length > 0,
  );
  lines.push("## Review reasons and conflicts (recorded, not scored)", "");
  if (notes.length === 0) lines.push("None.");
  for (const run of notes) {
    for (const reason of run.score.review_reasons) lines.push(`- ${run.label}: review, ${reason}`);
    for (const field of run.score.conflicts) lines.push(`- ${run.label}: conflict on ${field}`);
  }
  lines.push("", "## Calls", "", ...callLines(runs), "");
  return lines.join("\n");
}
