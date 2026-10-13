import type { FastifyBaseLogger } from "fastify";
import { tool } from "langchain";
import { z } from "zod";
import {
  ExtractedFieldName,
  RiskCategory,
  type ExtractionResult,
  type Severity,
} from "@nexus/shared";
import {
  getDocument,
  getExtraction,
  hybridSearchRetrievalChunks,
  keywordSearchRetrievalChunks,
  listCompletedForExport,
  LlmError,
  type ChunkHit,
  type Db,
  type Embedder,
} from "@nexus/shared/node";
import { readStoredResult, type ReadContext } from "../services/dto.js";
import type { AskToolDescriptions } from "./prompt.js";

// The three things the agent can do. All of them only read, and all of them answer from what the
// pipeline already stored: the extractions with their dates computed in code, and the search index.

export interface AskToolDeps {
  db: Db;
  embedder: Embedder;
  log: FastifyBaseLogger;
  // Today and the grounding threshold, for the derived dates and alerts.
  context: ReadContext;
  // The chat was opened from this contract. Every search is limited to it, whatever the model
  // passes: on a long register a short contract's clause would otherwise not show up.
  documentId?: string | undefined;
  // What the model reads about each tool. They belong to the prompt version.
  descriptions: AskToolDescriptions;
}

// One short text, the same limit GET /api/search uses.
const QUERY_EMBED_TIMEOUT_MS = 30_000;
const MAX_CONTRACTS = 20;
const DEFAULT_K = 4;
const MAX_K = 6;
export const MAX_QUERY_CHARS = 500;
// What the tools of one question may return in total, about 6k tokens. A local model has a small
// context and ollama drops the start of a prompt that does not fit, without an error. A tool that
// is called after the budget is used up says so instead of returning text.
export const TOOL_RESULT_BUDGET_CHARS = 18_000;

const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

// Everything a tool returns is data from documents, so it goes to the model inside a <document>
// block, which the system prompt declares untrusted. A closing tag in the data would end the
// block early.
// note: what the tool itself has to say to the model about the result. It comes after the block,
// because the system prompt tells the model not to act on anything inside it.
export function wrapToolResult(payload: unknown, note?: string): string {
  const json = JSON.stringify(payload).replace(/<(\/?)document/gi, "<$1 document");
  const block = `<document>\n${json}\n</document>`;
  return note === undefined ? block : `${block}\n${note}`;
}

const Summarized = z.object({ summary: z.string() });
// The data cannot hold a closing tag, so the first one ends the block.
const BLOCK = /^<document>\n([\s\S]*?)\n<\/document>/;

// The one line the trace shows for a tool result.
export function summaryOf(toolResult: string): string {
  try {
    const parsed = Summarized.safeParse(JSON.parse(BLOCK.exec(toolResult)?.[1] ?? ""));
    if (parsed.success) return parsed.data.summary;
  } catch {
    // Not one of ours: a call that did not run, see prepareToolArgs.
  }
  return toolResult.slice(0, 200);
}

const IsoDate = z.iso.date();

// Loose on purpose: small local models send null or leave fields out for filters they don't use.
const Filters = z.object({
  auto_renewal: z.boolean().nullish().describe("true: only contracts that renew automatically"),
  notice_deadline_before: IsoDate.nullish().describe(
    "last day to give notice is on or before this date (YYYY-MM-DD)",
  ),
  notice_deadline_after: IsoDate.nullish().describe("on or after this date (YYYY-MM-DD)"),
  expires_before: IsoDate.nullish().describe(
    "the current term ends on or before this date (YYYY-MM-DD)",
  ),
  expires_after: IsoDate.nullish().describe("on or after this date (YYYY-MM-DD)"),
  min_value: z.number().nullish().describe("total contract value at least this amount"),
  max_value: z.number().nullish().describe("total contract value at most this amount"),
  currency: z
    .string()
    .nullish()
    .describe("ISO code like USD. Give it with min_value or max_value, amounts are not converted"),
  governing_law: z.string().nullish().describe("part of the governing law, e.g. England"),
  risk_category: RiskCategory.nullish().describe("has a risk clause of this category"),
  needs_review: z.boolean().nullish().describe("true: only contracts flagged for human review"),
});
type Filters = z.infer<typeof Filters>;

