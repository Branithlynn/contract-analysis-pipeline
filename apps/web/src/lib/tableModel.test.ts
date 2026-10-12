import { describe, expect, it } from "vitest";
import type { DocumentSummary } from "@nexus/shared";
import { countByStatus, sortDocuments } from "./tableModel.js";

function doc(id: string, over: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    id,
    original_name: `${id}.pdf`,
    status: "completed",
    stage: null,
    needs_review: false,
    error_code: null,
    error_message: null,
    duplicate_of: null,
    index_status: null,
    requested_provider: null,
    requested_model: null,
    result_provider: null,
    result_model: null,
    result_prompt_version: null,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    vendor_name: null,
    total_contract_value: null,
    expiration_date: null,
    notice_deadline: null,
    days_until_notice_deadline: null,
    max_risk_severity: null,
    risk_count: null,
    grounding_score: null,
    ...over,
  };
}

function ids(docs: DocumentSummary[]): string[] {
  return docs.map((d) => d.id);
}

describe("sortDocuments", () => {
  it("puts the newest first by default and leaves the input alone", () => {
    const input = [
      doc("old", { created_at: "2026-10-01T00:00:00.000Z" }),
      doc("new", { created_at: "2026-10-03T00:00:00.000Z" }),
      doc("mid", { created_at: "2026-10-02T00:00:00.000Z" }),
    ];
    expect(ids(sortDocuments(input, "newest"))).toEqual(["new", "mid", "old"]);
    expect(ids(input)).toEqual(["old", "new", "mid"]);
  });

  it("sorts notice by upcoming first (0 included), then passed, then nulls", () => {
    const input = [
      doc("none"),
      doc("far", { days_until_notice_deadline: 200 }),
      doc("long-passed", { days_until_notice_deadline: -40 }),
      doc("soon", { days_until_notice_deadline: 23 }),
      doc("just-passed", { days_until_notice_deadline: -1 }),
      doc("today", { days_until_notice_deadline: 0 }),
    ];
    expect(ids(sortDocuments(input, "notice"))).toEqual([
      "today",
      "soon",
      "far",
      "just-passed",
      "long-passed",
      "none",
    ]);
  });

  it("sorts risk by severity, then count, nulls last", () => {
    const input = [
      doc("none"),
      doc("low", { max_risk_severity: "low", risk_count: 9 }),
      doc("high2", { max_risk_severity: "high", risk_count: 2 }),
      doc("medium", { max_risk_severity: "medium", risk_count: 4 }),
      doc("high5", { max_risk_severity: "high", risk_count: 5 }),
      // An extraction with no risk clauses: count 0 and no severity.
      doc("clean", { max_risk_severity: null, risk_count: 0 }),
    ];
    expect(ids(sortDocuments(input, "risk"))).toEqual([
      "high5",
      "high2",
      "medium",
      "low",
      "clean",
      "none",
    ]);
  });

  it("breaks ties by newest", () => {
    const input = [
      doc("older", { days_until_notice_deadline: 10, created_at: "2026-10-01T00:00:00.000Z" }),
      doc("newer", { days_until_notice_deadline: 10, created_at: "2026-10-02T00:00:00.000Z" }),
    ];
    expect(ids(sortDocuments(input, "notice"))).toEqual(["newer", "older"]);
  });
});

describe("countByStatus", () => {
  it("counts every status and the completed ones needing review", () => {
    const counts = countByStatus([
      doc("a", { status: "queued" }),
      doc("b", { status: "processing" }),
      doc("c"),
      doc("d", { needs_review: true }),
      doc("e", { status: "failed" }),
      doc("f", { status: "failed" }),
    ]);
    expect(counts).toEqual({ queued: 1, processing: 1, completed: 2, failed: 2, needs_review: 1 });
  });

  it("is all zero for an empty list", () => {
    expect(countByStatus([])).toEqual({
      queued: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      needs_review: 0,
    });
  });
});
