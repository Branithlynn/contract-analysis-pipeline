// Turns a retrieval eval run into the markdown report. Pure, so the layout can be tested without
// an embedding model. Same style as the extraction report in ../report.ts.
import {
  retrievalMetrics,
  type Coverage,
  type Ratio,
  type ReturnedChunk,
} from "./retrieval-score.js";

export interface RetrievalHeader {
  provider: string;
  model: string;
  // vector, keyword or hybrid.
  mode: string;
  // Null when no question was embedded (keyword mode).
  dimensions: number | null;
  // The day the eval ran.
  date: string;
  cpu: string;
  // How many results each question asked for. Recall is read at 3 and 5, MRR over all of them.
  topK: number;
}

export interface QuestionRun {
  id: string;
  question: string;
  document: string;
  page: number | null;
  // 1 for the first result, null when the expected passage was not returned.
  rank: number | null;
  // False when the passage only exists in chunks flagged as prompt injection, which search never
  // returns. Such a question cannot be answered by any embedding model.
  reachable: boolean;
  // Embedding the question plus the search, in milliseconds.
  latency_ms: number;
  embed_ms: number;
  search_ms: number;
  results: ReturnedChunk[];
}

export interface DocumentRun {
  document: string;
  // False for files that were only chunked for the coverage table, not searched.
  in_corpus: boolean;
  pages: number | null;
  chunks: number;
  flagged: number;
  coverage: Coverage;
  // Null for files outside the corpus, nothing was embedded for them.
  index_ms: number | null;
}

