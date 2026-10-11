import { describe, expect, it } from "vitest";
import { dateAppearsIn, expirationBasis } from "./expiration.js";

describe("dateAppearsIn", () => {
  it.each([
    "and continues until 31 August 2026, when it expires.",
    "expires on 31st August 2026",
    "expires on 31 Aug 2026",
    "expires on 31 Aug. 2026",
    "expires on the 31st day of August, 2026",
    "expires on August 31, 2026",
    "expires on August 31st 2026",
    "expires on Aug. 31, 2026",
    "expires on 2026-08-31",
    "expires on 31/08/2026",
    "expires on 31.08.2026",
    "expires on 31-08-2026",
    "expires on 08/31/2026",
    "EXPIRES ON 31 AUGUST 2026",
    "continues until 31\nAugust\n2026",
  ])("finds 2026-08-31 in %j", (text) => {
    expect(dateAppearsIn("2026-08-31", text)).toBe(true);
  });

  it("finds a date with a single digit day and month", () => {
    expect(dateAppearsIn("2027-03-05", "ends on 5 March 2027")).toBe(true);
    expect(dateAppearsIn("2027-03-05", "ends on 5/3/2027")).toBe(true);
    expect(dateAppearsIn("2027-03-05", "ends on 2027-3-5")).toBe(true);
  });

  it.each([
    "This Agreement continues for 24 months from the Effective Date and then expires.",
    "continues for an initial term of 12 months (the Initial Term)",
    "expires on 30 August 2026",
    "expires on 31 August 2027",
    "expires on 31 July 2026",
    "expires in August 2026",
    "is effective as of 1 September 2025",
    "ref 20260831",
    "",
  ])("does not find 2026-08-31 in %j", (text) => {
    expect(dateAppearsIn("2026-08-31", text)).toBe(false);
  });

  it("does not take another word for a month", () => {
    expect(dateAppearsIn("2026-05-03", "pay 3 months 2026 fees")).toBe(false);
    expect(dateAppearsIn("2026-03-12", "clause 12 marks 2026 as the base year")).toBe(false);
  });

  it("returns false for a value that is not a date", () => {
    expect(dateAppearsIn("31 August 2026", "31 August 2026")).toBe(false);
  });
});

describe("expirationBasis", () => {
  it("is none without a value", () => {
    expect(expirationBasis({ value: null, quote: null, quote_verified: false })).toBe("none");
  });

  it("is stated when the verified quote has the date, as in gpt-5-mini's consulting answer", () => {
    expect(
      expirationBasis({
        value: "2026-08-31",
        quote: "and continues until 31 August 2026, when it expires.",
        quote_verified: true,
      }),
    ).toBe("stated");
  });

  it("is model_computed when the verified quote only gives a term, as in qwen's nda answer", () => {
    expect(
      expirationBasis({
        value: "2028-09-10",
        quote: "This Agreement continues for 24 months from the Effective Date and then expires.",
        quote_verified: true,
      }),
    ).toBe("model_computed");
  });

  it("is unverified when the quote was not found, whether or not it has the date", () => {
    expect(
      expirationBasis({
        value: "2026-08-31",
        quote: "This Agreement continues until 31 August 2026, when it expires.",
        quote_verified: false,
      }),
    ).toBe("unverified");
    expect(expirationBasis({ value: "2024-10-01", quote: null, quote_verified: false })).toBe(
      "unverified",
    );
  });
});
