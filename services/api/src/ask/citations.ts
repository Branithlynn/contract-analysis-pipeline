import {
  buildGroundingIndex,
  ExtractedFieldName,
  normalizeForMatch,
  pagesOfQuote,
  verifyQuote,
  type AskCitation,
  type ExtractionResult,
} from "@nexus/shared";
import type { ChunkHit } from "@nexus/shared/node";
import type { ContractRow } from "./tools.js";

// The model is told to cite. Whether it did so honestly is checked here, in code, after it
// finished: the source has to exist and words the answer puts in quotes have to be in it. A
// citation that fails stays in the response and is marked, so the ui can show that the sentence
// in front of it is not backed.

export interface CitationSources {
  // Undefined for a chunk that does not exist or is flagged as an injection.
  chunk(id: number): ChunkHit | undefined;
  contract(id: string): ContractRow | undefined;
}

const MARKER = /\[(chunk|contract):\s*([^\]\s]+)\s*\]/gi;
// Straight or curly double quotes, on one line.
const QUOTED = /"([^"\n]+)"|“([^”\n]+)”/g;
// "A" or "B" in a list of options is not a quote from a contract.
const MIN_QUOTE_CHARS = 3;
// Citations with only this between them back the same sentence: [chunk:1], [chunk:2] and [chunk:3]
const SAME_GROUP = /^[\s,;]*(?:and)?\s*$/i;

// An answer as plain text, for the search index over earlier chats: a marker is an id, not
// something that was said.
export function stripCitationMarkers(answer: string): string {
  return answer.replace(MARKER, "").replace(/[ \t]+([.,;:])/g, "$1");
}

interface Marker {
  marker: string;
  start: number;
  end: number;
  kind: "chunk" | "contract";
  id: string;
}

interface Group {
  markers: Marker[];
  // The quoted texts between the previous group and this one.
  quotes: string[];
}

function parse(answer: string): Group[] {
  const groups: Group[] = [];
  let previousEnd = 0;
  let groupLeadStart = 0;
  for (const m of answer.matchAll(MARKER)) {
    const kind = m[1]?.toLowerCase() === "chunk" ? "chunk" : "contract";
    const marker: Marker = {
      marker: m[0],
      start: m.index,
      end: m.index + m[0].length,
      kind,
      id: m[2] ?? "",
    };
    const last = groups.at(-1);
    if (last && SAME_GROUP.test(answer.slice(previousEnd, marker.start))) {
      last.markers.push(marker);
    } else {
      const lead = answer.slice(groupLeadStart, marker.start);
      const quotes = [...lead.matchAll(QUOTED)]
        .map((q) => (q[1] ?? q[2] ?? "").trim())
        .filter((q) => q.length >= MIN_QUOTE_CHARS);
      groups.push({ markers: [marker], quotes });
    }
    previousEnd = marker.end;
    groupLeadStart = marker.end;
  }
  return groups;
}

// The same matching the extraction's grounding uses, so a dropped space at a pdf line break or a
// quote shortened with "..." passes here as it does there. That matcher ignores pieces under 8
// characters, so a short quote ("Net 30") is looked up as plain text.
function contains(text: string, quote: string): boolean {
  const index = buildGroundingIndex(text);
  if (verifyQuote(index, quote).verified) return true;
  const needle = normalizeForMatch(quote);
  return needle !== "" && index.text.includes(needle);
}

// What a [contract:<id>] citation can be quoting: the extracted values and the quotes kept with
// them. The document itself is cited through its chunks.
function contractText(result: ExtractionResult): string {
  const parts: string[] = [result.summary];
  for (const name of ExtractedFieldName.options) {
    const field = result[name];
    if (field.value !== null) {
      parts.push(
        typeof field.value === "object" ? JSON.stringify(field.value) : String(field.value),
      );
    }
    if (field.quote !== null) parts.push(field.quote);
  }
  for (const risk of result.risk_clauses) parts.push(risk.title, risk.explanation, risk.quote);
  for (const [key, value] of Object.entries(result.derived)) {
    if (key !== "alerts" && value !== null) parts.push(String(value));
  }
  return parts.join("\n");
}

type Source =
  | { kind: "chunk"; chunk: ChunkHit; text: string }
  | { kind: "contract"; contract: ContractRow; text: string };

function resolve(marker: Marker, sources: CitationSources): Source | undefined {
  if (marker.kind === "chunk") {
    // Chunk ids are row ids. Anything else is an id the model made up.
    if (!/^\d{1,15}$/.test(marker.id)) return undefined;
    const chunk = sources.chunk(Number(marker.id));
    return chunk && { kind: "chunk", chunk, text: chunk.text };
  }
  const contract = sources.contract(marker.id);
  return contract && { kind: "contract", contract, text: contractText(contract.result) };
}

function fileNameOf(source: Source): string {
  const name = source.kind === "chunk" ? source.chunk.file_name : source.contract.file_name;
  return name.toLowerCase();
}

export function verifyCitations(answer: string, sources: CitationSources): AskCitation[] {
  const citations: AskCitation[] = [];
  for (const parsed of parse(answer)) {
    const resolved = parsed.markers.map((marker) => ({ marker, source: resolve(marker, sources) }));
    // A file name in double quotes names the source, it is not wording copied from it. The 7b
    // writes "saas-subscription.pdf" with Cloudhaven [contract:<id>], and every such citation
    // came out as quote not found, in the eval and in the chat alike.
    const names = new Set(
      resolved.flatMap(({ source }) => (source === undefined ? [] : [fileNameOf(source)])),
    );
    const group = {
      ...parsed,
      quotes: parsed.quotes.filter((quote) => !names.has(quote.toLowerCase())),
    };
    const found = resolved.map(({ source }) =>
      group.quotes.map((quote) => source !== undefined && contains(source.text, quote)),
    );
    // A quote counts when any source of its group has it. One that none has leaves the whole
    // group unverified: there is no telling which citation it was meant for.
    const everyQuoteBacked = group.quotes.every((_, q) => found.some((row) => row[q] === true));

    resolved.forEach(({ marker, source }, i) => {
      const quotes = group.quotes.map((text, q) => {
        const here = found[i]?.[q] === true;
        const pages = here && source?.kind === "chunk" ? pagesOfQuote(source.chunk, text) : null;
        return {
          text,
          found: here,
          page_start: pages?.page_start ?? null,
          page_end: pages?.page_end ?? null,
        };
      });
      const base = { marker: marker.marker, start: marker.start, kind: marker.kind, id: marker.id };
      if (source === undefined) {
        citations.push({
          ...base,
          status: "not_found",
          document_id: null,
          file_name: null,
          page_start: null,
          page_end: null,
          quotes,
        });
        return;
      }
      // The page a viewer should open: where the first quote is. The fuzzy matcher can accept a
      // quote that pagesOfQuote, which compares exactly, does not place. Then, and without a
      // quote, the chunk's own pages are the best there is.
      const placed = quotes.find((quote) => quote.page_start !== null);
      const chunk = source.kind === "chunk" ? source.chunk : undefined;
      citations.push({
        ...base,
        status: everyQuoteBacked ? "verified" : "quote_not_found",
        document_id: chunk?.document_id ?? marker.id,
        file_name: source.kind === "chunk" ? source.chunk.file_name : source.contract.file_name,
        page_start: placed?.page_start ?? chunk?.page_start ?? null,
        page_end: placed?.page_end ?? chunk?.page_end ?? null,
        quotes,
      });
    });
  }
  return citations;
}
