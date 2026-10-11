import { useLayoutEffect, useRef, useState } from "react";
import type { Confidence } from "@nexus/shared";

// What every extracted value carries so an analyst can check it instead of trusting the model.
export interface Evidence {
  quote: string | null;
  confidence: Confidence;
  quote_verified: boolean;
  // Null for docx, which has no pages, and when the quote was not found.
  quote_page: number | null;
}

export function Quote({ text }: { text: string }) {
  const ref = useRef<HTMLQuoteElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  // Measured while clamped: only then does scrollHeight exceed clientHeight for a long quote. Short quotes
  // get no "Show more" button.
  useLayoutEffect(() => {
    const element = ref.current;
    if (element && !expanded) setOverflows(element.scrollHeight > element.clientHeight + 1);
  }, [text, expanded]);

  return (
    <div className="quote">
      <blockquote ref={ref} className={expanded ? undefined : "quote-clamped"}>
        {text}
      </blockquote>
      {overflows && (
        <button type="button" className="link-button" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

export function QuoteCheck({ verified, page }: { verified: boolean; page: number | null }) {
  if (!verified) {
    return (
      <span className="tone-warn">
        <span aria-hidden="true">⚠ </span>Quote not found in document text
      </span>
    );
  }
  return (
    <span className="tone-ok">
      Quote found{page !== null && <span className="tone-muted">, p. {page}</span>}
    </span>
  );
}

interface Props {
  label: string;
  // Already formatted for display. Null means there is no value.
  value: string | null;
  // Left out for values the code computed (term end, notice deadline): those have no quote of their own.
  evidence?: Evidence | undefined;
  tag?: string | undefined;
  emptyText?: string;
}

export function FieldRow({ label, value, evidence, tag, emptyText = "Not stated" }: Props) {
  return (
    <div className="field-row">
      <dt>{label}</dt>
      <dd>
        {value === null ? (
          <span className="tone-muted">{emptyText}</span>
        ) : (
          <>
            <div className="field-value">
              <span>{value}</span>
              {tag !== undefined && <span className="tag">{tag}</span>}
              {evidence && (
                <span className={`pill confidence-${evidence.confidence}`}>
                  {evidence.confidence} confidence
                </span>
              )}
            </div>
            {evidence && (
              <>
                {evidence.quote !== null && <Quote text={evidence.quote} />}
                <div className="field-check">
                  <QuoteCheck verified={evidence.quote_verified} page={evidence.quote_page} />
                </div>
              </>
            )}
          </>
        )}
      </dd>
    </div>
  );
}