const SearchArgs = z.object({
  query: z.string().min(1).max(MAX_QUERY_CHARS).describe("contract wording to look for"),
  k: z
    .number()
    .int()
    .nullish()
    .describe(`how many passages, 1 to ${String(MAX_K)}, default ${String(DEFAULT_K)}`),
  document_id: z.string().nullish().describe("only search this contract"),
});

const ContractArgs = z.object({
  id: z.string().min(1).describe("contract id from find_contracts"),
});

const ARGS: Record<string, z.ZodObject> = {
  find_contracts: Filters,
  search_clauses: SearchArgs,
  get_contract: ContractArgs,
};

const DATE = "a date written as YYYY-MM-DD";
const TRUE_OR_FALSE = "true or false";
// What each argument takes, in the words of the message a model gets for a wrong one.
const ALLOWED: Record<string, string> = {
  auto_renewal: TRUE_OR_FALSE,
  needs_review: TRUE_OR_FALSE,
  notice_deadline_before: DATE,
  notice_deadline_after: DATE,
  expires_before: DATE,
  expires_after: DATE,
  min_value: "a number like 1000000",
  max_value: "a number like 1000000",
  currency: "an ISO code like USD",
  governing_law: "text like England",
  risk_category: `one of ${RiskCategory.options.join(", ")}`,
  query: `text of 1 to ${String(MAX_QUERY_CHARS)} characters`,
  k: `a whole number from 1 to ${String(MAX_K)}`,
  document_id: "a contract id from find_contracts",
  id: "a contract id from find_contracts",
};

const NUMBERS = new Set(["min_value", "max_value", "k"]);
const BOOLEANS = new Set(["auto_renewal", "needs_review"]);

// Values a small model sends that say what it means in the wrong type: "1000000" for a number,
// "true" for a boolean, "" for a filter it does not use. The schema the model is shown stays
// strict, these are taken as what they mean.
function lenient(key: string, value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (text === "" && key !== "query" && key !== "id") return null;
  const digits = text.replaceAll(",", "");
  if (NUMBERS.has(key) && /^\d+(\.\d+)?$/.test(digits)) return Number(digits);
  if (BOOLEANS.has(key) && /^(true|false)$/i.test(text)) return text.toLowerCase() === "true";
  return value;
}

export type PreparedArgs =
  | { ok: true; args: Record<string, unknown> }
  // message: what the model gets instead of a result.
  | { ok: false; message: string };

// Checks the arguments of a tool call before the tool runs. langchain would do it too, and answer
// a wrong one with the zod error and the stack of where it was thrown. The 7b read that for
// {"auto_renewal": {"type": "boolean", "value": true}} and answered that no contract renews. So
// the message is written here: which argument, what it takes, what was sent. Short enough that
// the model fixes the call and tries again within the step limit.
// Not inside a <document> block: it is from the tool, not from a contract, and the model is
// meant to act on it.
export function prepareToolArgs(tool: string, raw: unknown): PreparedArgs {
  const given: Record<string, unknown> =
    typeof raw === "object" && raw !== null && !Array.isArray(raw) ? { ...raw } : {};
  const schema = ARGS[tool];
  // Not one of ours. langchain tells the model which tools there are.
  if (schema === undefined) return { ok: true, args: given };
  const args = Object.fromEntries(
    Object.entries(given).map(([key, value]) => [key, lenient(key, value)]),
  );
  const parsed = schema.safeParse(args);
  if (parsed.success) return { ok: true, args };

  const wrong = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "")))];
  const problems = wrong.map((key) => {
    const allowed = ALLOWED[key];
    if (allowed === undefined) return "The arguments have to be one json object.";
    const sent = args[key];
    if (sent === undefined) return `${key} is required: ${allowed}.`;
    const nested =
      typeof sent === "object" && sent !== null
        ? ` Send the value itself, not an object that describes it: {"${key}": ...}.`
        : "";
    return `${key} has to be ${allowed}, you sent ${JSON.stringify(sent).slice(0, 80)}.${nested}`;
  });
  return {
    ok: false,
    message: `${tool} did not run, wrong arguments. ${problems.join(" ")} Fix this and call ${tool} again.`,
  };
}

