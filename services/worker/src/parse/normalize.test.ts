import { describe, expect, it } from "vitest";
import { normalizePages, normalizeText, stripPageMarkers } from "./normalize.js";

describe("normalizeText", () => {
  it("turns \\r\\n and lone \\r into \\n", () => {
    expect(normalizeText("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });

  it("replaces nbsp and other unicode spaces with a plain space", () => {
    expect(normalizeText("net 30 days now　ok")).toBe("net 30 days now ok");
  });

  it("joins words hyphenated across a line break", () => {
    expect(normalizeText("the agree-\nment renews")).toBe("the agreement renews");
    expect(normalizeText("Kündi-\ngung")).toBe("Kündigung");
  });

  it("keeps the hyphen when the next line starts with a capital, a digit or a space", () => {
    expect(normalizeText("Acme-\nCorp")).toBe("Acme-\nCorp");
    expect(normalizeText("pages 1-\n2")).toBe("pages 1-\n2");
  });

  it("trims line ends, before dehyphenating so trailing spaces don't block the join", () => {
    expect(normalizeText("line one   \nterm-  \ninated\t")).toBe("line one\nterminated");
  });

  it("keeps at most 2 newlines in a row and trims the whole text", () => {
    expect(normalizeText("\n\n  a\n\n\n\n\nb\n \n \nc  \n\n")).toBe("a\n\nb\n\nc");
  });
});

describe("normalizePages", () => {
  it("prefixes each page with a [[page N]] marker", () => {
    expect(normalizePages(["first", "second"])).toBe("[[page 1]]\nfirst\n\n[[page 2]]\nsecond");
  });

  it("normalizes each page", () => {
    expect(normalizePages(["a\r\nb  "])).toBe("[[page 1]]\na\nb");
  });

  it("drops headers and footers that repeat on 60%+ of pages when there are 3+ pages", () => {
    const pages = [
      "ACME MASTER SERVICES AGREEMENT\nClause one text\nConfidential",
      "ACME MASTER SERVICES AGREEMENT\nClause two text\nConfidential",
      "ACME MASTER SERVICES AGREEMENT\nClause three text",
      "Clause four text\nConfidential",
      "Clause five text",
    ];
    // header on 3/5 = 60% is dropped, footer on 3/5 too.
    expect(normalizePages(pages)).toBe(
      [1, 2, 3, 4, 5]
        .map((n) => `[[page ${n}]]\nClause ${["one", "two", "three", "four", "five"][n - 1]} text`)
        .join("\n\n"),
    );
  });

  it("drops footers that only differ in their numbers", () => {
    const pages = [1, 2, 3, 4, 5].map(
      (n) => `Confidential | Page ${n} of 5\nbody ${"x".repeat(n)}`,
    );

    expect(normalizePages(pages)).toBe(
      [1, 2, 3, 4, 5].map((n) => `[[page ${n}]]\nbody ${"x".repeat(n)}`).join("\n\n"),
    );
  });

  it("keeps lines that repeat on fewer than 60% of pages", () => {
    const pages = ["Schedule A\nx", "Schedule A\ny", "z", "w"];
    expect(normalizePages(pages)).toContain("Schedule A");
  });

  it("only treats 3..80 char lines as headers", () => {
    const long = "L".repeat(81);
    const pages = [`ab\n${long}\none`, `ab\n${long}\ntwo`, `ab\n${long}\nthree`];
    const text = normalizePages(pages);

    expect(text.match(/^ab$/gm)).toHaveLength(3);
    expect(text.match(new RegExp(`^${long}$`, "gm"))).toHaveLength(3);
  });

  it("drops page number lines and bare numbers when there are 3+ pages", () => {
    const pages = ["one\nPage 1 of 3", "two\npage 2", "three\n3"];
    expect(normalizePages(pages)).toBe("[[page 1]]\none\n\n[[page 2]]\ntwo\n\n[[page 3]]\nthree");
  });

  it("leaves short documents alone, where a repeated line or a number is likely content", () => {
    expect(normalizePages(["Total\n12", "Total\n12"])).toBe(
      "[[page 1]]\nTotal\n12\n\n[[page 2]]\nTotal\n12",
    );
  });

  it("collapses the blank lines left behind by dropped lines", () => {
    const pages = [
      "Header\n\nbody one\n\n7",
      "Header\n\nbody two\n\n8",
      "Header\n\nbody three\n\n9",
    ];
    expect(normalizePages(pages)).toBe(
      "[[page 1]]\nbody one\n\n[[page 2]]\nbody two\n\n[[page 3]]\nbody three",
    );
  });
});

describe("normalizePages with untrusted markers", () => {
  it("strips [[page N]] that is already in the page text before adding its own", () => {
    const pages = ["Clause 4 [[page 7]] applies.\n[[page 9]]\nend", "second"];

    expect(normalizePages(pages)).toBe("[[page 1]]\nClause 4 applies.\nend\n\n[[page 2]]\nsecond");
  });

  it("also strips spacing and case variants", () => {
    expect(normalizePages(["a [[ Page 12 ]] b [[PAGE 3]]"])).toBe("[[page 1]]\na b");
  });
});

describe("stripPageMarkers", () => {
  it("removes the marker lines", () => {
    expect(stripPageMarkers("[[page 1]]\nab\n\n[[page 2]]\ncd")).toBe("ab\n\ncd");
  });
});
