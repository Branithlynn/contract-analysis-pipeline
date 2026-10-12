import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { pagesOfQuote } from "@nexus/shared";
import { ApiError } from "../api/client.js";
import { useChunk } from "../api/hooks.js";
import { highlightQuote } from "../lib/chatModel.js";

export interface Passage {
  chunkId: number;
  // The words the answer quoted from the passage, when it quoted any.
  quote: string | null;
}

interface Props {
  passage: Passage;
  onDismiss: () => void;
}

// The passage a chat answer cited, at the top of the document it is from: the page it is on and
// the text, with the quoted words marked. There is no view of the original file to jump into,
// so this is the place where the reader checks the answer against the contract's own words.
export function CitedPassage({ passage, onDismiss }: Props) {
  const chunk = useChunk(passage.chunkId);
  const ref = useRef<HTMLElement>(null);

  // The drawer may be scrolled down from the citation before this one.
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "start" });
  }, [passage.chunkId, passage.quote]);

  const data = chunk.data;
  const quotePages = data && passage.quote !== null ? pagesOfQuote(data, passage.quote) : null;
  const pageStart = quotePages?.page_start ?? data?.page_start ?? null;
  const pageEnd = quotePages?.page_end ?? data?.page_end ?? null;
  const marked = data ? highlightQuote(data.text, passage.quote) : null;

  return (
    <section ref={ref} className="passage" aria-label="Cited passage">
      <div className="passage-head">
        <h3>
          Cited passage
          {pageStart !== null && (
            <span className="tag">
              {pageEnd === null || pageEnd === pageStart
                ? `page ${String(pageStart)}`
                : `pages ${String(pageStart)} to ${String(pageEnd)}`}
            </span>
          )}
        </h3>
        <button
          type="button"
          className="icon-button"
          aria-label="Hide the cited passage"
          title="Hide"
          onClick={onDismiss}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      {data ? (
        <>
          <blockquote className="quote passage-text">
            {marked === null ? (
              data.text
            ) : (
              <>
                {marked.before}
                <mark>{marked.match}</mark>
                {marked.after}
              </>
            )}
          </blockquote>
          {passage.quote !== null && marked === null && (
            <p className="detail-meta">
              The answer quoted this passage in slightly different words, so there is no exact place
              to mark.
            </p>
          )}
        </>
      ) : chunk.error ? (
        <p className="detail-meta">
          {chunk.error instanceof ApiError && chunk.error.status === 404
            ? "This passage is no longer in the search index. The document was indexed again since the answer was given."
            : `Could not load the passage: ${chunk.error.message}`}
        </p>
      ) : (
        <span className="skeleton skeleton-block" aria-label="Loading the passage" />
      )}
    </section>
  );
}