// The filters a call set, as "key=value", for the reply to a search that matched nothing.
function applied(f: Filters): string[] {
  return Object.entries(f)
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => `${key}=${String(value)}`);
}

export interface ContractRow {
  id: string;
  file_name: string;
  needs_review: boolean;
  result: ExtractionResult;
}

// The end of the term the contract is in today, which is what "expires" means for one that renews.
function termEnd(result: ExtractionResult): string | null {
  return result.derived.current_term_end ?? result.derived.expiration_date;
}

// A filter on a value the contract does not have excludes it: "expires before June" should not
// list contracts whose end date nobody found.
function matches(row: ContractRow, f: Filters): boolean {
  const { result } = row;
  const between = (value: string | null, after?: string | null, before?: string | null) => {
    if (after == null && before == null) return true;
    if (value === null) return false;
    return (after == null || value >= after) && (before == null || value <= before);
  };
  if (f.auto_renewal != null && result.auto_renewal.value !== f.auto_renewal) return false;
  if (!between(result.derived.notice_deadline, f.notice_deadline_after, f.notice_deadline_before))
    return false;
  if (!between(termEnd(result), f.expires_after, f.expires_before)) return false;
  if (f.min_value != null || f.max_value != null || f.currency != null) {
    const money = result.total_contract_value.value;
    if (money === null) return false;
    if (f.currency != null && money.currency !== f.currency.trim().toUpperCase()) return false;
    if (f.min_value != null && money.amount < f.min_value) return false;
    if (f.max_value != null && money.amount > f.max_value) return false;
  }
  if (f.governing_law != null && f.governing_law.trim() !== "") {
    const law = result.governing_law.value?.toLowerCase() ?? "";
    if (!law.includes(f.governing_law.trim().toLowerCase())) return false;
  }
  if (f.risk_category != null && !result.risk_clauses.some((r) => r.category === f.risk_category))
    return false;
  if (f.needs_review != null && row.needs_review !== f.needs_review) return false;
  return true;
}

function maxSeverity(result: ExtractionResult): Severity | null {
  let max: Severity | null = null;
  for (const clause of result.risk_clauses) {
    if (max === null || SEVERITY_RANK[clause.severity] > SEVERITY_RANK[max]) max = clause.severity;
  }
  return max;
}

function keyFields(row: ContractRow) {
  const { result } = row;
  return {
    id: row.id,
    file_name: row.file_name,
    document_type: result.document_type.value,
    vendor_name: result.vendor_name.value,
    total_contract_value: result.total_contract_value.value,
    auto_renewal: result.auto_renewal.value,
    // The end of the term the contract is in today.
    current_term_end: termEnd(result),
    notice_deadline: result.derived.notice_deadline,
    days_until_notice_deadline: result.derived.days_until_notice_deadline,
    governing_law: result.governing_law.value,
    risk_categories: [...new Set(result.risk_clauses.map((r) => r.category))],
    max_risk_severity: maxSeverity(result),
    needs_review: row.needs_review,
  };
}

