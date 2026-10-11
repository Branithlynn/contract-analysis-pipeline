import { useEffect, type ReactNode } from "react";
import type {
  DocumentDetail as DocumentDetailDto,
  ExtractionRecord,
  ExtractionResult,
} from "@nexus/shared";
import { useDocument, useDocuments, useRetry } from "../api/hooks.js";
import {
  canRetry,
  groupRisks,
  noticeDeadlineEmptyText,
  sortAlerts,
  splitWarnings,
} from "../lib/detailModel.js";
import {
  alertLabel,
  expirationSourceLabel,
  documentTypeLabel,
  errorLabel,
  fieldLabel,
  formatCount,
  formatDate,
  formatDateTime,
  formatDuration,
  formatMoney,
  plural,
  riskCategoryLabel,
} from "../lib/format.js";
import { isPlainClick, selectionHref } from "../lib/selection.js";
import { FieldRow, Quote, QuoteCheck } from "./FieldRow.js";
import { StatusBadge } from "./StatusBadge.js";

interface Props {
  id: string;
  onClose: () => void;
  onSelect: (id: string) => void;
}

type Conflict = ExtractionResult["conflicts"][number];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

function orNull<T>(value: T | null, format: (value: T) => string): string | null {
  return value === null ? null : format(value);
}

function Meta({ extraction }: { extraction: ExtractionRecord }) {
  const tokens =
    extraction.input_tokens === 0 && extraction.output_tokens === 0
      ? // Providers that report no usage store 0.
        "tokens not reported"
      : `${formatCount(extraction.input_tokens)} tokens in / ${formatCount(extraction.output_tokens)} out`;
  return (
    <p className="detail-meta">
      {extraction.provider} / {extraction.model} / prompt {extraction.prompt_version}
      <br />
      {plural(extraction.chunk_count, "chunk")}, {tokens}, took{" "}
      {formatDuration(extraction.duration_ms)}, processed {formatDateTime(extraction.created_at)}
    </p>
  );
}

// A duplicate was never processed itself. Showing the original's model, tokens and duration here would
// read as if this upload took that long, so it only points at where the result came from.
function ReusedFrom({
  originalId,
  onSelect,
}: {
  originalId: string;
  onSelect: (id: string) => void;
}) {
  // The list is already cached and polled by the table. The original can be missing from it (the list is
  // capped), and then the link has no name to show.
  const original = useDocuments().data?.find((doc) => doc.id === originalId);
  return (
    <p className="detail-meta">
      Result reused from{" "}
      <a
        href={selectionHref("", originalId)}
        onClick={(event) => {
          if (!isPlainClick(event)) return;
          event.preventDefault();
          onSelect(originalId);
        }}
      >
        {original ? original.original_name : "an earlier upload"}
      </a>
    </p>
  );
}

