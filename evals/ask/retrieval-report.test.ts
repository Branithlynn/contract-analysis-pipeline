import { describe, expect, it } from "vitest";
import {
  renderRetrievalReport,
  type DocumentRun,
  type QuestionRun,
  type RetrievalHeader,
} from "./retrieval-report.js";

const HEADER: RetrievalHeader = {
  provider: "ollama",
  model: "nomic-embed-text",
  mode: "hybrid",
  dimensions: 768,
  date: "2026-10-12",
  cpu: "Test CPU (8 threads)",
  topK: 10,
};

function question(overrides: Partial<QuestionRun>): QuestionRun {
  return {
    id: "hardware-late-payment",
    question: "late payment charge",
    document: "hardware-supply.pdf",
    page: 2,
    rank: 1,
    reachable: true,
    latency_ms: 40,
    embed_ms: 38,
    search_ms: 2,
    results: [
      {
        document: "hardware-supply.pdf",
        page_start: 2,
        page_end: 2,
        text: "5.3 Customer shall pay a late payment charge of 2%",
        score: 0.8123,
      },
    ],
    ...overrides,
  };
}

function document(overrides: Partial<DocumentRun> = {}): DocumentRun {
  return {
    document: "hardware-supply.pdf",
    in_corpus: true,
    pages: 4,
    chunks: 8,
    flagged: 0,
    coverage: {
      parsedChars: 6678,
      chunkChars: 7317,
      coveredChars: 6678,
      overlapChars: 639,
      unlocatedChunks: 0,
      firstGap: null,
    },
    index_ms: 900,
    ...overrides,
  };
}

describe("renderRetrievalReport", () => {
  it("prints the header, one row per question and the totals", () => {
    const report = renderRetrievalReport({
      header: HEADER,
      questions: [
        question({}),
        question({ id: "b", rank: 4, latency_ms: 1500 }),
        question({ id: "c", rank: 7 }),
        question({ id: "d", rank: null, document: "consulting-sow.docx", page: null }),
      ],
      documents: [
        document(),
        document({ document: "consulting-sow.docx", pages: null, chunks: 6 }),
      ],
    });

    expect(report).toContain("# Retrieval eval: hybrid, ollama / nomic-embed-text");
    expect(report).toContain("- search mode: hybrid");
    expect(report).toContain("- dimensions: 768");
    expect(report).toContain("- corpus: 2 documents, 14 chunks (0 flagged");
    expect(report).toContain("- questions: 4, top 10 results each");
    expect(report).toContain(
      "| hardware-late-payment | late payment charge | hardware-supply.pdf p2 | 1 | hardware-supply.pdf p2 (0.812) | 40ms |",
    );
    expect(report).toContain("| d | late payment charge | consulting-sow.docx | miss |");
    expect(report).toContain("- recall@3: 1/4 (25%)");
    expect(report).toContain("- recall@5: 2/4 (50%)");
    // (1 + 1/4 + 1/7 + 0) / 4
    expect(report).toContain("- MRR: 0.348");
    expect(report).toContain("- query latency: p50 40ms, max 1.5s");
    expect(report).toContain("- indexing: 1.8s for 14 chunks");
  });

  it("lists what came back for a miss, and a late hit as outside the top 5", () => {
    const report = renderRetrievalReport({
      header: HEADER,
      questions: [
        question({
          id: "missed",
          rank: null,
          results: [
            {
              document: "msa.pdf",
              page_start: 6,
              page_end: 7,
              text: "13. Fees\nand | Invoicing",
              score: 0.61,
            },
            { document: "saas.pdf", page_start: 1, page_end: 1, text: "4. Fees", score: 0.6 },
          ],
        }),
        question({ id: "late", rank: 9 }),
      ],
      documents: [document()],
    });

    expect(report).toContain("- missed: expected hardware-supply.pdf p2. Returned instead:");
    // No line break and no pipe from the document text, either would break the markdown.
    expect(report).toContain("  1. msa.pdf p6-7 (0.610): 13. Fees and / Invoicing");
    expect(report).toContain("  2. saas.pdf p1 (0.600): 4. Fees");
    expect(report).toContain("- late: found at rank 9, outside the top 5");
  });

  it("says so when a passage cannot be found because its chunk is flagged", () => {
    const report = renderRetrievalReport({
      header: HEADER,
      questions: [question({ id: "nda", rank: null, reachable: false, results: [] })],
      documents: [document({ flagged: 1 })],
    });

    expect(report).toContain("| miss (flagged) |");
    expect(report).toContain("only in a chunk flagged as prompt injection");
    expect(report).toContain("(1 flagged as prompt injection and not searchable)");
  });

  it("says when nothing was missed", () => {
    const report = renderRetrievalReport({
      header: HEADER,
      questions: [question({})],
      documents: [document()],
    });

    expect(report).toContain("None, every expected passage is in the top 5.");
    expect(report).toContain("No text is missing from the chunks.");
  });

  it("shows coverage per document and points at text that is in no chunk", () => {
    const report = renderRetrievalReport({
      header: HEADER,
      questions: [question({})],
      documents: [
        document(),
        document({
          document: "contract-5-pages.pdf",
          in_corpus: false,
          pages: 5,
          chunks: 2,
          index_ms: null,
          coverage: {
            parsedChars: 2000,
            chunkChars: 1900,
            coveredChars: 1999,
            overlapChars: 0,
            unlocatedChunks: 1,
            firstGap: "Payableinadvance.",
          },
        }),
      ],
    });

    expect(report).toContain(
      "| hardware-supply.pdf | 4 | 8 | 0 | 6678 | 7317 | 639 | 6678 | 100.0% |",
    );
    // 1999 of 2000 is not shown as 100.
    expect(report).toContain(
      "| contract-5-pages.pdf (coverage only) | 5 | 2 | 0 | 2000 | 1900 | 0 | 1999 | 99.9% |",
    );
    expect(report).toContain(
      '- contract-5-pages.pdf: 1 characters are in no chunk, the first ones: "Payableinadvance."',
    );
    expect(report).toContain(
      "- contract-5-pages.pdf: 1 chunk(s) with text that is not in the parsed document",
    );
    // Only corpus documents count towards the totals.
    expect(report).toContain("- corpus: 1 documents, 8 chunks");
  });
});
