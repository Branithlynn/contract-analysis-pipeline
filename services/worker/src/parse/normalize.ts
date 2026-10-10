// Lines on at least this share of pages are running headers or footers, not content.
const REPEATED_LINE_SHARE = 0.6;
// With 1 or 2 pages a repeated line is as likely to be content as a header.
const MIN_PAGES_FOR_REPEAT_CHECK = 3;
const MIN_HEADER_LENGTH = 3;
const MAX_HEADER_LENGTH = 80;
const PAGE_NUMBER_LINE = /^(?:page\s+\d+(?:\s+of\s+\d+)?|\d+)$/i;
const PAGE_MARKER_LINE = /^\[\[page \d+\]\]\n/gm;
// Looser than our own marker on purpose: anything a page lookup might mistake for one goes.
const UNTRUSTED_MARKER = String.raw`\[\[[^\S\n]*page[^\S\n]*\d+[^\S\n]*\]\]`;
const UNTRUSTED_MARKER_LINE = new RegExp(
  String.raw`^[^\S\n]*${UNTRUSTED_MARKER}[^\S\n]*(?:\n|$)`,
  "gim",
);
// The spaces before it go too, so "Clause 4 [[page 7]] applies." doesn't end up with a double space.
const UNTRUSTED_MARKER_INLINE = new RegExp(String.raw`[^\S\n]*${UNTRUSTED_MARKER}`, "gi");

function stripUntrustedMarkers(text: string): string {
  return text.replace(UNTRUSTED_MARKER_LINE, "").replace(UNTRUSTED_MARKER_INLINE, "");
}

function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

export function normalizeText(text: string): string {
  return collapseBlankLines(
    text
      .replace(/\r\n?/g, "\n")
      .replace(/\p{Zs}/gu, " ")
      // Before dehyphenating, so "agree-  \nment" still joins.
      .replace(/[^\S\n]+$/gm, "")
      // Only a lowercase continuation: "Acme-\nCorp" is a real hyphen at a line break.
      .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2"),
  );
}

// Footers like "Confidential | Page 3 of 12" differ on every page only in their numbers, so repeats
// are counted on a key with the digits masked.
function repeatKey(line: string): string {
  return line.trim().replace(/\d+/g, "#");
}

function repeatedLines(pages: readonly string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const page of pages) {
    const lines = new Set(
      page
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length >= MIN_HEADER_LENGTH && line.length <= MAX_HEADER_LENGTH)
        .map(repeatKey),
    );
    for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  const threshold = pages.length * REPEATED_LINE_SHARE;
  return new Set([...counts].filter(([, count]) => count >= threshold).map(([line]) => line));
}

function dropBoilerplate(pages: readonly string[]): string[] {
  const repeated = repeatedLines(pages);
  return pages.map((page) =>
    collapseBlankLines(
      page
        .split("\n")
        .filter((line) => {
          const trimmed = line.trim();
          return !repeated.has(repeatKey(trimmed)) && !PAGE_NUMBER_LINE.test(trimmed);
        })
        .join("\n"),
    ),
  );
}

// The [[page N]] markers are how a quote gets mapped back to its page later, which is more reliable
// than asking the model for page numbers. Document text is untrusted, so markers already in it are
// removed first; otherwise a fake one would shift every page lookup after it.
export function normalizePages(pages: readonly string[]): string {
  const normalized = pages.map((page) => normalizeText(stripUntrustedMarkers(page)));
  const cleaned =
    normalized.length >= MIN_PAGES_FOR_REPEAT_CHECK ? dropBoilerplate(normalized) : normalized;
  return cleaned.map((text, i) => `[[page ${i + 1}]]\n${text}`).join("\n\n");
}

export function stripPageMarkers(text: string): string {
  return text.replace(PAGE_MARKER_LINE, "");
}
