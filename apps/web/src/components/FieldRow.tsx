import { CircleCheck, TriangleAlert } from "lucide-react";
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
  return <blockquote className="quote">{text}</blockquote>;
}

export function QuoteCheck({ verified, page }: { verified: boolean; page: number | null }) {
  if (!verified) {
    return (
      <span className="check check-warn">
        <TriangleAlert size={13} aria-hidden="true" />
        Quote not found in the document text
      </span>
    );
  }
  return (
    <span className="check check-ok">
      <CircleCheck size={13} aria-hidden="true" />
      Quote found{page !== null && `, page ${page}`}
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

function Value({ value, tag, evidence, emptyText }: Omit<Props, "label">) {
  if (value === null) return <span className="tone-muted">{emptyText}</span>;
  return (
    <>
      <span className="field-text">{value}</span>
      {tag !== undefined && <span className="tag">{tag}</span>}
      {evidence && !evidence.quote_verified && (
        <span className="tag tag-warning">
          <TriangleAlert size={11} aria-hidden="true" />
          unverified
        </span>
      )}
      {evidence && evidence.confidence !== "high" && (
        <span className="tag">{evidence.confidence} confidence</span>
      )}
    </>
  );
}

// A value with a quote opens to show it. A native details element: enter and space toggle it,
// and it is announced as expandable without any extra code.
export function FieldRow({ label, value, evidence, tag, emptyText = "Not stated" }: Props) {
  const expandable = value !== null && evidence !== undefined;
  if (!expandable) {
    return (
      <div className="field-row">
        <span className="field-label">{label}</span>
        <span className="field-value">
          <Value value={value} tag={tag} emptyText={emptyText} />
        </span>
      </div>
    );
  }
  return (
    <details className="field-row field-expandable">
      <summary>
        <span className="field-label">{label}</span>
        <span className="field-value">
          <Value value={value} tag={tag} evidence={evidence} emptyText={emptyText} />
        </span>
      </summary>
      <div className="field-evidence">
        {evidence.quote !== null && <Quote text={evidence.quote} />}
        <QuoteCheck verified={evidence.quote_verified} page={evidence.quote_page} />
      </div>
    </details>
  );
}