function KeyTerms({ result }: { result: ExtractionResult }) {
  const derived = result.derived;
  const months = (n: number) => plural(n, "month");
  return (
    <dl className="field-list">
      <FieldRow
        label={fieldLabel("vendor_name")}
        value={result.vendor_name.value}
        evidence={result.vendor_name}
      />
      <FieldRow
        label={fieldLabel("customer_name")}
        value={result.customer_name.value}
        evidence={result.customer_name}
      />
      <FieldRow
        label={fieldLabel("document_type")}
        value={orNull(result.document_type.value, documentTypeLabel)}
        evidence={result.document_type}
      />
      <FieldRow
        label={fieldLabel("effective_date")}
        value={orNull(result.effective_date.value, formatDate)}
        evidence={result.effective_date}
      />
      {/* The date is the derived one, the same the table and the csv show. The quote only belongs to it
          when the contract stated a date; a computed one has no quote of its own. */}
      <FieldRow
        label={fieldLabel("expiration_date")}
        value={orNull(derived.expiration_date, formatDate)}
        evidence={result.expiration_date.value === null ? undefined : result.expiration_date}
        tag={
          derived.expiration_source === null
            ? undefined
            : expirationSourceLabel(derived.expiration_source)
        }
      />
      <FieldRow
        label={fieldLabel("initial_term_months")}
        value={orNull(result.initial_term_months.value, months)}
        evidence={result.initial_term_months}
      />
      <FieldRow
        label={fieldLabel("auto_renewal")}
        value={orNull(result.auto_renewal.value, yesNo)}
        evidence={result.auto_renewal}
      />
      <FieldRow
        label={fieldLabel("renewal_term_months")}
        value={orNull(result.renewal_term_months.value, months)}
        evidence={result.renewal_term_months}
      />
      <FieldRow
        label={fieldLabel("termination_notice_days")}
        value={orNull(result.termination_notice_days.value, (n) => plural(n, "day"))}
        evidence={result.termination_notice_days}
      />
      <FieldRow
        label="Current term end"
        value={orNull(derived.current_term_end, formatDate)}
        tag="computed"
        emptyText="Not computed"
      />
      <FieldRow
        label="Next renewal"
        value={orNull(derived.next_renewal_date, formatDate)}
        tag="computed"
        emptyText="Not computed"
      />
      <FieldRow
        label="Notice deadline"
        value={orNull(derived.notice_deadline, formatDate)}
        tag="computed"
        emptyText={noticeDeadlineEmptyText(result.auto_renewal.value)}
      />
      <FieldRow
        label={fieldLabel("total_contract_value")}
        value={orNull(result.total_contract_value.value, formatMoney)}
        evidence={result.total_contract_value}
      />
      <FieldRow
        label={fieldLabel("payment_terms")}
        value={result.payment_terms.value}
        evidence={result.payment_terms}
      />
      <FieldRow
        label={fieldLabel("governing_law")}
        value={result.governing_law.value}
        evidence={result.governing_law}
      />
      <FieldRow
        label={fieldLabel("liability_cap")}
        value={result.liability_cap.value}
        evidence={result.liability_cap}
      />
    </dl>
  );
}

