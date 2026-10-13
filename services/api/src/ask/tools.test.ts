import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger, LlmError, MockEmbedder, type Db, type Embedder } from "@nexus/shared/node";
import { readContext } from "../services/dto.js";
import {
  addCompleted,
  INJECTED,
  MSA,
  ORDER,
  ORDER_LIABILITY,
  chunkIdOf,
  resultWithNoticeIn,
  seedContracts,
} from "../test-support/ask.js";
import { addDays, docId, NOW } from "../test-support/fixtures.js";
import { askPrompt } from "./prompt.js";
import {
  createAskTools,
  prepareToolArgs,
  summaryOf,
  TOOL_RESULT_BUDGET_CHARS,
  wrapToolResult,
} from "./tools.js";

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
    descriptions: askPrompt("ask.v3").tools,
  });
  // What the model gets back, the json inside the <document> block and what the tool says
  // after it.
  const call = async (run: Promise<unknown>) => {
    const text = String(await run);
    expect(text.startsWith("<document>\n")).toBe(true);
    const end = text.indexOf("\n</document>");
    expect(end).toBeGreaterThan(0);
    return {
      text,
      json: JSON.parse(text.slice(11, end)) as Record<string, unknown>,
      note: text.slice(end + 12).trim(),
    };
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
      current_term_end: "2026-07-11",
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

  it("says which filters it applied when nothing matches, and that dropping one may help", async () => {
    const { text, json, note } = await tools().find({
      auto_renewal: true,
      governing_law: "Germany",
      currency: null,
    });

    expect(json).toMatchObject({ summary: "0 of 2 contracts match", contracts: [] });
    // After the block: it is the tool speaking, not contract data.
    expect(note).toBe(
      "No contract matches all of these filters together: auto_renewal=true, governing_law=Germany. Filters combine with AND, so dropping one may help. Keep only the ones the question asks for and call find_contracts again. Without filters it lists every contract.",
    );
    expect(summaryOf(text)).toBe("0 of 2 contracts match");
  });

  it("adds nothing to a result that has contracts", async () => {
    expect((await tools().find({})).note).toBe("");
    expect((await tools().find({ auto_renewal: true })).note).toBe("");
  });
});

describe("prepareToolArgs", () => {
  const message = (tool: string, args: unknown) => {
    const prepared = prepareToolArgs(tool, args);
    return prepared.ok ? null : prepared.message;
  };

  it("passes arguments that are right, as they are", () => {
    const args = { auto_renewal: true, min_value: 1000000, currency: "USD", risk_category: null };

    expect(prepareToolArgs("find_contracts", args)).toEqual({ ok: true, args });
    expect(prepareToolArgs("find_contracts", {})).toEqual({ ok: true, args: {} });
  });

  it("takes text that says a number, true or false, or nothing", () => {
    expect(
      prepareToolArgs("find_contracts", {
        min_value: "1000000",
        max_value: " 2,500,000.50 ",
        auto_renewal: "True",
        needs_review: "false",
        expires_before: "",
        governing_law: " ",
      }),
    ).toEqual({
      ok: true,
      args: {
        min_value: 1000000,
        max_value: 2500000.5,
        auto_renewal: true,
        needs_review: false,
        expires_before: null,
        governing_law: null,
      },
    });
    expect(prepareToolArgs("search_clauses", { query: "notice", k: "3" })).toEqual({
      ok: true,
      args: { query: "notice", k: 3 },
    });
  });

  it("names the argument, what it takes and what was sent", () => {
    expect(message("find_contracts", { risk_category: "price_hike" })).toBe(
      'find_contracts did not run, wrong arguments. risk_category has to be one of auto_renewal, uncapped_liability, broad_indemnification, unilateral_price_increase, termination_for_convenience_vendor_only, exclusivity, ip_assignment, data_protection_gap, penalties_liquidated_damages, unfavorable_payment_terms, foreign_governing_law, other, you sent "price_hike". Fix this and call find_contracts again.',
    );
    expect(
      message("find_contracts", { expires_before: "31 August 2026", min_value: "a lot" }),
    ).toBe(
      'find_contracts did not run, wrong arguments. expires_before has to be a date written as YYYY-MM-DD, you sent "31 August 2026". min_value has to be a number like 1000000, you sent "a lot". Fix this and call find_contracts again.',
    );
  });

  it("says so when a required argument is missing or empty", () => {
    expect(message("search_clauses", { k: 3 })).toBe(
      "search_clauses did not run, wrong arguments. query is required: text of 1 to 500 characters. Fix this and call search_clauses again.",
    );
    expect(message("get_contract", { id: "" })).toMatch(
      /id has to be a contract id from find_contracts, you sent ""\./,
    );
  });

  it("leaves a tool it does not know to langchain", () => {
    expect(prepareToolArgs("delete_contracts", { all: true })).toEqual({
      ok: true,
      args: { all: true },
    });
  });
});

