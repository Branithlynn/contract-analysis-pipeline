// Scoring for the ask eval: does an answer name the right contracts, carry the key facts, come
// from the right tool, and keep out what must not be in it. Pure, the runner in ask.ts does the io.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { dateAppearsIn, type AskCitation, type AskStep } from "@nexus/shared";
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
  // How an answer may name this contract besides its file name: the counterparty. Not a word for
  // the kind of document: the 7b said "the NDA" about the msa and its value, and "NDA" in this
  // list counted that as naming the nda.
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
  // The right answer is that there is no value, so any amount of money in the answer is wrong,
  // not only the one a must_not string spells out.
  // A bare 0 counts as an amount too: "the total value is 0" is a value, and a wrong one.
  must_not_money: z.boolean().optional(),
  // Words the answer has to have, matched as whole words, unlike the facts: "no" is not found in
  // "notice". For an answer that has to say that something is not there.
  expect_words: z.array(OneOf).optional(),
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

// What --cases takes: case ids, separated by commas, each one a full id or a glob over the ids
// (scoped-warranty, nda*, *-value). The cases come back in the order of the file, each once.
// Throws with a message meant for the terminal when a part matches nothing.
export function selectAskCases(cases: readonly AskCase[], pattern: string): AskCase[] {
  const parts = pattern
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length === 0) throw new Error("--cases is empty");
  const matchers = parts.map((part) => {
    const source = part
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replaceAll("*", ".*")
      .replaceAll("?", ".");
    return { part, test: new RegExp(`^${source}$`) };
  });
  for (const { part, test } of matchers) {
    if (!cases.some((c) => test.test(c.id))) {
      const ids = cases.map((c) => `  ${c.id}`).join("\n");
      throw new Error(`no case matches "${part}". Available cases:\n${ids}`);
    }
  }
  return cases.filter((c) => matchers.some(({ test }) => test.test(c.id)));
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
  // Markers whose source does not exist, like [chunk:err] or [chunk:0]: an id no tool returned.
  // They are in the total above as not verified.
  invented_citations: string[];
  // The must-not strings that are in the answer, and for a must_not_money case every amount.
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

// By its file name, by its counterparty, or by a verified citation that belongs to it. A citation
// with a quote that is not in the source does not count: it shows that the id was copied, not
// that the answer is about that contract. Names are matched as whole words.
function namesContract(
  contract: NamedContract,
  answer: string,
  citations: readonly AskCitation[],
): boolean {
  const cited = citations.some(
    (citation) => citation.status === "verified" && citation.file_name === contract.file,
  );
  return cited || [contract.file, ...contract.names].some((name) => sameText(name, answer));
}

const IsoDate = z.iso.date();

// A fact written as YYYY-MM-DD is a date, and an answer that quotes the contract has it the way
// the contract writes it: "31 August 2026". The same matcher the stated-date rule uses.
function hasFact(option: string, answer: string, text: string): boolean {
  if (text.includes(flat(option))) return true;
  return IsoDate.safeParse(option).success && dateAppearsIn(option, answer);
}

const CITATION = /\[(?:chunk|contract):[^\]]*\]/gi;
const NUMBER = String.raw`\d(?:[\d.,]*\d)?`;
const SCALE = String.raw`(?:\s?(?:million|billion|thousand|mn|bn|[mk])\b)?`;
const CURRENCY = "(?:USD|EUR|GBP|CHF|JPY|CAD|AUD|dollars?|euros?|pounds?)";
// One pattern, so "USD 2,400,000" is one amount and not also the bare number in it.
const MONEY = new RegExp(
  [
    // $2,400,000 and € 84.000
    String.raw`[$€£]\s?${NUMBER}${SCALE}`,
    // USD 5,000,000
    String.raw`\b${CURRENCY}\s?${NUMBER}${SCALE}`,
    // 84,000 EUR and 2.4 million dollars
    String.raw`\b${NUMBER}${SCALE}\s?${CURRENCY}\b`,
    // 5 million
    String.raw`\b${NUMBER}\s?(?:million|billion)\b`,
    // 2,400,000 without a currency
    String.raw`\b\d{1,3}(?:,\d{3})+\b`,
  ].join("|"),
  "gi",
);

// Every amount of money an answer states. The ids in citation markers are not part of the answer.
export function moneyIn(answer: string): string[] {
  const text = answer.replace(CITATION, " ");
  return [...new Set([...text.matchAll(MONEY)].map((m) => m[0].trim()))];
}

// A 0 that stands alone: not a digit of a number, a date, a clause number or a percentage.
const ZERO = /(?<![\w.,:-])0(?:\.0+)?(?![\w%]|[.,:-]\d)/;

// Whether an answer states zero as a value.
export function statesZero(answer: string): boolean {
  // "USD 0" is an amount already, not a second one.
  return ZERO.test(answer.replace(CITATION, " ").replace(MONEY, " "));
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
  const words = test.expect_words ?? [];
  const said = answer.replace(CITATION, " ");
  const missedFacts = [
    ...test.expect_facts.filter(
      (fact) => !options(fact).some((option) => hasFact(option, answer, text)),
    ),
    ...words.filter((word) => !options(word).some((option) => sameText(option, said))),
  ].map(label);

  // A call the step limit cut off did not run.
  const ran = outcome.steps.filter(
    (step) => step.tool !== LOOKUP_REMINDER_STEP.tool && step.result !== "not run",
  );
  const toolsUsed = [...new Set(ran.map((step) => step.tool))];
  const missedTools = test.expect_tools
    .filter((tool) => !options(tool).some((option) => toolsUsed.includes(option)))
    .map(label);

  const banned = test.must_not.filter((string) => text.includes(flat(string)));
  // An amount a must-not string already reports is not listed a second time.
  const stated =
    test.must_not_money === true ? [...moneyIn(answer), ...(statesZero(answer) ? ["0"] : [])] : [];
  const amounts = stated.filter(
    (amount) => !banned.some((string) => flat(amount).includes(flat(string))),
  );

  return {
    contracts: {
      correct: test.expect_contracts.length - missedContracts.length,
      total: test.expect_contracts.length,
    },
    missed_contracts: missedContracts,
    extra_contracts: named.filter((file) => !test.expect_contracts.includes(file)),
    facts: {
      correct: test.expect_facts.length + words.length - missedFacts.length,
      total: test.expect_facts.length + words.length,
    },
    missed_facts: missedFacts,
    tools_ok: missedTools.length === 0,
    missed_tools: missedTools,
    tools_used: toolsUsed,
    citations: {
      correct: outcome.citations.filter((citation) => citation.status === "verified").length,
      total: outcome.citations.length,
    },
    invented_citations: [
      ...new Set(
        outcome.citations
          .filter((citation) => citation.status === "not_found")
          .map((citation) => citation.marker),
      ),
    ],
    forbidden: [...banned, ...amounts],
    answered_without_lookup: outcome.status === "done" && ran.length === 0,
    nudges: outcome.steps.filter((step) => step.tool === LOOKUP_REMINDER_STEP.tool).length,
  };
}

// A case passes when there is an answer and nothing that is scored is off. Citations are reported
// as a rate, invented ones and extra contracts are listed, none of them counts here.
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
