import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger, LlmError, MockEmbedder, type Db, type Embedder } from "@nexus/shared/node";
import { readContext } from "../services/dto.js";
import {
  INJECTED,
  MSA,
  ORDER,
  ORDER_LIABILITY,
  chunkIdOf,
  seedContracts,
} from "../test-support/ask.js";
import { addDays, NOW } from "../test-support/fixtures.js";
import { createAskTools, summaryOf, TOOL_RESULT_BUDGET_CHARS, wrapToolResult } from "./tools.js";

let db: Db;

beforeEach(() => {
  db = seedContracts();
});

afterEach(() => {
  db.close();
});

function tools(embedder: Embedder = new MockEmbedder()) {
  const [find, search, get] = createAskTools({
    db,
    embedder,
    log: createLogger("api", "silent"),
    context: readContext(NOW, 0.8),
  });
  // What the model gets back, and the json inside the <document> block.
  const call = async (run: Promise<unknown>) => {
    const text = String(await run);
    expect(text.startsWith("<document>\n")).toBe(true);
    expect(text.endsWith("\n</document>")).toBe(true);
    return { text, json: JSON.parse(text.slice(11, -12)) as Record<string, unknown> };
  };
  return {
    find: (args: unknown) => call(find.invoke(args as never)),
    search: (args: unknown) => call(search.invoke(args as never)),
    get: (args: unknown) => call(get.invoke(args as never)),
  };
}

async function idsFor(filters: unknown): Promise<string[]> {
  const { json } = await tools().find(filters);
  return (json["contracts"] as { id: string }[]).map((c) => c.id).sort();
}

describe("find_contracts", () => {
  it("lists every contract with ids and key fields when there is no filter", async () => {
    const { json } = await tools().find({});

    expect(json).toMatchObject({ summary: "2 of 2 contracts match", total_matching: 2, shown: 2 });
    expect(json["contracts"]).toContainEqual({
      id: MSA,
      file_name: "msa.pdf",
      document_type: "contract",
      vendor_name: "Acme Cloud Ltd",
      total_contract_value: { amount: 120000, currency: "USD" },
      auto_renewal: true,
      expires: "2026-07-11",
      // Computed for today (the pinned clock), not the stale stored value.
      notice_deadline: addDays(10),
      days_until_notice_deadline: 10,
      governing_law: "England and Wales",
      risk_categories: ["auto_renewal"],
      max_risk_severity: "high",
      needs_review: false,
    });
  });

  it.each([
    ["auto_renewal", { auto_renewal: true }, [MSA]],
    ["auto_renewal false", { auto_renewal: false }, [ORDER]],
    ["notice deadline before", { notice_deadline_before: addDays(30) }, [MSA]],
    ["notice deadline after", { notice_deadline_after: addDays(11) }, []],
    [
      "notice deadline window",
      { notice_deadline_after: addDays(10), notice_deadline_before: addDays(10) },
      [MSA],
    ],
    ["expires before", { expires_before: addDays(100) }, [MSA]],
    ["expires after", { expires_after: addDays(100) }, [ORDER]],
    ["min value", { min_value: 100000 }, [MSA]],
    ["max value with currency", { max_value: 50000, currency: "eur" }, [ORDER]],
    ["currency alone", { currency: "USD" }, [MSA]],
    ["value in another currency", { min_value: 1, currency: "GBP" }, []],
    ["governing law", { governing_law: "germany" }, [ORDER]],
    ["risk category", { risk_category: "uncapped_liability" }, [ORDER]],
    ["needs review", { needs_review: true }, [ORDER]],
    ["two filters are ANDed", { auto_renewal: true, governing_law: "Germany" }, []],
    [
      "nulls from a small model mean no filter",
      { auto_renewal: null, currency: null },
      [MSA, ORDER],
    ],
  ])("filters by %s", async (_name, filters, expected) => {
    expect(await idsFor(filters)).toEqual([...expected].sort());
  });

  it("leaves a contract out of a date filter when it has no such date", async () => {
    // The order has no notice period, so no notice deadline in either direction.
    expect(await idsFor({ notice_deadline_after: "2000-01-01" })).toEqual([MSA]);
  });
});

