import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RetrievalCasesSchema,
  chunkCoverage,
  containsQuote,
  rankOfExpected,
  readRetrievalCases,
  retrievalMetrics,
  type ReturnedChunk,
} from "./retrieval-score.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const chunk = (document: string, text: string, page: number | null = 1): ReturnedChunk => ({
  document,
  page_start: page,
  page_end: page,
  text,
  score: 0.5,
});

describe("retrieval.json", () => {
  const cases = readRetrievalCases(fileURLToPath(new URL("./retrieval.json", import.meta.url)));

  it("is valid and asks about documents that exist", () => {
    expect(cases.questions.length).toBeGreaterThanOrEqual(10);
    for (const path of cases.corpus) expect(existsSync(`${ROOT}${path}`), path).toBe(true);
  });

  it("gives pdf questions a page and docx questions none", () => {
    for (const q of cases.questions) {
      if (q.document.endsWith(".pdf")) expect(q.page, q.id).toBeGreaterThanOrEqual(1);
      else expect(q.page, q.id).toBeNull();
    }
  });

  it("does not ask with the words of the answer", () => {
    // A question that repeats its quote would measure string matching, not retrieval.
    for (const q of cases.questions) expect(containsQuote(q.question, q.quote), q.id).toBe(false);
  });
});

describe("RetrievalCasesSchema", () => {
  const question = {
    id: "a",
    question: "late payment charge",
    document: "hardware.pdf",
    page: 2,
    quote: "late payment charge of 2%",
  };

  it("rejects a question about a document outside the corpus, and a duplicate id", () => {
    const outside = RetrievalCasesSchema.safeParse({
      corpus: ["samples/other.pdf"],
      questions: [question],
    });
    expect(outside.success).toBe(false);

    const twice = RetrievalCasesSchema.safeParse({
      corpus: ["samples/hardware.pdf"],
      questions: [question, question],
    });
    expect(twice.success).toBe(false);
  });

  it("rejects unknown keys, so a typo in a field name is not read as a missing value", () => {
    const parsed = RetrievalCasesSchema.safeParse({
      corpus: ["samples/hardware.pdf"],
      questions: [{ ...question, pgae: 3 }],
    });
    expect(parsed.success).toBe(false);
  });

  it("reports a missing file with its path", () => {
    expect(() => readRetrievalCases("no/such/file.json")).toThrow(/no\/such\/file\.json/);
  });
});

describe("rankOfExpected", () => {
  const q = { document: "hardware.pdf", quote: "late payment charge of 2% of the invoice amount" };

  it("is the position of the first chunk from the document that holds the quote", () => {
    const results = [
      chunk("msa.pdf", "Customer shall pay a late payment charge of 2% of the invoice amount."),
      chunk("hardware.pdf", "5.1 Supplier shall invoice Customer on delivery."),
      chunk("hardware.pdf", "5.3 a late payment charge of 2% of the invoice amount for each week"),
      chunk("hardware.pdf", "repeated as overlap: late payment charge of 2% of the invoice amount"),
    ];

    // Not 1: same words, other document. Not 2: right document, other clause.
    expect(rankOfExpected(q, results)).toBe(3);
  });

  it("finds a quote that the pdf broke over two lines", () => {
    const results = [chunk("hardware.pdf", "a late payment charge of 2%\nof the invoice   amount")];
    expect(rankOfExpected(q, results)).toBe(1);
  });

  it("is null when no result holds the quote", () => {
    expect(rankOfExpected(q, [chunk("hardware.pdf", "7. Delivery")])).toBeNull();
    expect(rankOfExpected(q, [])).toBeNull();
  });
});

describe("retrievalMetrics", () => {
  it("counts recall at 3 and 5 and averages the reciprocal ranks", () => {
    const metrics = retrievalMetrics([1, 2, 4, 6, null]);

    expect(metrics.recallAt3).toEqual({ correct: 2, total: 5 });
    expect(metrics.recallAt5).toEqual({ correct: 3, total: 5 });
    // (1 + 1/2 + 1/4 + 1/6 + 0) / 5
    expect(metrics.mrr).toBeCloseTo(0.3833, 4);
  });

  it("is zero for no questions and for all misses", () => {
    expect(retrievalMetrics([])).toEqual({
      recallAt3: { correct: 0, total: 0 },
      recallAt5: { correct: 0, total: 0 },
      mrr: 0,
    });
    expect(retrievalMetrics([null, null]).mrr).toBe(0);
  });
});

describe("chunkCoverage", () => {
  const text =
    "[[page 1]]\n1. Fees\n\nUSD 1,000 per month. Payable in advance.\n\n[[page 2]]\n2. Term\n\nTwelve months.";
  // Without markers and whitespace.
  const size = "1.FeesUSD1,000permonth.Payableinadvance.2.TermTwelvemonths.".length;

  it("is complete when the chunks hold everything, and counts overlap once", () => {
    const coverage = chunkCoverage(text, [
      "1. Fees\n\nUSD 1,000 per month. Payable in advance.",
      "Payable in advance.\n\n2. Term\n\nTwelve months.",
    ]);

    expect(coverage).toEqual({
      parsedChars: size,
      chunkChars: size + "Payableinadvance.".length,
      coveredChars: size,
      overlapChars: "Payableinadvance.".length,
      unlocatedChunks: 0,
      firstGap: null,
    });
  });

  it("shows text that no chunk holds", () => {
    const coverage = chunkCoverage(text, [
      "1. Fees\n\nUSD 1,000 per month.",
      "2. Term\n\nTwelve months.",
    ]);

    expect(coverage.coveredChars).toBe(size - "Payableinadvance.".length);
    expect(coverage.overlapChars).toBe(0);
    expect(coverage.firstGap).toBe("Payableinadvance.");
  });

  it("does not let a clause that appears twice cover for a missing one", () => {
    const twice = "Either party may assign.\n\nFees are due.\n\nEither party may assign.";
    // The second chunk can only be the second occurrence, the first one is not covered.
    const coverage = chunkCoverage(twice, ["Fees are due.", "Either party may assign."]);

    expect(coverage.coveredChars).toBe("Feesaredue.Eitherpartymayassign.".length);
    expect(coverage.firstGap).toBe("Eitherpartymayassign.");
  });

  it("reports a chunk whose text is not in the document instead of counting it", () => {
    const coverage = chunkCoverage(text, ["1. Fees", "something the document never said"]);

    expect(coverage.unlocatedChunks).toBe(1);
    expect(coverage.coveredChars).toBe("1.Fees".length);
    expect(coverage.overlapChars).toBe(0);
  });

  it("handles an empty document", () => {
    expect(chunkCoverage("[[page 1]]\n", [])).toMatchObject({
      parsedChars: 0,
      coveredChars: 0,
      firstGap: null,
    });
  });
});
