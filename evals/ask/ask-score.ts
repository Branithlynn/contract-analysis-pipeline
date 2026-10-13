// Scoring for the ask eval: does an answer name the right contracts, carry the key facts, come
// from the right tool, and keep out what must not be in it. Pure, the runner in ask.ts does the io.
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { AskCitation, AskStep } from "@nexus/shared";
import { LOOKUP_REMINDER_STEP } from "../../services/api/src/ask/reminder.js";
import { sameText, type Ratio } from "../score.js";

// For something with more than one right form: "two years" or "24 months", find_contracts or
// get_contract.
const OneOf = z.union([
  z.string().min(1),
  z.strictObject({ any_of: z.array(z.string().min(1)).min(1) }),
]);
type OneOf = z.infer<typeof OneOf>;

const CorpusEntry = z.strictObject({
  // Paths from the repo root. The document that is indexed, and the extraction eval's expectation
  // for it, whose values become the stored extraction.
  file: z.string().min(1),
  expected: z.string().min(1),
  // How an answer may name this contract besides its file name: the vendor, mostly.
  names: z.array(z.string().min(1)),
});

const AskCaseSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(["structured", "semantic", "mixed", "scoped", "injection"]),
  question: z.string().min(1),
  // File name of a corpus document. The question is asked with its id as document_id.
  scope: z.string().min(1).optional(),
  // File names of the contracts the answer has to name or cite.
  expect_contracts: z.array(z.string().min(1)),
  // Text the answer has to contain, e.g. the date of the nearest notice deadline.
  expect_facts: z.array(OneOf),
  // Tools that have to be called. Others may be called too.
  expect_tools: z.array(OneOf),
  // Text the answer must not contain.
  must_not: z.array(z.string().min(1)),
});
export type AskCase = z.infer<typeof AskCaseSchema>;

export const AskCasesSchema = z
  .strictObject({
    corpus: z.array(CorpusEntry).min(1),
    cases: z.array(AskCaseSchema).min(1),
  })
  .superRefine((file, ctx) => {
    const names = new Set(file.corpus.map((entry) => fileName(entry.file)));
    const seen = new Set<string>();
    file.cases.forEach((test, i) => {
      if (seen.has(test.id)) {
        ctx.addIssue({ code: "custom", path: ["cases", i, "id"], message: "duplicate id" });
      }
      seen.add(test.id);
      const outside = [...test.expect_contracts, ...(test.scope === undefined ? [] : [test.scope])];
      for (const name of outside.filter((name) => !names.has(name))) {
        ctx.addIssue({
          code: "custom",
          path: ["cases", i],
          message: `${name} is not in the corpus`,
        });
      }
    });
  });
export type AskCases = z.infer<typeof AskCasesSchema>;

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

// Throws with a message meant for the terminal.
export function readAskCases(path: string): AskCases {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(
      `${path} could not be read: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  const parsed = AskCasesSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`${path} is not a valid ask eval:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

// How one question ended. timeout and error have no answer, and neither has step_limit.
export interface AskOutcome {
  status: "done" | "step_limit" | "timeout" | "error";
  answer: string | null;
  citations: readonly AskCitation[];
  steps: readonly AskStep[];
}

// A corpus document as the scoring knows it.
export interface NamedContract {
  file: string;
  names: readonly string[];
}

export interface AskScore {
  contracts: Ratio;
  missed_contracts: string[];
  // Corpus contracts the answer names that the case does not expect. Listed, not scored: an
  // answer may mention one to say that it does not match.
  extra_contracts: string[];
  facts: Ratio;
  missed_facts: string[];
  tools_ok: boolean;
  missed_tools: string[];
  // The tools that ran, in the order they were first called.
  tools_used: string[];
  // Verified citations out of all citations in the answer.
  citations: Ratio;
  // The must-not strings that are in the answer.
  forbidden: string[];
  // An answer that no tool call stands behind.
  answered_without_lookup: boolean;
  // How often the first reply was sent back with the lookup reminder: 0 or 1.
  nudges: number;
}

function flat(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function options(want: OneOf): string[] {
  return typeof want === "string" ? [want] : want.any_of;
}

function label(want: OneOf): string {
  return options(want).join(" or ");
}

// By its file name, by one of its other names, or by a citation that resolved to it. Names are
// matched as whole words, so "NDA" is not found in "standard".
function namesContract(
  contract: NamedContract,
  answer: string,
  citations: readonly AskCitation[],
): boolean {
  if (citations.some((citation) => citation.file_name === contract.file)) return true;
  return [contract.file, ...contract.names].some((name) => sameText(name, answer));
}

export function scoreAsk(
  test: AskCase,
  corpus: readonly NamedContract[],
  outcome: AskOutcome,
): AskScore {
  const answer = outcome.answer ?? "";
  const text = flat(answer);

  const named = corpus
    .filter((contract) => namesContract(contract, answer, outcome.citations))
    .map((contract) => contract.file);
  const missedContracts = test.expect_contracts.filter((file) => !named.includes(file));

  // Not whole words like the names: the "%" in "9%" is part of the fact.
  const missedFacts = test.expect_facts
    .filter((fact) => !options(fact).some((option) => text.includes(flat(option))))
    .map(label);

  // A call the step limit cut off did not run.
  const ran = outcome.steps.filter(
    (step) => step.tool !== LOOKUP_REMINDER_STEP.tool && step.result !== "not run",
  );
  const toolsUsed = [...new Set(ran.map((step) => step.tool))];
  const missedTools = test.expect_tools
    .filter((tool) => !options(tool).some((option) => toolsUsed.includes(option)))
    .map(label);

  return {
    contracts: {
      correct: test.expect_contracts.length - missedContracts.length,
      total: test.expect_contracts.length,
    },
    missed_contracts: missedContracts,
    extra_contracts: named.filter((file) => !test.expect_contracts.includes(file)),
    facts: {
      correct: test.expect_facts.length - missedFacts.length,
      total: test.expect_facts.length,
    },
    missed_facts: missedFacts,
    tools_ok: missedTools.length === 0,
    missed_tools: missedTools,
    tools_used: toolsUsed,
    citations: {
      correct: outcome.citations.filter((citation) => citation.status === "verified").length,
      total: outcome.citations.length,
    },
    forbidden: test.must_not.filter((banned) => text.includes(flat(banned))),
    answered_without_lookup: outcome.status === "done" && ran.length === 0,
    nudges: outcome.steps.filter((step) => step.tool === LOOKUP_REMINDER_STEP.tool).length,
  };
}

// A case passes when there is an answer and nothing that is scored is off. Citations are reported
// as a rate and extra contracts are listed, neither counts here.
export function askPassed(status: AskOutcome["status"], score: AskScore): boolean {
  return (
    status === "done" &&
    score.missed_contracts.length === 0 &&
    score.missed_facts.length === 0 &&
    score.tools_ok &&
    score.forbidden.length === 0 &&
    !score.answered_without_lookup
  );
}
