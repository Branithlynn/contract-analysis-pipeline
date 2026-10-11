import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ExtractionResultSchema, type LlmExtraction, type Stage } from "@nexus/shared";
import { MOCK_EXTRACTION, MockProvider } from "../llm/mock.js";
import type { LlmProvider } from "../llm/types.js";
import { makeDeps } from "../test-support/fixtures.js";
import { makePdf } from "../test-support/pdf.js";
import { analyzeDocument, type StageRunner } from "./analyze.js";
import { PermanentError } from "./errors.js";

const PDF = "application/pdf";
const LINE = "The supplier shall provide the services described in this agreement";
const FILLER =
  "The Vendor shall provide the hosting services described in Schedule A with reasonable skill and care.";

// Two pages, each just under the chunk budget used below, so each page becomes its own chunk.
const PAGE_1 = [
  "MASTER SERVICES AGREEMENT",
  "This Master Services Agreement is made between Acme Hosting Ltd (the Vendor) and Nexus Corp (the Customer).",
  "1. Term",
  "This Agreement takes effect on 2026-03-01 and continues for an initial term of twelve (12) months.",
  "2. Services",
  ...Array.from({ length: 6 }, () => FILLER),
];
const PAGE_2 = [
  "3. Fees",
  "The Customer shall pay total fees of USD 120,000 for the initial term, payable within thirty (30) days of invoice.",
  "4. Renewal",
  "This Agreement renews automatically for successive terms of twelve (12) months unless either party gives at least sixty (60) days written notice.",
  "5. Price changes",
  "The Vendor may increase the fees at any time on thirty (30) days notice.",
  ...Array.from({ length: 5 }, () => FILLER),
];
const CHUNK_BUDGET = "1200";

const high = <T>(value: T, quote: string) => ({ value, quote, confidence: "high" as const });

const PART_1: LlmExtraction = {
  ...MOCK_EXTRACTION,
  document_type: high("contract", "MASTER SERVICES AGREEMENT"),
  vendor_name: high("Acme Hosting Ltd", "Acme Hosting Ltd (the Vendor)"),
  customer_name: high("Nexus Corp", "Nexus Corp (the Customer)"),
  effective_date: high("2026-03-01", "takes effect on 2026-03-01"),
  initial_term_months: high(12, "initial term of twelve (12) months"),
  summary: "Part one.",
};
const PART_2: LlmExtraction = {
  ...MOCK_EXTRACTION,
  document_type: high("contract", "This Agreement renews automatically"),
  payment_terms: high("net 30", "payable within thirty (30) days of invoice"),
  renewal_term_months: high(12, "successive terms of twelve (12) months"),
  termination_notice_days: high(60, "at least sixty (60) days written notice"),
  auto_renewal: high(true, "renews automatically"),
  total_contract_value: high({ amount: 120000, currency: "USD" }, "total fees of USD 120,000"),
  risk_clauses: [
    {
      category: "unilateral_price_increase",
      severity: "medium",
      title: "Price increase",
      explanation: "The Vendor can raise fees without a cap.",
      quote: "The Vendor may increase the fees at any time on thirty (30) days notice.",
    },
  ],
  summary: "Part two.",
};

// Answers like a model that quotes the document correctly: one extraction per part, then the summary.
function quotingProvider(): MockProvider {
  return new MockProvider((req) => {
    if (req.schemaName === "contract_summary") return { summary: "Acme hosts Nexus for a year." };
    return req.messages[0]?.content.includes('part="1 of 2"') ? PART_1 : PART_2;
  });
}

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "nexus-analyze-"));
  await writeFile(join(dir, "two-pages.pdf"), await makePdf([[LINE], [LINE]]));
  await writeFile(join(dir, "blank.pdf"), await makePdf([[], []]));
  await writeFile(join(dir, "msa.pdf"), await makePdf([PAGE_1, PAGE_2]));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function setup() {
  return makeDeps({ UPLOAD_DIR: dir }).deps;
}

const input = (path: string) => ({ path, mime: PDF, filename: "contract.pdf" });

