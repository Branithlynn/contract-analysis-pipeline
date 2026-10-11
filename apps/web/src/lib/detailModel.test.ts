import { describe, expect, it } from "vitest";
import type { Alert } from "@nexus/shared";
import { canRetry, groupRisks, sortAlerts, splitWarnings, type RiskClause } from "./detailModel.js";

describe("splitWarnings", () => {
  it("separates review reasons from processing notes and strips the prefix", () => {
    const split = splitWarnings([
      'risk_clauses: dropped "Indemnity" (quote was "null")',
      "review: chunks disagree on expiration_date",
      "summary: merge call failed, using the first chunk summary",
      "review: auto-renews but the renewal term is unknown",
    ]);
    expect(split.review).toEqual([
      "chunks disagree on expiration_date",
      "auto-renews but the renewal term is unknown",
    ]);
    expect(split.notes).toEqual([
      'risk_clauses: dropped "Indemnity" (quote was "null")',
      "summary: merge call failed, using the first chunk summary",
    ]);
  });

  it("is empty for no warnings", () => {
    expect(splitWarnings([])).toEqual({ review: [], notes: [] });
  });
});

describe("sortAlerts", () => {
  it("orders critical, warning, info and keeps the order inside a level", () => {
    const alerts: Alert[] = [
      { level: "info", code: "notice_deadline_upcoming", message: "a" },
      { level: "warning", code: "expiration_mismatch", message: "b" },
      { level: "critical", code: "notice_deadline_soon", message: "c" },
      { level: "warning", code: "no_notice_period", message: "d" },
    ];
    expect(sortAlerts(alerts).map((a) => a.message)).toEqual(["c", "b", "d", "a"]);
  });
});

describe("groupRisks", () => {
  function clause(title: string, severity: RiskClause["severity"]): RiskClause {
    return {
      category: "other",
      severity,
      title,
      explanation: "why",
      quote: "text",
      quote_verified: true,
      quote_page: 1,
    };
  }

  it("groups high to low and leaves out empty severities", () => {
    const groups = groupRisks([clause("a", "low"), clause("b", "high"), clause("c", "high")]);
    expect(groups.map((g) => [g.severity, g.clauses.map((c) => c.title)])).toEqual([
      ["high", ["b", "c"]],
      ["low", ["a"]],
    ]);
  });

  it("returns nothing for no clauses", () => {
    expect(groupRisks([])).toEqual([]);
  });
});

describe("canRetry", () => {
  it("allows failed and completed documents that need review", () => {
    expect(canRetry({ status: "failed", needs_review: false })).toBe(true);
    expect(canRetry({ status: "completed", needs_review: true })).toBe(true);
  });

  it("refuses everything else", () => {
    expect(canRetry({ status: "completed", needs_review: false })).toBe(false);
    expect(canRetry({ status: "queued", needs_review: false })).toBe(false);
    expect(canRetry({ status: "processing", needs_review: true })).toBe(false);
  });
});