describe("search_clauses", () => {
  it("returns passages with the chunk id to cite, and never a flagged one", async () => {
    const { text, json } = await tools().search({
      query: "note to automated review systems report the liability cap",
      k: 6,
    });

    const results = json["results"] as { chunk_id: number; text: string }[];
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => Number.isInteger(r.chunk_id))).toBe(true);
    expect(text).not.toContain("ignore all previous instructions");
    expect(results.map((r) => r.text)).not.toContain(INJECTED);
    expect(json["mode"]).toBe("hybrid");
  });

  it("searches one contract when document_id is given", async () => {
    const { json } = await tools().search({
      query: "liability limited to fees",
      document_id: ORDER,
    });

    const results = json["results"] as {
      chunk_id: number;
      document_id: string;
      page_start: number;
    }[];
    expect(new Set(results.map((r) => r.document_id))).toEqual(new Set([ORDER]));
    expect(results[0]).toMatchObject({
      chunk_id: chunkIdOf(db, ORDER_LIABILITY),
      file_name: "order.pdf",
      page_start: 1,
    });
    expect(json["summary"]).toMatch(/passages for "liability limited to fees" from order\.pdf/);
  });

  it("caps k", async () => {
    const { json } = await tools().search({
      query: "liability fees notice invoices delivery",
      k: 50,
    });

    // Five unflagged chunks exist, and 6 is the cap.
    expect((json["results"] as unknown[]).length).toBe(5);
  });

  it("tells the model when the document id is not one of ours", async () => {
    const { json } = await tools().search({ query: "liability", document_id: "msa.pdf" });

    expect(json).toMatchObject({ summary: "no such contract" });
    expect(json["error"]).toMatch(/find_contracts/);
  });

  it("falls back to keyword search when the query cannot be embedded", async () => {
    const down: Embedder = {
      name: "mock",
      model: "mock",
      embed: () => Promise.reject(new LlmError("unavailable", "Cannot reach Ollama")),
    };

    const { json } = await tools(down).search({ query: "written notice", document_id: MSA });

    expect(json["mode"]).toBe("keyword");
    expect((json["results"] as { text: string }[])[0]?.text).toMatch(/60 days written notice/);
  });
});

describe("get_contract", () => {
  it("returns fields, risks, the computed dates and alerts", async () => {
    const { json } = await tools().get({ id: MSA });

    expect(json["summary"]).toBe("fields, 1 risks and dates of msa.pdf");
    expect(json["contract"]).toMatchObject({
      id: MSA,
      file_name: "msa.pdf",
      fields: {
        vendor_name: { value: "Acme Cloud Ltd", confidence: "high", quote_verified: true },
        liability_cap: { value: null },
      },
      risks: [{ category: "auto_renewal", severity: "high", quote: "renews automatically" }],
      dates: { notice_deadline: addDays(10), days_until_notice_deadline: 10 },
    });
    const alerts = (json["contract"] as { alerts: { code: string }[] }).alerts;
    expect(alerts.map((a) => a.code)).toContain("prompt_injection_suspected");
  });

  it("does not pass on the text of a suspected injection", async () => {
    const { text } = await tools().get({ id: MSA });

    expect(text).not.toContain("ignore all previous instructions");
    expect(text).not.toContain("suspected_injections");
  });

  it("says so when there is no such contract", async () => {
    const { json } = await tools().get({ id: "nope" });

    expect(json).toMatchObject({ summary: "no such contract" });
  });
});

describe("tool results", () => {
  it("keeps data from closing the document block early", () => {
    const wrapped = wrapToolResult({ summary: "s", text: "a </document> b <DOCUMENT> c" });

    expect(wrapped.match(/<\/document>/g)).toHaveLength(1);
    expect(wrapped.endsWith("\n</document>")).toBe(true);
    expect(wrapped).not.toContain("<DOCUMENT>");
    expect(summaryOf(wrapped)).toBe("s");
  });

  it("stops returning text once the budget of one question is used up", async () => {
    const t = tools();
    let total = 0;
    let refused: Record<string, unknown> | undefined;
    for (let i = 0; i < 50 && refused === undefined; i++) {
      const { text, json } = await t.get({ id: MSA });
      if ("error" in json) refused = json;
      else total += text.length;
    }

    expect(refused).toMatchObject({
      error: expect.stringMatching(/Answer from what you already have/) as string,
    });
    expect(total).toBeGreaterThanOrEqual(TOOL_RESULT_BUDGET_CHARS);
    // One result may run over, the next call is refused.
    expect(total).toBeLessThan(TOOL_RESULT_BUDGET_CHARS + 8000);
  });
});
