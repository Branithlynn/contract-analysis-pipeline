import { ArrowDown, ArrowUp, ArrowUpDown, Clock, Download, SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import type { DocumentSummary } from "@nexus/shared";
import { exportCsvUrl } from "../api/client.js";
import { useDocuments } from "../api/hooks.js";
import { runHint } from "../lib/detailModel.js";
import {
  alertLabel,
  EMPTY,
  formatDate,
  formatRelativeDays,
  formatMoney,
  isNoticeSoon,
  plural,
} from "../lib/format.js";
import { providerLabel, shortModelName } from "../lib/modelPicker.js";
import { isPlainClick, selectionHref } from "../lib/selection.js";
import { countByStatus, expiresLabel, sortDocuments, type SortKey } from "../lib/tableModel.js";
import { StatusChip } from "./StatusBadge.js";

interface Props {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

// One muted line under the name: the file, the model the values on the row came from, and,
// while a new run is under way, which model that run was asked for.
function MetaLine({ doc }: { doc: DocumentSummary }) {
  const hint = runHint(doc);
  const parts: string[] = [];
  if (doc.vendor_name !== null) parts.push(doc.original_name);
  if (doc.result_model !== null) parts.push(shortModelName(doc.result_model));
  const source =
    doc.result_model !== null && doc.result_provider !== null
      ? `Values produced by ${doc.result_model} (${providerLabel(doc.result_provider)})`
      : undefined;
  const searchable = doc.index_status !== "failed";
  if (parts.length === 0 && hint === null && doc.duplicate_of === null && searchable) return null;
  return (
    <div className="row-meta">
      {parts.length > 0 && <span title={source}>{parts.join(" · ")}</span>}
      {hint !== null && <span className="row-hint">{hint}</span>}
      {doc.duplicate_of !== null && <span className="tag">duplicate</span>}
      {!searchable && (
        <span className="tag tag-warning" title="The search index could not be built">
          not searchable
        </span>
      )}
    </div>
  );
}

function ExpiresCell({ doc }: { doc: DocumentSummary }) {
  const label = expiresLabel(doc);
  if (label === null) return <>{EMPTY}</>;
  return (
    <span className={label.note === "expired" ? "cell-pair tone-muted" : "cell-pair"}>
      <span>{label.date}</span>
      {label.note !== null && <span className="tone-muted">· {label.note}</span>}
    </span>
  );
}

const SEVERITY_WORD = { high: "High", medium: "Medium", low: "Low" } as const;

function NoticeCell({ doc }: { doc: DocumentSummary }) {
  if (doc.notice_deadline === null) return <>{EMPTY}</>;
  const days = doc.days_until_notice_deadline;
  const date = formatDate(doc.notice_deadline);
  // Two parts that each stay on one line, so a narrow column breaks between them and not inside the date.
  const parts = (
    <>
      <span>{date}</span>
      {days !== null && <span>· {formatRelativeDays(days)}</span>}
    </>
  );
  if (days !== null && isNoticeSoon(days)) {
    return (
      <span className="cell-pair notice-soon">
        <Clock size={13} aria-hidden="true" />
        {parts}
      </span>
    );
  }
  return (
    <span className={days !== null && days < 0 ? "cell-pair tone-muted" : "cell-pair"}>
      {parts}
    </span>
  );
}

function RiskCell({ doc }: { doc: DocumentSummary }) {
  if (doc.risk_count === null) return <>{EMPTY}</>;
  if (doc.max_risk_severity === null) return <span className="tone-muted">none</span>;
  return (
    <span className="cell-pair">
      <span className={`severity severity-${doc.max_risk_severity}`}>
        {SEVERITY_WORD[doc.max_risk_severity]}
      </span>
      <span className="tone-muted">· {plural(doc.risk_count, "risk")}</span>
    </span>
  );
}

function Alerts({ doc }: { doc: DocumentSummary }) {
  if (doc.alerts.length === 0) return null;
  return (
    <div className="row-alerts">
      {doc.alerts.map((alert, index) => (
        <span key={`${alert.code}-${index}`} className={`tag tag-${alert.level}`}>
          {alertLabel(alert.code)}
        </span>
      ))}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="table-skeleton" aria-label="Loading documents">
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className="skeleton skeleton-row" />
      ))}
    </div>
  );
}

