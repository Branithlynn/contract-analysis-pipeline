// Scores a saved eval run again with the current scorer and the current deriveDates. No model is
// called, so a scorer fix doesn't cost another 25 minute ollama run.
// Usage: npm run eval:rescore -- evals/results/<name>.json
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@nexus/shared/node";
import { z } from "zod";
import { CASE_SUFFIX, expectedStatus, readCase } from "./cases.js";
import { renderReport, type CaseRun } from "./report.js";
import { SavedFileSchema, caseName, rescoreRun } from "./saved.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CASES_DIR = join(ROOT, "evals", "cases");
const USAGE = "usage: npm run eval:rescore -- <raw json of a saved run>";

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
  const saved = SavedFileSchema.safeParse(json);
  if (!saved.success) fail(`${arg} is not a saved run:\n${z.prettifyError(saved.error)}`);
  const { header, runs: savedRuns } = saved.data;

  // Only the threshold is read. It decides the low_grounding alert, nothing that the dates need.
  const threshold = loadConfig({
    GROUNDING_REVIEW_THRESHOLD: process.env.GROUNDING_REVIEW_THRESHOLD,
  }).GROUNDING_REVIEW_THRESHOLD;

  const runs: CaseRun[] = [];
  const expectedStatuses: string[] = [];
  for (const run of savedRuns) {
    const casePath = join(CASES_DIR, `${caseName(run.label)}${CASE_SUFFIX}`);
    if (!existsSync(casePath)) fail(`no case file for "${run.label}" (looked for ${casePath})`);
    let expected;
    try {
      expected = readCase(casePath);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
    runs.push(rescoreRun(run, expected, header.clock, threshold));
    expectedStatuses.push(expectedStatus(expected));
  }

  const report = renderReport({
    header,
    runs,
    expectedStatuses,
    notes: [
      `Rescored on ${localDate(new Date())} from ${basename(path)}. No model was called.`,
      "Scoring and the derived dates use the current code, with the clock above. The extraction itself is the saved one, so pipeline changes made after the run are not in here: the injection filter did not run on these results. Stored values, risks, the summary, needs review and the review reasons are what the pipeline produced back then. Rerun the eval to see those.",
    ],
  });

  const out = join(dirname(path), `${basename(path, ".json")}-rescored.md`);
  writeFileSync(out, report);
  console.log(report);
  console.error(`wrote ${out}`);
}

main();