export interface RetrievalReportInput {
  header: RetrievalHeader;
  questions: readonly QuestionRun[];
  documents: readonly DocumentRun[];
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

function percent(r: Ratio): string {
  if (r.total === 0) return NONE;
  return `${String(r.correct)}/${String(r.total)} (${String(Math.round((r.correct / r.total) * 100))}%)`;
}

function ms(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${String(Math.round(value))}ms`;
}

// Nearest rank, so the value is always one that was really measured.
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length / 2) - 1] ?? 0;
}

function place(document: string, page: number | null, pageEnd: number | null = page): string {
  if (page === null) return document;
  return pageEnd === null || pageEnd === page
    ? `${document} p${String(page)}`
    : `${document} p${String(page)}-${String(pageEnd)}`;
}

// Table cells: no pipes and no line breaks.
function cell(text: string, max = 70): string {
  const flat = text.replace(/\s+/g, " ").replace(/\|/g, "/").trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
}

function questionRow(q: QuestionRun): string[] {
  const top = q.results[0];
  return [
    q.id,
    cell(q.question, 60),
    place(q.document, q.page),
    q.rank === null ? (q.reachable ? "miss" : "miss (flagged)") : String(q.rank),
    top ? `${place(top.document, top.page_start, top.page_end)} (${top.score.toFixed(3)})` : NONE,
    ms(q.latency_ms),
  ];
}

function coveragePercent(c: Coverage): string {
  if (c.parsedChars === 0) return NONE;
  // Floored, so 99.96% is not shown as a clean 100.
  return `${(Math.floor((c.coveredChars / c.parsedChars) * 1000) / 10).toFixed(1)}%`;
}

function documentRow(d: DocumentRun): string[] {
  const c = d.coverage;
  return [
    d.in_corpus ? d.document : `${d.document} (coverage only)`,
    d.pages === null ? NONE : String(d.pages),
    String(d.chunks),
    String(d.flagged),
    String(c.parsedChars),
    String(c.chunkChars),
    String(c.overlapChars),
    String(c.coveredChars),
    coveragePercent(c),
  ];
}

function missLines(q: QuestionRun): string[] {
  const why = q.reachable
    ? `expected ${place(q.document, q.page)}`
    : `expected ${place(q.document, q.page)}, but the passage is only in a chunk flagged as prompt injection, which search never returns`;
  const got = q.results
    .slice(0, 3)
    .map(
      (r, i) =>
        `  ${String(i + 1)}. ${place(r.document, r.page_start, r.page_end)} (${r.score.toFixed(3)}): ${cell(r.text, 90)}`,
    );
  return [`- ${q.id}: ${why}. Returned instead:`, ...(got.length === 0 ? ["  nothing"] : got)];
}

function coverageProblems(documents: readonly DocumentRun[]): string[] {
  const lines: string[] = [];
  for (const d of documents) {
    const c = d.coverage;
    if (c.unlocatedChunks > 0) {
      lines.push(
        `- ${d.document}: ${String(c.unlocatedChunks)} chunk(s) with text that is not in the parsed document`,
      );
    }
    if (c.coveredChars < c.parsedChars) {
      lines.push(
        `- ${d.document}: ${String(c.parsedChars - c.coveredChars)} characters are in no chunk, the first ones: ${JSON.stringify(c.firstGap)}`,
      );
    }
  }
  return lines;
}

export function renderRetrievalReport(input: RetrievalReportInput): string {
  const { header, questions, documents } = input;
  const corpus = documents.filter((d) => d.in_corpus);
  const metrics = retrievalMetrics(questions.map((q) => q.rank));
  const latencies = questions.map((q) => q.latency_ms);
  const chunks = corpus.reduce((n, d) => n + d.chunks, 0);
  const flagged = corpus.reduce((n, d) => n + d.flagged, 0);
  const indexMs = corpus.reduce((n, d) => n + (d.index_ms ?? 0), 0);

  const lines: string[] = [
    `# Retrieval eval: ${header.mode}, ${header.provider} / ${header.model}`,
    "",
    `- search mode: ${header.mode}`,
    `- embed provider: ${header.provider}`,
    `- embed model: ${header.model}`,
    `- dimensions: ${header.dimensions === null ? NONE : String(header.dimensions)}`,
    `- date: ${header.date}`,
    `- cpu: ${header.cpu}`,
    `- corpus: ${String(corpus.length)} documents, ${String(chunks)} chunks (${String(flagged)} flagged as prompt injection and not searchable)`,
    `- questions: ${String(questions.length)}, top ${String(header.topK)} results each`,
    "",
    ...(input.notes ?? []).flatMap((note) => [note, ""]),
    "## Questions",
    "",
    ...table(
      ["id", "question", "expected", "rank", "top result (score)", "latency"],
      questions.map(questionRow),
    ),
    "",
    "A result counts when it is from the expected document and contains the expected quote.",
    "",
    "## Totals",
    "",
    `- recall@3: ${percent(metrics.recallAt3)}`,
    `- recall@5: ${percent(metrics.recallAt5)}`,
    `- MRR: ${metrics.mrr.toFixed(3)}`,
    `- query latency: p50 ${ms(median(latencies))}, max ${ms(Math.max(0, ...latencies))} (embedding the question plus the search)`,
    `- indexing: ${ms(indexMs)} for ${String(chunks)} chunks`,
    "",
    "## Misses",
    "",
  ];

  const missed = questions.filter((q) => q.rank === null || q.rank > 5);
  lines.push(
    ...(missed.length === 0
      ? ["None, every expected passage is in the top 5."]
      : missed.flatMap((q) =>
          q.rank === null
            ? missLines(q)
            : [`- ${q.id}: found at rank ${String(q.rank)}, outside the top 5`],
        )),
    "",
    "## Chunk coverage",
    "",
    "Characters that are not whitespace. Covered is what at least one chunk holds, so 100% means chunking dropped nothing.",
    "",
    ...table(
      [
        "document",
        "pages",
        "chunks",
        "flagged",
        "parsed chars",
        "chunk chars",
        "overlap",
        "covered",
        "coverage",
      ],
      documents.map(documentRow),
    ),
    "",
  );
  const problems = coverageProblems(documents);
  lines.push(...(problems.length === 0 ? ["No text is missing from the chunks."] : problems), "");

  return lines.join("\n");
}