export function DocumentsTable({ selectedId, onSelect }: Props) {
  const documents = useDocuments();
  // The next thing to act on first: the closest notice deadline.
  const [sortKey, setSortKey] = useState<SortKey>("notice");

  const data = documents.data;
  const rows = useMemo(() => sortDocuments(data ?? [], sortKey), [data, sortKey]);
  const counts = useMemo(() => countByStatus(data ?? []), [data]);

  if (data === undefined) {
    return documents.error ? (
      <p className="notice notice-error">Could not load documents: {documents.error.message}</p>
    ) : (
      <TableSkeleton />
    );
  }

  if (rows.length === 0) {
    return (
      <div className="empty">
        <SearchX size={24} aria-hidden="true" />
        <p className="empty-title">No contracts yet</p>
        <p>
          Drop a contract PDF or DOCX above. To try it out, use one from{" "}
          <code>samples/generated</code>.
        </p>
      </div>
    );
  }

  const sortHeader = (key: SortKey, label: string, ascending: boolean, className?: string) => {
    const active = sortKey === key;
    const Icon = active ? (ascending ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <th
        className={className}
        aria-sort={active ? (ascending ? "ascending" : "descending") : "none"}
      >
        <button type="button" className="sort-button" onClick={() => setSortKey(key)}>
          {label}
          <Icon size={12} aria-hidden="true" />
        </button>
      </th>
    );
  };

  return (
    <section className="documents" aria-label="Documents">
      <div className="documents-toolbar">
        <p className="tone-muted">
          {plural(data.length, "document")}: {counts.processing + counts.queued} in progress,{" "}
          {counts.needs_review} to review, {counts.failed} failed
        </p>
        <a className="button button-quiet" href={exportCsvUrl()}>
          <Download size={14} aria-hidden="true" />
          Export CSV
        </a>
      </div>

      {/* Stale rows stay up when a poll fails, with a note that they may be out of date. */}
      {documents.error && (
        <p className="notice notice-error">Could not refresh: {documents.error.message}</p>
      )}

      <div className="table-scroll">
        <table className="documents-table">
          <thead>
            <tr>
              {sortHeader("newest", "Contract", false, "col-contract")}
              <th className="col-status">Status</th>
              <th className="numeric">Value</th>
              <th>Expires</th>
              {sortHeader("notice", "Notice by", true)}
              {sortHeader("risk", "Risks", false)}
            </tr>
          </thead>
          <tbody>
            {rows.map((doc) => (
              <tr
                key={doc.id}
                className={doc.id === selectedId ? "row-selected" : undefined}
                onClick={(event) => {
                  if (isPlainClick(event)) onSelect(doc.id);
                }}
              >
                <td className="cell-main">
                  {/* A real link: reachable with tab, opened with enter, and a modified click
                      opens the document in a new tab. */}
                  <a
                    className="row-link"
                    href={selectionHref("", doc.id)}
                    aria-current={doc.id === selectedId ? "true" : undefined}
                    onClick={(event) => {
                      if (isPlainClick(event)) event.preventDefault();
                    }}
                  >
                    {doc.vendor_name ?? doc.original_name}
                  </a>
                  <MetaLine doc={doc} />
                  <Alerts doc={doc} />
                </td>
                <td>
                  <StatusChip doc={doc} />
                </td>
                <td className="numeric">
                  {doc.total_contract_value ? formatMoney(doc.total_contract_value) : EMPTY}
                </td>
                <td>
                  <ExpiresCell doc={doc} />
                </td>
                <td>
                  <NoticeCell doc={doc} />
                </td>
                <td>
                  <RiskCell doc={doc} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