// Soonest notice deadline first, contracts without one last. Sorted here so that "which one is
// due first" is reading the first row and not something a small model has to work out from dates.
// A deadline that has passed sorts before the upcoming ones, which is where a reader wants it.
function byNoticeDeadline(a: ContractRow, b: ContractRow): number {
  const left = a.result.derived.notice_deadline;
  const right = b.result.derived.notice_deadline;
  if (left === right) return a.file_name.localeCompare(b.file_name);
  if (left === null) return 1;
  if (right === null) return -1;
  return left < right ? -1 : 1;
}

// The answer to the most common question, spelled out: the next deadline that can still be met.
function nearestNoticeDeadline(sorted: readonly ContractRow[]): string {
  const next = sorted.find((row) => (row.result.derived.days_until_notice_deadline ?? -1) >= 0);
  if (next === undefined) return "nearest notice deadline: none upcoming among these contracts";
  const { notice_deadline: date, days_until_notice_deadline: days } = next.result.derived;
  return `nearest notice deadline: ${String(date)} (in ${String(days)} days), ${next.file_name}`;
}

function contractDetail(row: ContractRow) {
  const { result } = row;
  const fields = Object.fromEntries(
    ExtractedFieldName.options.map((name) => {
      const field = result[name];
      return [
        name,
        { value: field.value, confidence: field.confidence, quote_verified: field.quote_verified },
      ];
    }),
  );
  return {
    id: row.id,
    file_name: row.file_name,
    needs_review: row.needs_review,
    summary: result.summary,
    fields,
    risks: result.risk_clauses.map((r) => ({
      category: r.category,
      severity: r.severity,
      title: r.title,
      explanation: r.explanation,
      quote: r.quote,
      quote_verified: r.quote_verified,
      page: r.quote_page,
    })),
    // Computed in code from the fields above, with today's date.
    dates: {
      expiration_date: result.derived.expiration_date,
      current_term_end: result.derived.current_term_end,
      next_renewal_date: result.derived.next_renewal_date,
      notice_deadline: result.derived.notice_deadline,
      days_until_notice_deadline: result.derived.days_until_notice_deadline,
    },
    alerts: result.derived.alerts,
    // suspected_injections is left out on purpose: it is the text that must not reach a model.
  };
}

function hitFields(hit: ChunkHit) {
  return {
    chunk_id: hit.chunk_id,
    document_id: hit.document_id,
    file_name: hit.file_name,
    page_start: hit.page_start,
    page_end: hit.page_end,
    text: hit.text,
  };
}

// One analyzed contract with its dates recomputed for today. Undefined when there is no such
// document or it has no readable extraction.
export function loadContract(
  { db, log, context }: Pick<AskToolDeps, "db" | "log" | "context">,
  id: string,
): ContractRow | undefined {
  const row = getDocument(db, id);
  if (row?.status !== "completed" || row.latest_extraction_id === null) return undefined;
  const extraction = getExtraction(db, row.latest_extraction_id);
  const result = extraction && readStoredResult(extraction.result_json, row.id, log, context);
  if (!result) return undefined;
  return {
    id: row.id,
    file_name: row.original_name,
    needs_review: row.needs_review === 1,
    result,
  };
}

