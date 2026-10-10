import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv.js";

describe("csvCell", () => {
  it("leaves plain values bare and writes null as empty", () => {
    expect(csvCell("Acme Ltd")).toBe("Acme Ltd");
    expect(csvCell(120000.5)).toBe("120000.5");
    expect(csvCell(true)).toBe("true");
    expect(csvCell(null)).toBe("");
  });

  it("quotes commas, quotes and line breaks, doubling inner quotes (rfc 4180)", () => {
    expect(csvCell("Acme, Inc.")).toBe('"Acme, Inc."');
    expect(csvCell('The "Vendor"')).toBe('"The ""Vendor"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("line1\r\nline2")).toBe('"line1\r\nline2"');
  });

  it.each(['=HYPERLINK("http://x")', "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"])(
    "prefixes a ' to the formula-like string %j",
    (value) => {
      expect(csvCell(value).replace(/^"|"$/g, "").startsWith("'")).toBe(true);
    },
  );

  it("escapes before quoting, so the ' ends up inside the quotes", () => {
    expect(csvCell('=HYPERLINK("http://x","click")')).toBe(
      '"\'=HYPERLINK(""http://x"",""click"")"',
    );
  });

  it("does not touch numbers we produce, so a negative day count stays a number", () => {
    expect(csvCell(-5)).toBe("-5");
  });
});

describe("toCsv", () => {
  it("writes a header and rows with CRLF line endings, ending in CRLF", () => {
    expect(
      toCsv(
        ["a", "b"],
        [
          ["x", 1],
          [null, "y,z"],
        ],
      ),
    ).toBe('a,b\r\nx,1\r\n,"y,z"\r\n');
  });
});
