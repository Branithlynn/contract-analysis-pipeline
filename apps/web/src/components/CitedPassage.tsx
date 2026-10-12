import { Download, ExternalLink, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { pagesOfQuote } from "@nexus/shared";
import { ApiError, documentFileUrl } from "../api/client.js";
import { useChunk } from "../api/hooks.js";
import { fileLink, highlightQuote } from "../lib/chatModel.js";

export interface Passage {
  chunkId: number;
  // The words the answer quoted from the passage, when it quoted any.
  quote: string | null;
  // The page the citation named. Used for the link when the passage itself is gone.
  page: number | null;
}

interface Props {
  passage: Passage;
  // The document the passage is from: its id and the type of the stored file.
  document: { id: string; mime: string };
  onDismiss: () => void;
}

// The passage a chat answer cited, at the top of the document it is from: the page it is on and
// the text, with the quoted words marked, and a link to that page of the file itself. The block
// is for checking the wording at a glance, the link for reading it in its place.
export function CitedPassage({ passage, document, onDismiss }: Props) {
  const chunk = useChunk(passage.chunkId);
  const ref = useRef<HTMLElement>(null);

  // The drawer may be scrolled down from the citation before this one.
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "start" });
  }, [passage.chunkId, passage.quote]);

  const data = chunk.data;
  const quotePages = data && passage.quote !== null ? pagesOfQuote(data, passage.quote) : null;
  const pageStart = quotePages?.page_start ?? data?.page_start ?? passage.page;
  const pageEnd = quotePages?.page_end ?? data?.page_end ?? null;
  const marked = data ? highlightQuote(data.text, passage.quote) : null;
  const link = fileLink(documentFileUrl(document.id), document.mime, pageStart);

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
      {/* A new tab: the chat and the answer being checked stay where they are. */}
      <a
        className="passage-link"
        href={link.href}
        {...(link.download ? { download: "" } : { target: "_blank", rel: "noreferrer" })}
      >
        {link.download ? (
          <Download size={14} aria-hidden="true" />
        ) : (
          <ExternalLink size={14} aria-hidden="true" />
        )}
        {link.label}
        {!link.download && <span className="visually-hidden"> (opens in a new tab)</span>}
      </a>
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
