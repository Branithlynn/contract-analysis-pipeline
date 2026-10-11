import { describe, expect, it } from "vitest";
import { chunkText } from "./chunk.js";

const HEADING = /^(?:\[\[page \d+\]\]\n)?\d+\. Section \d+$/m;

function body(label: string, length: number): string {
  return `${label} `.padEnd(length, "x");
}

function section(n: number, bodies: number, bodyLength: number): string {
  const paras = Array.from({ length: bodies }, (_, i) => body(`s${n}p${i}`, bodyLength));
  return [`${n}. Section ${n}`, ...paras].join("\n\n");
}

function blocksOf(chunk: string): string[] {
  return chunk.split("\n\n");
}

describe("chunkText", () => {
  it("returns the whole text as one chunk when it fits", () => {
    const text = "[[page 1]]\n1. Fees\n\nUSD 1,000 per month.";
    expect(chunkText(text, 12000)).toEqual([{ index: 0, text }]);
  });

  it("cuts a 3x budget doc on headings, so no section is split from its heading", () => {
    const sections = Array.from({ length: 7 }, (_, i) => section(i + 1, 2, 600));
    const text = sections.join("\n\n");
    expect(text.length).toBeGreaterThan(3 * 3000 - 1000);

    const chunks = chunkText(text, 3000);

    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const s of sections) expect(chunks.some((c) => c.text.includes(s))).toBe(true);
    for (let i = 1; i < chunks.length; i++) {
      const prev = blocksOf(chunks[i - 1]?.text ?? "");
      const own = blocksOf(chunks[i]?.text ?? "");
      // Drop the overlap block, what's left starts on a heading.
      const fresh = own[0] === prev.at(-1) ? own.slice(1) : own;
      expect(fresh[0]).toMatch(HEADING);
    }
  });

  it("splits a block bigger than the budget at the last sentence end before the limit", () => {
    const sentences = Array.from({ length: 120 }, (_, i) => `Sentence ${i} is here.`);
    const text = sentences.join(" ");

    const chunks = chunkText(text, 1000);

    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(1000);
      expect(c.text).toMatch(/^Sentence \d+ is here\./);
      expect(c.text).toMatch(/is here\.$/);
    }
    for (const s of sentences) expect(chunks.some((c) => c.text.includes(s))).toBe(true);
  });

  it("hard cuts a giant block with no sentence end", () => {
    const text = "x".repeat(2500);
    expect(chunkText(text, 1000).map((c) => c.text.length)).toEqual([1000, 1000, 500]);
  });

  it("starts the next chunk with the previous chunk's last block when it is short", () => {
    const text = [body("a", 400), body("b", 400), body("c", 400)].join("\n\n");

    const chunks = chunkText(text, 1000);

    expect(chunks.map((c) => blocksOf(c.text))).toEqual([
      [body("a", 400), body("b", 400)],
      [body("b", 400), body("c", 400)],
    ]);
  });

  it("skips the overlap when the last block is over 1500 chars", () => {
    const text = [body("a", 1600), body("b", 1600), body("c", 1600)].join("\n\n");

    const chunks = chunkText(text, 3300);

    expect(chunks.map((c) => blocksOf(c.text))).toEqual([
      [body("a", 1600), body("b", 1600)],
      [body("c", 1600)],
    ]);
  });

  it("prepends the last seen page marker to a chunk that starts mid page", () => {
    const text = [
      `[[page 1]]\n${body("a", 400)}`,
      body("b", 400),
      body("c", 400),
      `[[page 2]]\n${body("d", 400)}`,
    ].join("\n\n");

    const chunks = chunkText(text, 1000);

    expect(chunks.map((c) => c.text.split("\n")[0])).toEqual([
      "[[page 1]]",
      "[[page 1]]",
      "[[page 1]]",
    ]);
    expect(chunks[1]?.text).toBe(`[[page 1]]\n${body("b", 400)}\n\n${body("c", 400)}`);
    expect(chunks[2]?.text).toBe(`[[page 1]]\n${body("c", 400)}\n\n[[page 2]]\n${body("d", 400)}`);
  });

  it("puts every block of a 100 clause doc in some chunk and keeps chunks within budget", () => {
    let seed = 7;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const blocks: string[] = [];
    for (let n = 1; n <= 100; n++) {
      const heading = `${n}. Clause ${n}`;
      blocks.push(n % 6 === 1 ? `[[page ${Math.ceil(n / 6)}]]\n${heading}` : heading);
      const paras = 1 + Math.floor(next() * 3);
      for (let p = 0; p < paras; p++)
        blocks.push(body(`c${n}p${p}`, 50 + Math.floor(next() * 900)));
    }
    const text = blocks.join("\n\n");

    const chunks = chunkText(text, 2000);

    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(2000);
      expect(c.text).toMatch(/^\[\[page \d+\]\]\n/);
    }
    for (const b of blocks) expect(chunks.some((c) => c.text.includes(b))).toBe(true);
  });
});