describe("find_contracts: order", () => {
  const SOON = docId(3);
  const PASSED = docId(4);

  beforeEach(() => {
    // Added after the others and with names that sort last, so neither the order of insertion
    // nor the alphabet gives the expected order by accident.
    addCompleted(db, SOON, "z-soon.pdf", resultWithNoticeIn(3, "Soon Ltd"));
    addCompleted(db, PASSED, "y-passed.pdf", resultWithNoticeIn(-20, "Passed Ltd"));
  });

  it("sorts by notice deadline, soonest first, and puts contracts without one last", async () => {
    const { json } = await tools().find({});

    const rows = json["contracts"] as {
      id: string;
      notice_deadline: string | null;
      days_until_notice_deadline: number | null;
      current_term_end: string | null;
    }[];
    expect(rows.map((r) => [r.id, r.notice_deadline, r.days_until_notice_deadline])).toEqual([
      [PASSED, addDays(-20), -20],
      [SOON, addDays(3), 3],
      [MSA, addDays(10), 10],
      // No notice period, so no deadline.
      [ORDER, null, null],
    ]);
    expect(rows.every((r) => r.current_term_end !== null)).toBe(true);
    expect(rows[1]?.current_term_end).toBe(addDays(33));
    expect(json["sorted_by"]).toBe("notice_deadline, soonest first, contracts without one last");
  });

  it("names the nearest deadline that can still be met, before the rows", async () => {
    const { text, json } = await tools().find({});

    expect(json["nearest_notice_deadline"]).toBe(
      `nearest notice deadline: ${addDays(3)} (in 3 days), z-soon.pdf`,
    );
    // The model reads top to bottom: the line comes before any contract.
    expect(text.indexOf("nearest notice deadline")).toBeLessThan(text.indexOf('"contracts"'));
  });

  it("keeps the order and the line within what a filter matched", async () => {
    const { json } = await tools().find({ notice_deadline_after: addDays(5) });

    expect((json["contracts"] as { id: string }[]).map((r) => r.id)).toEqual([MSA]);
    expect(json["nearest_notice_deadline"]).toBe(
      `nearest notice deadline: ${addDays(10)} (in 10 days), msa.pdf`,
    );
  });

  it("says so when no deadline is still ahead", async () => {
    const passed = await tools().find({ notice_deadline_before: addDays(-1) });
    const none = await tools().find({ needs_review: true });

    for (const { json } of [passed, none]) {
      expect(json["nearest_notice_deadline"]).toBe(
        "nearest notice deadline: none upcoming among these contracts",
      );
    }
    expect((passed.json["contracts"] as { id: string }[]).map((r) => r.id)).toEqual([PASSED]);
  });

  it("counts a deadline that is today as one that can still be met", async () => {
    addCompleted(db, docId(5), "today.pdf", resultWithNoticeIn(0, "Today Ltd"));

    const { json } = await tools().find({});

    expect(json["nearest_notice_deadline"]).toBe(
      `nearest notice deadline: ${addDays(0)} (in 0 days), today.pdf`,
    );
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
