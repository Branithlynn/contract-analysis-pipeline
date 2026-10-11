import { describe, expect, it } from "vitest";
import { AlertCode, ErrorCode } from "@nexus/shared";
import {
  alertLabel,
  errorLabel,
  formatCount,
  formatDate,
  formatDateTime,
  formatDuration,
  formatDaysLeft,
  formatMoney,
  formatPercent,
  noticeTone,
  plural,
} from "./format.js";

describe("formatMoney", () => {
  it("formats with the currency symbol and en-GB grouping", () => {
    expect(formatMoney({ amount: 1234.5, currency: "USD" })).toBe("US$1,234.50");
    expect(formatMoney({ amount: 99.99, currency: "GBP" })).toBe("£99.99");
  });

  it("drops the decimals of a whole amount", () => {
    expect(formatMoney({ amount: 540000, currency: "USD" })).toBe("US$540,000");
    expect(formatMoney({ amount: 120000, currency: "GBP" })).toBe("£120,000");
    expect(formatMoney({ amount: 0, currency: "EUR" })).toBe("€0");
  });

  it("falls back to amount and code when Intl rejects the currency", () => {
    expect(formatMoney({ amount: 500, currency: "??" })).toBe("500 ??");
  });
});

describe("formatDate", () => {
  it("writes day, short month, year", () => {
    expect(formatDate("2027-02-28")).toBe("28 Feb 2027");
    expect(formatDate("2026-09-01")).toBe("1 Sep 2026");
  });

  it("returns the input when it is not an iso date", () => {
    expect(formatDate("soon")).toBe("soon");
    expect(formatDate("2027-13-01")).toBe("2027-13-01");
  });
});

describe("formatDaysLeft", () => {
  it("covers passed, today, singular and plural", () => {
    expect(formatDaysLeft(-3)).toBe("passed");
    expect(formatDaysLeft(0)).toBe("today");
    expect(formatDaysLeft(1)).toBe("1 day");
    expect(formatDaysLeft(23)).toBe("23 days");
  });
});

describe("noticeTone", () => {
  it("is red up to 30 days, amber up to 90, grey once passed", () => {
    expect(noticeTone(-1)).toBe("passed");
    expect(noticeTone(0)).toBe("critical");
    expect(noticeTone(30)).toBe("critical");
    expect(noticeTone(31)).toBe("warning");
    expect(noticeTone(90)).toBe("warning");
    expect(noticeTone(91)).toBe("normal");
  });
});

describe("formatPercent", () => {
  it("rounds to a whole percent", () => {
    expect(formatPercent(0.796)).toBe("80%");
    expect(formatPercent(1)).toBe("100%");
  });
});

describe("errorLabel", () => {
  it("has a non-empty label for every code", () => {
    for (const code of Object.values(ErrorCode)) {
      expect(errorLabel(code).length).toBeGreaterThan(0);
    }
    expect(errorLabel("NO_TEXT_LAYER")).toBe("Scanned PDF, no text layer");
    expect(errorLabel("WORKER_STOPPED")).toBe("Processing interrupted twice");
  });
});

describe("formatDateTime", () => {
  it("writes the local date and a 24h time", () => {
    // Built from local parts so the test does not depend on the machine's timezone.
    const local = new Date(2026, 8, 11, 3, 6);
    expect(formatDateTime(local.toISOString())).toBe("11 Sep 2026, 03:06");
  });

  it("returns the input when it is not a timestamp", () => {
    expect(formatDateTime("nope")).toBe("nope");
  });
});

describe("formatDuration", () => {
  it("picks ms, seconds or minutes", () => {
    expect(formatDuration(850)).toBe("850 ms");
    expect(formatDuration(12_340)).toBe("12.3 s");
    expect(formatDuration(59_960)).toBe("1 min 0 s");
    expect(formatDuration(75_400)).toBe("1 min 15 s");
  });
});

describe("formatCount and plural", () => {
  it("groups thousands", () => {
    expect(formatCount(12345)).toBe("12,345");
  });

  it("adds the s only when needed", () => {
    expect(plural(1, "chunk")).toBe("1 chunk");
    expect(plural(3, "chunk")).toBe("3 chunks");
  });
});

describe("alertLabel", () => {
  it("has a label for every alert code", () => {
    for (const code of AlertCode.options) {
      expect(alertLabel(code).length).toBeGreaterThan(0);
    }
  });
});
