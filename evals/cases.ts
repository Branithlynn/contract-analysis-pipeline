// Reading the hand-written expectations. Shared by the eval runner and the rescore script.
import { globSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { z } from "zod";
import { ExpectedCaseSchema, type ExpectedCase } from "./score.js";

export const CASE_SUFFIX = ".expected.json";
const CASES_GLOB = "evals/cases/*";

function caseFiles(glob: string, root: string): string[] {
  return globSync(glob, { cwd: root })
    .filter((file) => file.endsWith(CASE_SUFFIX))
    .sort();
}

// What --cases takes: a path glob from the repo root (evals/cases/saas*.expected.json), or just a
// case name or a glob over the names (mutual-nda, saas*). The path wins when both would match.
// Returns paths relative to root, sorted.
export function findCaseFiles(pattern: string, root: string): string[] {
  const byPath = caseFiles(pattern, root);
  // A pattern with a slash was meant as a path, so it is not tried as a name.
  if (byPath.length > 0 || /[\\/]/.test(pattern)) return byPath;
  return caseFiles(`${CASES_GLOB.slice(0, -1)}${pattern}${CASE_SUFFIX}`, root);
}

export function caseNames(root: string): string[] {
  return caseFiles(CASES_GLOB, root).map((file) => basename(file, CASE_SUFFIX));
}

// Throws with a message meant for the terminal.
export function readCase(path: string): ExpectedCase {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(
      `${path} could not be read: ${err instanceof Error ? err.message : String(err)}`,
      {
        cause: err,
      },
    );
  }
  const parsed = ExpectedCaseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`${path} is not a valid case:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export function expectedStatus(expected: ExpectedCase): string {
  return expected.expect_error_code === undefined
    ? expected.expect_status
    : `${expected.expect_status} ${expected.expect_error_code}`;
}
