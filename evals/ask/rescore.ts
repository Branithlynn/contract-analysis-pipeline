// Scores a saved ask eval run again with the current scorer and the current cases.json, and
// writes the report over the one next to it. No model is called, so a scorer fix doesn't cost
// another run on every provider.
// Usage: npm run eval:ask:rescore -- evals/results/<name>.json
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { caseName } from "../saved.js";
import { renderAskReport, type AskRun } from "./ask-report.js";
import { SavedAskFileSchema, rescoreAskRun } from "./ask-saved.js";
import { fileName, readAskCases, type AskCases, type NamedContract } from "./ask-score.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CASES = join(ROOT, "evals", "ask", "cases.json");
const USAGE = "usage: npm run eval:ask:rescore -- <raw json of a saved ask run>";

function fail(message: string): never {
  console.error(`${message}\n${USAGE}`);
  process.exit(1);
}

function localDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function main(): void {
  const [arg, ...rest] = process.argv.slice(2);
  if (arg === undefined || rest.length > 0) fail("expected one file");
  const path = resolve(arg);
  if (extname(path) !== ".json" || !existsSync(path)) fail(`${arg} is not a saved run (.json)`);

  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    fail(`${arg} is not valid json: ${err instanceof Error ? err.message : String(err)}`);
  }
  const saved = SavedAskFileSchema.safeParse(json);
  if (!saved.success) fail(`${arg} is not a saved ask run:\n${z.prettifyError(saved.error)}`);

  let cases: AskCases;
  try {
    cases = readAskCases(CASES);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  const corpus: NamedContract[] = cases.corpus.map((entry) => ({
    file: fileName(entry.file),
    names: entry.names,
  }));

  const runs: AskRun[] = [];
  for (const run of saved.data.runs) {
    const test = cases.cases.find((c) => c.id === caseName(run.label));
    if (test === undefined) fail(`no case "${caseName(run.label)}" in evals/ask/cases.json`);
    // The saved answer is to the saved question. Scored against another one it would mean nothing.
    if (test.question !== run.question) {
      fail(`the question of "${test.id}" is not the one this run asked: ${run.question}`);
    }
    runs.push(rescoreAskRun(run, test, corpus));
  }

  const report = renderAskReport({
    header: saved.data.header,
    runs,
    notes: [
      `Rescored on ${localDate(new Date())} from ${basename(path)}. No model was called.`,
      "The scoring and the cases are the current ones. The answers, the citations with their status, the steps, the model calls and the tokens are what the run saved, so agent changes made after the run are not in here. The json keeps the score of the run.",
    ],
  });

  const out = join(dirname(path), `${basename(path, ".json")}.md`);
  writeFileSync(out, report);
  console.log(report);
  console.error(`wrote ${out}`);
}

main();
