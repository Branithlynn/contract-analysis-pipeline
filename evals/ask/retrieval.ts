// Measures search on its own, before any agent sits on top of it: indexes the sample documents
// with the production chunker and embedder, asks the questions in retrieval.json and checks
// whether the expected passage comes back. No queue, no llm, an in-memory db.
// Usage: npm run eval:retrieval -- [--embed-provider ollama|openai|mock] [--embed-model <name>] [--mode vector|keyword|hybrid] [--coverage <file>]...
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { MIME_FORMATS, SearchMode } from "@nexus/shared";
import {
  EmbedProviderName,
  createDocument,
  createEmbedder,
  createLogger,
  hybridSearchRetrievalChunks,
  keywordSearchRetrievalChunks,
  listRetrievalChunks,
  loadConfig,
  migrate,
  openMemoryDb,
  searchRetrievalChunks,
  type ChunkHit,
  type Db,
} from "@nexus/shared/node";
import { embedEnvFromArgs } from "../../scripts/lib/embed-env.js";
import { splitPages } from "../../services/worker/src/extraction/grounding.js";
import { parseDocument, type ParsedDocument } from "../../services/worker/src/parse/index.js";
import { chunkForRetrieval } from "../../services/worker/src/retrieval/chunk.js";
import {
  indexDocument,
  type IndexDeps,
} from "../../services/worker/src/retrieval/index-document.js";
import {
  renderRetrievalReport,
  type DocumentRun,
  type QuestionRun,
  type RetrievalHeader,
} from "./retrieval-report.js";
import {
  chunkCoverage,
  containsQuote,
  fileName,
  rankOfExpected,
  readRetrievalCases,
  type RetrievalCases,
  type RetrievalQuestion,
} from "./retrieval-score.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RESULTS_DIR = join(ROOT, "evals", "results");
const CASES = join(ROOT, "evals", "ask", "retrieval.json");
// Recall is read at 3 and 5. Ten, so a passage that just missed the top 5 still shows its rank.
const TOP_K = 10;

const USAGE = `usage: npm run eval:retrieval -- [--embed-provider ${EmbedProviderName.options.join("|")}] [--embed-model <name>] [--mode ${SearchMode.options.join("|")}] [--coverage <file>]...`;

