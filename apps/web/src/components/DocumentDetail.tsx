import {
  CircleCheck,
  CircleX,
  Info,
  MessageSquare,
  RotateCw,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type {
  DocumentDetail as DocumentDetailDto,
  ExtractionRecord,
  ExtractionResult,
  RunSummary,
} from "@nexus/shared";
import { useDocument, useDocumentRun, useDocuments, useReanalyze, useRetry } from "../api/hooks.js";
import {
  canReanalyze,
  canRetry,
  failedRunNote,
  groupRisks,
  noticeDeadlineEmptyText,
  runHint,
  sortAlerts,
  splitWarnings,
} from "../lib/detailModel.js";
import {
  alertLabel,
  expirationSourceLabel,
  documentTypeLabel,
  errorLabel,
  errorPhrase,
  fieldLabel,
  formatCount,
  formatDate,
  formatDateTime,
  formatDuration,
  formatMoney,
  formatPercent,
  plural,
  riskCategoryLabel,
} from "../lib/format.js";
import { useModelChoice } from "../lib/modelChoice.js";
import { focusableIn, trapTarget } from "../lib/focusTrap.js";
import { resultModelLabel, shortModelName } from "../lib/modelPicker.js";
import { countDifferences, diffRuns } from "../lib/runDiff.js";
import { isPlainClick, selectionHref } from "../lib/selection.js";
import { CitedPassage, type Passage } from "./CitedPassage.js";
import { FieldRow, Quote, QuoteCheck } from "./FieldRow.js";
import { StatusChip } from "./StatusBadge.js";
import { useToast } from "./Toasts.js";

interface Props {
  id: string;
  // True when the drawer covers the page as a dialog. False when it sits next to the table.
  modal: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  // The passage a chat answer cited from this document, shown above everything else.
  passage: Passage | null;
  onDismissPassage: () => void;
  // Opens a chat about this document.
  onAsk: (id: string) => void;
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

const ALERT_ICONS = { critical: CircleX, warning: TriangleAlert, info: Info } as const;

function Alerts({ result }: { result: ExtractionResult }) {
  const alerts = sortAlerts(result.derived.alerts);
  if (alerts.length === 0) return null;
  return (
    <ul className="plain-list alerts" aria-label="Alerts">
      {alerts.map((alert, index) => {
        const Icon = ALERT_ICONS[alert.level];
        return (
          <li key={`${alert.code}-${index}`} className={`alert alert-${alert.level}`}>
            <Icon size={15} aria-hidden="true" />
            <div>
              <strong>{alertLabel(alert.code)}</strong>
              <span>{alert.message}</span>
            </div>
          </li>
        );
      })}
    </ul>
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
    <div className="field-list">
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
        label={fieldLabel("total_contract_value")}
        value={orNull(result.total_contract_value.value, formatMoney)}
        evidence={result.total_contract_value}
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
    </div>
  );
}

function Risks({ result }: { result: ExtractionResult }) {
  const groups = groupRisks(result.risk_clauses);
  if (groups.length === 0) return <p className="tone-muted">No risk clauses found.</p>;
  return (
    <>
      {groups.map((group) => (
        <div key={group.severity} className="risk-group">
          <h4 className={`severity severity-${group.severity}`}>
            {group.severity}, {plural(group.clauses.length, "clause")}
          </h4>
          <ul className="plain-list">
            {group.clauses.map((clause, index) => (
              <li key={index}>
                <details className="risk">
                  <summary>
                    <span className="risk-title">{clause.title}</span>
                    <span className="tag">{riskCategoryLabel(clause.category)}</span>
                  </summary>
                  <div className="field-evidence">
                    <p>{clause.explanation}</p>
                    <Quote text={clause.quote} />
                    <QuoteCheck verified={clause.quote_verified} page={clause.quote_page} />
                  </div>
                </details>
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

function Extraction({ extraction }: { extraction: ExtractionRecord }) {
  const result = extraction.result;
  const { notes } = splitWarnings(result.warnings);
  return (
    <>
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

function runFacts(run: RunSummary): string {
  if (run.status === "failed") {
    return run.error_code === null ? "failed" : `failed: ${errorPhrase(run.error_code)}`;
  }
  const parts: string[] = [];
  if (run.grounding_score !== null) parts.push(`grounding ${formatPercent(run.grounding_score)}`);
  if (run.duration_ms !== null) parts.push(formatDuration(run.duration_ms));
  if (run.input_tokens !== null && run.output_tokens !== null && run.input_tokens > 0) {
    parts.push(`${formatCount(run.input_tokens + run.output_tokens)} tokens`);
  }
  return parts.join(", ");
}

// Two successful runs next to each other. Each side is fetched as the detail of that run.
function RunComparison({ id, runs }: { id: string; runs: readonly RunSummary[] }) {
  const completed = runs.filter((run) => run.status === "completed");
  const [leftRun, setLeftRun] = useState(completed[1]?.run ?? null);
  const [rightRun, setRightRun] = useState(completed[0]?.run ?? null);
  const left = useDocumentRun(id, leftRun);
  const right = useDocumentRun(id, rightRun);
  if (completed.length < 2) return null;

  const pick = (label: string, value: number | null, set: (run: number) => void) => (
    <label className="compare-pick">
      <span className="visually-hidden">{label}</span>
      <select value={value ?? ""} onChange={(event) => set(Number(event.target.value))}>
        {completed.map((run) => (
          <option key={run.run} value={run.run}>
            Run {run.run}, {shortModelName(run.model)}
          </option>
        ))}
      </select>
    </label>
  );

  const a = left.data?.extraction?.result;
  const b = right.data?.extraction?.result;
  const rows = a && b ? diffRuns(a, b) : null;

  return (
    <details className="compare">
      <summary>Compare two runs</summary>
      <div className="table-scroll">
        <table className="compare-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>{pick("First run to compare", leftRun, setLeftRun)}</th>
              <th>{pick("Second run to compare", rightRun, setRightRun)}</th>
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr>
                <td colSpan={3} className="tone-muted">
                  {left.error || right.error ? "Could not load a run." : "Loading runs..."}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.label} className={row.same ? undefined : "compare-differs"}>
                  <th scope="row">
                    {row.label}
                    {!row.same && <span className="visually-hidden"> (differs)</span>}
                  </th>
                  <td>{row.left}</td>
                  <td>{row.right}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {rows !== null && (
        <p className="tone-muted small">
          {countDifferences(rows) === 0
            ? "Both runs agree on every field."
            : `${plural(countDifferences(rows), "field")} differ, marked with a bar.`}
        </p>
      )}
    </details>
  );
}

function Runs({ doc }: { doc: DocumentDetailDto }) {
  const { selected } = useModelChoice();
  const reanalyze = useReanalyze();
  const toast = useToast();
  const model = selected === null ? null : shortModelName(selected.model);

  return (
    <Section title="Runs">
      {doc.runs.length === 0 ? (
        <p className="tone-muted">No finished run yet.</p>
      ) : (
        <ol className="plain-list runs">
          {doc.runs.map((run) => {
            const Icon = run.status === "failed" ? CircleX : CircleCheck;
            return (
              <li key={run.run} className={`run run-${run.status}`}>
                <Icon size={14} aria-hidden="true" />
                <div>
                  <div className="run-head">
                    <strong>Run {run.run}</strong>
                    <span>{resultModelLabel(run.provider, run.model)}</span>
                    {run.latest && <span className="tag tag-accent">shown</span>}
                  </div>
                  <div className="run-facts" title={run.error_message ?? undefined}>
                    {runFacts(run)}
                    <span className="tone-muted">
                      {" "}
                      {formatDateTime(run.created_at)}, prompt {run.prompt_version}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div className="run-actions">
        <button
          type="button"
          className="button"
          disabled={!canReanalyze(doc) || selected === null || reanalyze.isPending}
          onClick={() => {
            if (selected === null) return;
            reanalyze.mutate(
              { id: doc.id, model: selected },
              {
                onSuccess: () => toast(`Re-analysis with ${model ?? "the model"} queued`),
                onError: (err) => toast(`Re-analysis not started: ${err.message}`, "error"),
              },
            );
          }}
        >
          <RotateCw size={14} aria-hidden="true" />
          {model === null ? "Re-analyze" : `Re-analyze with ${model}`}
        </button>
        {!canReanalyze(doc) && (
          <span className="tone-muted small">Available once this run is done.</span>
        )}
        {reanalyze.error && <span className="tone-error small">{reanalyze.error.message}</span>}
      </div>

      <RunComparison id={doc.id} runs={doc.runs} />
    </Section>
  );
}

function Timeline({ doc }: { doc: DocumentDetailDto }) {
  if (doc.events.length === 0) return <p className="tone-muted">No events.</p>;
  return (
    <ol className="timeline plain-list">
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

interface BodyProps extends Pick<Props, "onSelect" | "passage" | "onDismissPassage" | "onAsk"> {
  doc: DocumentDetailDto;
}

function Body({ doc, onSelect, passage, onDismissPassage, onAsk }: BodyProps) {
  const retry = useRetry();
  const toast = useToast();
  const failed = doc.status === "failed";
  const review = doc.extraction ? splitWarnings(doc.extraction.result.warnings).review : [];
  const hint = runHint(doc);
  const note = failedRunNote(doc.runs);

  return (
    <div className="detail-body">
      {passage !== null && <CitedPassage passage={passage} onDismiss={onDismissPassage} />}
      <div className="detail-status">
        <StatusChip doc={doc} />
        {doc.result_model !== null && doc.result_provider !== null && (
          <span className="tag" title={`Values produced by ${doc.result_model}`}>
            {resultModelLabel(doc.result_provider, doc.result_model)}
          </span>
        )}
        {doc.duplicate_of !== null && <span className="tag">duplicate</span>}
        {doc.index_status === "failed" && (
          <span className="tag tag-warning" title="The search index could not be built">
            not searchable
          </span>
        )}
      </div>
      {hint !== null && <p className="detail-hint">{hint}</p>}
      {/* Only what the chat can answer about: a document with values, which is also the one
          the search index was built for. */}
      {doc.status === "completed" && doc.extraction && (
        <div className="run-actions">
          {/* A duplicate has no index of its own, its text is found through the original. */}
          <button
            type="button"
            className="button"
            onClick={() => onAsk(doc.duplicate_of ?? doc.id)}
          >
            <MessageSquare size={14} aria-hidden="true" />
            Ask about this contract
          </button>
          {doc.duplicate_of === null && doc.index_status !== "indexed" && (
            <span className="tone-muted small">
              Its text is not searchable, so answers come from the extracted values only.
            </span>
          )}
        </div>
      )}
      {doc.duplicate_of !== null && (
        <ReusedFrom originalId={doc.duplicate_of} onSelect={onSelect} />
      )}

      {/* Calm on purpose: the values on screen are fine, only the newer attempt did not work. */}
      {note !== null && (
        <p className="notice notice-info">
          <Info size={15} aria-hidden="true" />
          {note}
        </p>
      )}

      {doc.extraction && <Alerts result={doc.extraction.result} />}

      {failed && (
        <div className="notice notice-error notice-block">
          <strong>{doc.error_code ? errorLabel(doc.error_code) : "Failed"}</strong>
          {doc.error_message !== null && <p>{doc.error_message}</p>}
        </div>
      )}

      {!failed && review.length > 0 && (
        <div className="notice notice-warn notice-block">
          <strong>Needs review</strong>
          <ul>
            {review.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      {canRetry(doc) && (
        <div className="run-actions">
          <button
            type="button"
            className="button"
            disabled={retry.isPending}
            onClick={() =>
              retry.mutate(doc.id, {
                onSuccess: () => toast("Retry queued"),
                onError: (err) => toast(`Retry not started: ${err.message}`, "error"),
              })
            }
          >
            <RotateCw size={14} aria-hidden="true" />
            {retry.isPending ? "Retrying..." : "Retry with the same model"}
          </button>
          {retry.error && <span className="tone-error small">{retry.error.message}</span>}
        </div>
      )}

      {!failed && doc.extraction && <Extraction extraction={doc.extraction} />}
      {!failed && !doc.extraction && (
        <p className="tone-muted">
          No values yet. They show up here when the analysis is done, the page keeps itself up to
          date.
        </p>
      )}

      <Runs doc={doc} />

      <details className="detail-section">
        <summary>Timeline ({doc.events.length})</summary>
        <Timeline doc={doc} />
      </details>

      <details className="detail-section">
        <summary>Raw JSON</summary>
        <pre className="raw-json">{JSON.stringify(doc, null, 2)}</pre>
      </details>
    </div>
  );
}

function DrawerSkeleton() {
  return (
    <div className="detail-body" aria-label="Loading document">
      <span className="skeleton skeleton-line" />
      <span className="skeleton skeleton-block" />
      <span className="skeleton skeleton-line" />
      <span className="skeleton skeleton-block" />
    </div>
  );
}

export function DocumentDetail({
  id,
  modal,
  onClose,
  onSelect,
  passage,
  onDismissPassage,
  onAsk,
}: Props) {
  const document = useDocument(id);
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Focus moves into the drawer so the next tab continues inside, and goes back to where it was
  // (the row) when the drawer closes.
  // Read while rendering, not in the effect: as a dialog the page goes inert in the same commit,
  // and by the time an effect runs the browser has already taken focus off the row.
  const [opener] = useState(() => window.document.activeElement);
  useEffect(() => {
    closeRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [opener]);

  // Only as a dialog: the page behind is inert there, so without this tab would leave for the
  // browser's own controls. Next to the table, tab moves on into the page as usual.
  function trapFocus(event: KeyboardEvent<HTMLElement>) {
    if (!modal || event.key !== "Tab" || drawerRef.current === null) return;
    const stops = focusableIn(drawerRef.current);
    const active = window.document.activeElement;
    const current = active instanceof HTMLElement ? stops.indexOf(active) : -1;
    const target = trapTarget(stops.length, current, event.shiftKey);
    if (target === null) return;
    event.preventDefault();
    stops[target]?.focus();
  }

  const doc = document.data;
  return (
    <aside
      ref={drawerRef}
      className="drawer"
      role={modal ? "dialog" : undefined}
      aria-modal={modal ? true : undefined}
      aria-label="Document details"
      onKeyDown={trapFocus}
    >
      <header className="drawer-header">
        <h2 title={doc?.original_name}>{doc ? doc.original_name : "Document"}</h2>
        <button
          ref={closeRef}
          type="button"
          className="icon-button"
          aria-label="Close details"
          title="Close (Esc)"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      {doc ? (
        <>
          {document.error && (
            <p className="notice notice-error">Could not refresh: {document.error.message}</p>
          )}
          <Body
            doc={doc}
            onSelect={onSelect}
            passage={passage}
            onDismissPassage={onDismissPassage}
            onAsk={onAsk}
          />
        </>
      ) : document.error ? (
        <p className="notice notice-error">
          Could not load this document: {document.error.message}
        </p>
      ) : (
        <DrawerSkeleton />
      )}
    </aside>
  );
}