function Risks({ result }: { result: ExtractionResult }) {
  const groups = groupRisks(result.risk_clauses);
  if (groups.length === 0) return <p className="tone-muted">No risk clauses found.</p>;
  return (
    <>
      {groups.map((group) => (
        <div key={group.severity} className="risk-group">
          <h4>
            <span className={`badge severity-${group.severity}`}>{group.severity}</span>{" "}
            {group.clauses.length}
          </h4>
          <ul className="plain-list">
            {group.clauses.map((clause, index) => (
              <li key={index} className="risk">
                <div className="risk-title">
                  {clause.title}
                  <span className="tag">{riskCategoryLabel(clause.category)}</span>
                </div>
                <p>{clause.explanation}</p>
                <Quote text={clause.quote} />
                <div className="field-check">
                  <QuoteCheck verified={clause.quote_verified} page={clause.quote_page} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

// Conflict candidates are kept as the model sent them, so the value is loosely typed.
function conflictValue(value: Conflict["values"][number]["value"]): string {
  if (typeof value === "boolean") return yesNo(value);
  if (typeof value === "object") return formatMoney(value);
  return String(value);
}

function Conflicts({ conflicts }: { conflicts: readonly Conflict[] }) {
  return (
    <ul className="plain-list">
      {conflicts.map((conflict) => (
        <li key={conflict.field} className="conflict">
          <strong>{fieldLabel(conflict.field)}</strong>
          <ul>
            {conflict.values.map((candidate, index) => (
              <li key={index}>
                {conflictValue(candidate.value)}{" "}
                <span className="tone-muted">(chunk {candidate.chunk_index + 1})</span>
                {candidate.quote !== null && <Quote text={candidate.quote} />}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function Extraction({ doc, extraction }: { doc: DocumentDetailDto; extraction: ExtractionRecord }) {
  const result = extraction.result;
  const alerts = sortAlerts(result.derived.alerts);
  const { notes } = splitWarnings(result.warnings);
  return (
    <>
      {/* After a retry the document is queued again while the api still returns the last stored result. */}
      {doc.status !== "completed" && (
        <p className="tone-muted">This is the result of the previous run.</p>
      )}

      {alerts.length > 0 && (
        <Section title="Alerts">
          <ul className="plain-list">
            {alerts.map((alert, index) => (
              <li
                key={`${alert.code}-${index}`}
                className={`alert alert-${alert.level} alert-code-${alert.code}`}
              >
                <strong>{alertLabel(alert.code)}</strong>
                <span>{alert.message}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Summary">
        <p>{result.summary === "" ? "No summary." : result.summary}</p>
      </Section>

      <Section title="Key terms">
        <KeyTerms result={result} />
      </Section>

      <Section title="Risks">
        <Risks result={result} />
      </Section>

      {result.conflicts.length > 0 && (
        <Section title="Conflicts">
          <Conflicts conflicts={result.conflicts} />
        </Section>
      )}

      {notes.length > 0 && (
        <details className="detail-section">
          <summary>Processing notes ({notes.length})</summary>
          <ul className="notes">
            {notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function Timeline({ doc }: { doc: DocumentDetailDto }) {
  if (doc.events.length === 0) return <p className="tone-muted">No events.</p>;
  return (
    <ol className="timeline">
      {doc.events.map((event, index) => (
        <li key={index} className={`timeline-${event.outcome}`}>
          <span className="timeline-when">{formatDateTime(event.created_at)}</span>
          <span className="timeline-stage">{event.stage}</span>
          <span className="timeline-message">{event.message}</span>
          <span className="timeline-duration">
            {event.duration_ms === null ? "" : formatDuration(event.duration_ms)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Body({ doc, onSelect }: { doc: DocumentDetailDto; onSelect: (id: string) => void }) {
  const retry = useRetry();
  const failed = doc.status === "failed";
  const review = doc.extraction ? splitWarnings(doc.extraction.result.warnings).review : [];

  return (
    <>
      <div className="detail-body">
        <div className="detail-status">
          <StatusBadge doc={doc} />
          {doc.duplicate_of !== null && <span className="tag">duplicate</span>}
        </div>
        {doc.duplicate_of !== null ? (
          <ReusedFrom originalId={doc.duplicate_of} onSelect={onSelect} />
        ) : (
          doc.extraction && <Meta extraction={doc.extraction} />
        )}

        {failed && (
          <div className="box box-error">
            <strong>{doc.error_code ? errorLabel(doc.error_code) : "Failed"}</strong>
            {doc.error_message !== null && <p>{doc.error_message}</p>}
          </div>
        )}

        {!failed && review.length > 0 && (
          <div className="box box-warn">
            <strong>Needs review</strong>
            <ul>
              {review.map((reason, index) => (
                <li key={index}>{reason}</li>
              ))}
            </ul>
          </div>
        )}

        {!failed && doc.extraction && <Extraction doc={doc} extraction={doc.extraction} />}
        {!failed && !doc.extraction && <p className="tone-muted">No extraction yet.</p>}

        <Section title="Events">
          <Timeline doc={doc} />
        </Section>

        <details className="detail-section">
          <summary>Raw JSON</summary>
          <pre className="raw-json">{JSON.stringify(doc, null, 2)}</pre>
        </details>
      </div>

      {canRetry(doc) && (
        <footer className="detail-footer">
          <button type="button" disabled={retry.isPending} onClick={() => retry.mutate(doc.id)}>
            {retry.isPending ? "Retrying..." : "Retry"}
          </button>
          {retry.error && <span className="tone-error">{retry.error.message}</span>}
        </footer>
      )}
    </>
  );
}

export function DocumentDetail({ id, onClose, onSelect }: Props) {
  const document = useDocument(id);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const doc = document.data;
  return (
    <aside className="detail-panel" aria-label="Document details">
      <header className="detail-header">
        <h2>{doc ? doc.original_name : "Document"}</h2>
        <button type="button" className="close-button" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </header>
      {doc ? (
        <>
          {document.error && (
            <p className="detail-notice tone-error">Could not refresh: {document.error.message}</p>
          )}
          <Body doc={doc} onSelect={onSelect} />
        </>
      ) : (
        <p className={document.error ? "detail-notice tone-error" : "detail-notice tone-muted"}>
          {document.error
            ? `Could not load this document: ${document.error.message}`
            : "Loading..."}
        </p>
      )}
    </aside>
  );
}