function fail(text: string): never {
  console.error(`${text}\n${USAGE}`);
  process.exit(1);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function mimeFor(file: string): string {
  const ext = extname(file).slice(1).toLowerCase();
  for (const [mime, format] of MIME_FORMATS) if (format === ext) return mime;
  return fail(`${file}: unsupported extension ".${ext}"`);
}

interface Indexed {
  run: DocumentRun;
  parsed: ParsedDocument;
  // The chunks as stored, flagged ones included.
  chunks: { text: string; flagged: boolean }[];
}

async function indexCorpusFile(deps: IndexDeps, db: Db, path: string): Promise<Indexed> {
  const parsed = await parseDocument(resolve(ROOT, path), mimeFor(path), deps.logger);
  const id = randomUUID();
  createDocument(db, {
    id,
    original_name: fileName(path),
    mime: mimeFor(path),
    size_bytes: 0,
    sha256: id,
    storage_path: path,
    status: "queued",
  });
  const started = performance.now();
  const summary = await indexDocument(deps, id, parsed.text);
  const indexMs = Math.round(performance.now() - started);
  const chunks = listRetrievalChunks(db, id).map((row) => ({
    text: row.text,
    flagged: row.injection_flagged === 1,
  }));
  return {
    parsed,
    chunks,
    run: {
      document: fileName(path),
      in_corpus: true,
      pages: parsed.pageCount,
      chunks: summary.chunks,
      flagged: summary.flagged,
      coverage: chunkCoverage(
        parsed.text,
        chunks.map((chunk) => chunk.text),
      ),
      index_ms: indexMs,
    },
  };
}

// For --coverage: chunked like the indexing stage would, nothing embedded or searched.
async function coverageOnly(deps: IndexDeps, path: string): Promise<DocumentRun> {
  const parsed = await parseDocument(resolve(path), mimeFor(path), deps.logger);
  const chunks = chunkForRetrieval(parsed.text).map((chunk) => chunk.text);
  return {
    document: fileName(path),
    in_corpus: false,
    pages: parsed.pageCount,
    chunks: chunks.length,
    flagged: 0,
    coverage: chunkCoverage(parsed.text, chunks),
    index_ms: null,
  };
}

// The expectations are hand-written, so before anything is scored they are checked against the
// documents: the quote has to be on the page the file says, and in at least one chunk. A wrong
// expectation would otherwise look like a model that cannot find things.
function checkExpectation(q: RetrievalQuestion, doc: Indexed): { reachable: boolean } {
  const pages = splitPages(doc.parsed.text);
  const onPages = pages.filter((p) => containsQuote(p.text, q.quote)).map((p) => p.page);
  if (onPages.length === 0) {
    throw new Error(`${q.id}: the quote is not in ${q.document}`);
  }
  if (!onPages.includes(q.page)) {
    throw new Error(
      `${q.id}: the quote is on page ${onPages.map(String).join(", ")} of ${q.document}, the file says ${String(q.page)}`,
    );
  }
  const holding = doc.chunks.filter((chunk) => containsQuote(chunk.text, q.quote));
  if (holding.length === 0) {
    throw new Error(`${q.id}: no chunk of ${q.document} holds the whole quote, pick a shorter one`);
  }
  return { reachable: holding.some((chunk) => !chunk.flagged) };
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
  let values: {
    "embed-provider"?: string | undefined;
    "embed-model"?: string | undefined;
    mode?: string | undefined;
    coverage?: string[] | undefined;
  };
  try {
    ({ values } = parseArgs({
      options: {
        "embed-provider": { type: "string" },
        "embed-model": { type: "string" },
        mode: { type: "string" },
        coverage: { type: "string", multiple: true },
      },
    }));
  } catch (err) {
    fail(message(err));
  }

  // The api's default, so a run without the flag measures what a search request gets.
  const parsedMode = SearchMode.safeParse(values.mode ?? "hybrid");
  if (!parsedMode.success) fail(`unknown mode "${String(values.mode)}"`);
  const mode = parsedMode.data;

  let env: Record<string, string | undefined>;
  try {
    env = embedEnvFromArgs({ provider: values["embed-provider"], model: values["embed-model"] });
  } catch (err) {
    fail(message(err));
  }
  // loadConfig's error lists field paths and problems, never the values, so keys can't leak here.
  const config = loadConfig(env);
  let cases: RetrievalCases;
  try {
    cases = readRetrievalCases(CASES);
  } catch (err) {
    fail(message(err));
  }

  const db = openMemoryDb();
  migrate(db);
  const embedder = createEmbedder(config);
  // Errors only: the report is what this prints.
  const deps: IndexDeps = { db, config, logger: createLogger("eval", "error"), embedder };

  const indexed = new Map<string, Indexed>();
  const questions: QuestionRun[] = [];
  const extra: DocumentRun[] = [];
  let dimensions: number | null = null;
  try {
    for (const path of cases.corpus) {
      console.error(`indexing ${path}`);
      indexed.set(fileName(path), await indexCorpusFile(deps, db, path));
    }
    for (const path of values.coverage ?? []) extra.push(await coverageOnly(deps, path));

    for (const q of cases.questions) {
      const doc = indexed.get(q.document);
      if (!doc) throw new Error(`${q.id}: ${q.document} was not indexed`);
      const { reachable } = checkExpectation(q, doc);

      const started = performance.now();
      let embedded = started;
      let hits: ChunkHit[];
      if (mode === "keyword") {
        // No embedding of the question, like the api in this mode.
        hits = keywordSearchRetrievalChunks(db, { query: q.question, k: TOP_K });
      } else {
        const [embedding] = await embedder.embed([q.question], "query", {
          timeoutMs: config.LLM_TIMEOUT_MS,
        });
        if (embedding === undefined) throw new Error(`${q.id}: no embedding for the question`);
        embedded = performance.now();
        dimensions = embedding.length;
        const vector = { embedding, embedModel: embedder.model, k: TOP_K };
        hits =
          mode === "vector"
            ? searchRetrievalChunks(db, vector)
            : hybridSearchRetrievalChunks(db, { ...vector, query: q.question });
      }
      const done = performance.now();

      const results = hits.map((hit) => ({
        document: hit.file_name,
        page_start: hit.page_start,
        page_end: hit.page_end,
        text: hit.text,
        score: hit.score,
      }));
      questions.push({
        id: q.id,
        question: q.question,
        document: q.document,
        page: q.page,
        rank: rankOfExpected(q, results),
        reachable,
        latency_ms: Math.round(done - started),
        embed_ms: Math.round(embedded - started),
        search_ms: Math.round(done - embedded),
        results,
      });
    }
  } catch (err) {
    // A provider that is down, a broken sample, a wrong expectation: the run is not a result.
    console.error(`retrieval eval stopped, nothing was written: ${message(err)}`);
    process.exitCode = 1;
    return;
  } finally {
    await embedder.close?.();
    db.close();
  }

  const now = new Date();
  const cpu = cpus();
  const header: RetrievalHeader = {
    provider: embedder.name,
    model: embedder.model,
    mode,
    dimensions,
    date: localDate(now),
    cpu: `${cpu[0]?.model.trim() ?? "unknown"} (${String(cpu.length)} threads)`,
    topK: TOP_K,
  };
  const documents = [...[...indexed.values()].map((doc) => doc.run), ...extra];
  const report = renderRetrievalReport({ header, questions, documents });

  // With the time, like the extraction eval, so two runs on one day do not replace each other.
  const name = [header.date, localTime(now), "retrieval", mode, header.provider, header.model]
    .map(fileSafe)
    .join("-");
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, `${name}.md`), report);
  writeFileSync(
    join(RESULTS_DIR, `${name}.json`),
    `${JSON.stringify({ header, questions, documents }, null, 2)}\n`,
  );

  console.log(report);
  console.error(`wrote evals/results/${name}.md and .json`);
}

await main();