export function createAskTools(deps: AskToolDeps) {
  const { db, embedder, log, context } = deps;
  let budgetLeft = TOOL_RESULT_BUDGET_CHARS;

  function reply(payload: { summary: string } & Record<string, unknown>, note?: string): string {
    if (budgetLeft <= 0) {
      return wrapToolResult({
        summary: "not run, the tools have returned as much as fits",
        error: "No more tool results fit. Answer from what you already have.",
      });
    }
    const text = wrapToolResult(payload, note);
    budgetLeft -= text.length;
    return text;
  }

  // Completed documents with a readable extraction. A duplicate shares its original's values and
  // would only list the same contract twice.
  function contracts(): ContractRow[] {
    const rows: ContractRow[] = [];
    for (const row of listCompletedForExport(db)) {
      if (row.duplicate_of !== null) continue;
      const result = readStoredResult(row.result_json, row.id, log, context);
      if (result === null) continue;
      rows.push({
        id: row.id,
        file_name: row.original_name,
        needs_review: row.needs_review === 1,
        result,
      });
    }
    return rows;
  }

  const findContracts = tool(
    (filters) => {
      const all = contracts();
      const found = all.filter((row) => matches(row, filters)).sort(byNoticeDeadline);
      const set = applied(filters);
      // Small models add filters the question never asked for and take "0 match" as the answer.
      const note =
        found.length === 0 && set.length > 0 && all.length > 0
          ? `No contract matches all of these filters together: ${set.join(", ")}. Filters combine with AND, so dropping one may help. Keep only the ones the question asks for and call find_contracts again. Without filters it lists every contract.`
          : undefined;
      return reply(
        {
          summary: `${String(found.length)} of ${String(all.length)} contracts match`,
          // First, so it is read before the rows.
          nearest_notice_deadline: nearestNoticeDeadline(found),
          sorted_by: "notice_deadline, soonest first, contracts without one last",
          total_matching: found.length,
          // The model has to know when it is not looking at all of them.
          shown: Math.min(found.length, MAX_CONTRACTS),
          contracts: found.slice(0, MAX_CONTRACTS).map(keyFields),
        },
        note,
      );
    },
    { name: "find_contracts", description: deps.descriptions.find_contracts, schema: Filters },
  );

  const searchClauses = tool(
    async ({ query, k, document_id }) => {
      const limit = Math.min(Math.max(k ?? DEFAULT_K, 1), MAX_K);
      const asked = document_id == null || document_id === "" ? undefined : document_id;
      const documentId = deps.documentId ?? asked;
      if (documentId !== undefined && getDocument(db, documentId) === undefined) {
        return reply({
          summary: "no such contract",
          error: `No contract has the id ${documentId}. Get ids from find_contracts.`,
        });
      }
      let mode = "hybrid";
      let hits: ChunkHit[];
      try {
        const [embedding] = await embedder.embed([query], "query", {
          timeoutMs: QUERY_EMBED_TIMEOUT_MS,
        });
        if (embedding === undefined) throw new Error("embedder returned no vector for the query");
        hits = hybridSearchRetrievalChunks(db, {
          query,
          embedding,
          embedModel: embedder.model,
          k: limit,
          documentId,
        });
      } catch (err) {
        if (!(err instanceof LlmError)) throw err;
        // Half a search beats none: the words still find the clause when the embeddings
        // provider is down or busy. The result says which search it was.
        log.warn({ kind: err.kind, err }, "could not embed the query, searching by keyword only");
        mode = "keyword";
        hits = keywordSearchRetrievalChunks(db, { query, k: limit, documentId });
      }
      const files = [...new Set(hits.map((hit) => hit.file_name))];
      return reply({
        summary:
          hits.length === 0
            ? `no passages for "${query}"`
            : `${String(hits.length)} passages for "${query}" from ${files.join(", ")}`,
        mode,
        results: hits.map(hitFields),
      });
    },
    { name: "search_clauses", description: deps.descriptions.search_clauses, schema: SearchArgs },
  );

  const getContract = tool(
    ({ id }) => {
      const row = loadContract(deps, id);
      if (row === undefined) {
        return reply({
          summary: "no such contract",
          error: `No analyzed contract has the id ${id}. Get ids from find_contracts.`,
        });
      }
      return reply({
        summary: `fields, ${String(row.result.risk_clauses.length)} risks and dates of ${row.file_name}`,
        contract: contractDetail(row),
      });
    },
    { name: "get_contract", description: deps.descriptions.get_contract, schema: ContractArgs },
  );

  // A tuple, so a caller that takes one of them out gets that tool's own type.
  const tools: [typeof findContracts, typeof searchClauses, typeof getContract] = [
    findContracts,
    searchClauses,
    getContract,
  ];
  return tools;
}