describe("analyzeDocument", () => {
  it("resolves the relative path against UPLOAD_DIR and parses the file", async () => {
    const result = await analyzeDocument(input("two-pages.pdf"), setup());

    expect(result.parsed).toMatchObject({ format: "pdf", pageCount: 2 });
    expect(result.parsed.text).toBe(`[[page 1]]\n${LINE}\n\n[[page 2]]\n${LINE}`);
    // The default mock finds nothing but a document_type without a quote, so grounding is 0.
    expect(result.result.grounding_score).toBe(0);
    expect(result.needsReview).toBe(true);
    expect(result.meta).toMatchObject({
      provider: "mock",
      model: "mock",
      promptVersion: "extract.v1",
      chunkCount: 1,
    });
  });

  it("extracts a 2 chunk pdf with real quotes: valid result, pages filled, no review needed", async () => {
    const provider = quotingProvider();
    const { deps, lines } = makeDeps({ UPLOAD_DIR: dir, LLM_MAX_INPUT_CHARS: CHUNK_BUDGET });

    const { result, needsReview, meta } = await analyzeDocument(
      { path: "msa.pdf", mime: PDF, filename: "msa.pdf" },
      { ...deps, provider },
    );

    expect(ExtractionResultSchema.safeParse(result).success).toBe(true);
    expect(meta.chunkCount).toBe(2);
    // 2 extraction calls and the summary.
    expect(provider.calls).toHaveLength(3);
    expect(meta.tokens.outputTokens).toBe(300);
    expect(result.vendor_name).toEqual({
      value: "Acme Hosting Ltd",
      quote: "Acme Hosting Ltd (the Vendor)",
      confidence: "high",
      quote_verified: true,
      quote_page: 1,
    });
    expect(result.effective_date).toMatchObject({ value: "2026-03-01", quote_page: 1 });
    expect(result.total_contract_value).toMatchObject({
      value: { amount: 120000, currency: "USD" },
      quote_verified: true,
      quote_page: 2,
    });
    expect(result.termination_notice_days).toMatchObject({ value: 60, quote_page: 2 });
    expect(result.document_type.value).toBe("contract");
    expect(result.risk_clauses).toEqual([
      expect.objectContaining({ title: "Price increase", quote_verified: true, quote_page: 2 }),
    ]);
    expect(result.summary).toBe("Acme hosts Nexus for a year.");
    expect(result.grounding_score).toBe(1);
    expect(result.conflicts).toEqual([]);
    expect(result.warnings).toEqual([]);
    // NOW is 2026-06-01: term ends 2027-02-28, 60 days notice.
    expect(result.derived).toMatchObject({
      expiration_date: "2027-02-28",
      expiration_source: "computed",
      notice_deadline: "2026-12-30",
      alerts: [],
    });
    expect(needsReview).toBe(false);
    expect(lines.filter((l) => l.msg === "chunk extracted")).toHaveLength(2);
  });

  it("runs ollama one chunk at a time and says so once when the config asked for more", async () => {
    const { deps, lines } = makeDeps({
      UPLOAD_DIR: dir,
      LLM_MAX_INPUT_CHARS: CHUNK_BUDGET,
      LLM_CHUNK_CONCURRENCY: "4",
    });
    const inner = quotingProvider();
    let running = 0;
    let peak = 0;
    const provider: LlmProvider = {
      name: "ollama",
      model: "mock",
      async complete(req) {
        peak = Math.max(peak, ++running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
        return inner.complete(req);
      },
    };

    await analyzeDocument(
      { path: "msa.pdf", mime: PDF, filename: "msa.pdf" },
      { ...deps, provider },
    );

    expect(peak).toBe(1);
    expect(
      lines.filter(
        (l) => l.msg === "ollama runs one call at a time, ignoring LLM_CHUNK_CONCURRENCY",
      ),
    ).toHaveLength(1);
  });

  it("runs every stage through onStage, in order", async () => {
    const stages: Stage[] = [];
    const onStage: StageRunner = (stage, fn) => {
      stages.push(stage);
      return fn();
    };

    await analyzeDocument(input("two-pages.pdf"), setup(), { onStage });

    expect(stages).toEqual(["parsing", "extracting", "validating"]);
  });

  it("lets parse errors through unchanged", async () => {
    const err = await analyzeDocument(input("blank.pdf"), setup()).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PermanentError);
    expect(err).toMatchObject({ code: "NO_TEXT_LAYER" });
  });
});
