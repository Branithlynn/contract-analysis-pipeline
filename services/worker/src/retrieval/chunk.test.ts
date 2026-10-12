import { describe, expect, it } from "vitest";
import { chunkForRetrieval, RETRIEVAL_CHUNK_CHARS, RETRIEVAL_OVERLAP_CHARS } from "./chunk.js";

function sentence(label: string, length: number): string {
  return `${label} `.padEnd(length - 1, "x") + ".";
}

// Sentences of 100 chars, five to a paragraph.
function paragraphs(count: number, prefix = "p"): string {
  return Array.from({ length: count }, (_, p) =>
    Array.from({ length: 5 }, (_, s) => sentence(`${prefix}${p}s${s}`, 100)).join(" "),
  ).join("\n\n");
}

describe("chunkForRetrieval", () => {
  it("returns a short text as one chunk without the page marker", () => {
    const chunks = chunkForRetrieval("[[page 1]]\n1. Fees\n\nUSD 1,000 per month.");

    expect(chunks).toEqual([{ index: 0, page: 1, text: "1. Fees\n\nUSD 1,000 per month." }]);
  });

  it("returns nothing for text that is only whitespace and markers", () => {
    expect(chunkForRetrieval("[[page 1]]\n\n[[page 2]]\n  ")).toEqual([]);
  });

  it("keeps every chunk within the limit and numbers them in order", () => {
    const chunks = chunkForRetrieval(paragraphs(12));

    expect(chunks.length).toBeGreaterThan(4);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(RETRIEVAL_CHUNK_CHARS);
    // Small chunks, not the extraction's 12000.
    for (const c of chunks.slice(0, -1)) expect(c.text.length).toBeGreaterThan(900);
  });

  it("cuts on sentence ends and keeps paragraph breaks inside a chunk", () => {
    const text = paragraphs(12);
    const chunks = chunkForRetrieval(text);

    for (const c of chunks) {
      expect(c.text).toMatch(/^p\d+s\d+ /);
      expect(c.text).toMatch(/x\.$/);
    }
    expect(chunks[0]?.text).toContain("\n\n");
    // Nothing is lost: every sentence of the document is in some chunk.
    for (const s of text.split(/\s+(?=p\d)/)) {
      expect(chunks.some((c) => c.text.includes(s))).toBe(true);
    }
  });

  it("repeats the last sentences of a chunk at the start of the next one", () => {
    const chunks = chunkForRetrieval(paragraphs(12));

    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1]?.text ?? "";
      const own = chunks[i]?.text ?? "";
      // 100 char sentences: exactly one fits the 200 char overlap with its separator, two do not
      // when a paragraph break sits between them.
      const first = own.slice(0, 100);
      expect(prev.endsWith(first) || prev.includes(first)).toBe(true);
      const shared = [...own.matchAll(/p\d+s\d+ x+\./g)].filter((m) => prev.includes(m[0]));
      expect(shared.length).toBeGreaterThanOrEqual(1);
      expect(shared.reduce((n, m) => n + m[0].length, 0)).toBeLessThanOrEqual(
        RETRIEVAL_OVERLAP_CHARS,
      );
    }
  });

  it("overlaps with the tail of a sentence that is longer than the overlap", () => {
    const long = Array.from({ length: 6 }, (_, i) =>
      `Clause ${i} ${"word ".repeat(120)}`.trim().concat("."),
    ).join(" ");

    const chunks = chunkForRetrieval(long);

    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1]?.text ?? "";
      const head = (chunks[i]?.text ?? "").slice(0, 60);
      expect(prev).toContain(head);
      // The tail starts on a word, not in the middle of one.
      expect(head).toMatch(/^word /);
    }
  });

  it("splits a run of text with no sentence end and no spaces by length", () => {
    const chunks = chunkForRetrieval("x".repeat(3000), 1000, 0);

    expect(chunks.map((c) => c.text.length)).toEqual([1000, 1000, 1000]);
  });

  it("gives every chunk the page its own text starts on", () => {
    const text = [1, 2, 3].map((n) => `[[page ${n}]]\n${paragraphs(4, `pg${n}p`)}`).join("\n\n");

    const chunks = chunkForRetrieval(text);

    expect(new Set(chunks.map((c) => c.page))).toEqual(new Set([1, 2, 3]));
    for (const c of chunks) {
      expect(c.text).not.toContain("[[page");
      // The first sentence may be overlap from the page before. The first new one decides.
      const labels = [...c.text.matchAll(/pg(\d)p\d+s\d+/g)].map((m) => Number(m[1]));
      expect(labels).toContain(c.page);
      expect(labels.filter((n) => n < (c.page ?? 0)).length).toBeLessThanOrEqual(2);
    }
    // Pages only go up.
    const pages = chunks.map((c) => c.page ?? 0);
    expect(pages).toEqual([...pages].sort((a, b) => a - b));
  });

  it("uses null as the page for text without markers, like docx", () => {
    const chunks = chunkForRetrieval(paragraphs(6));

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.page).toBeNull();
  });

  it("is deterministic", () => {
    const text = `[[page 1]]\n${paragraphs(9)}`;
    expect(chunkForRetrieval(text)).toEqual(chunkForRetrieval(text));
  });

  it("rejects limits that cannot work", () => {
    expect(() => chunkForRetrieval("text", 0)).toThrow(RangeError);
    expect(() => chunkForRetrieval("text", 100, 100)).toThrow(RangeError);
    expect(() => chunkForRetrieval("text", 100, -1)).toThrow(RangeError);
  });
});
