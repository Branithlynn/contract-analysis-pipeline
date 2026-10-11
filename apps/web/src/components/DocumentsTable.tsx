import { useMemo, useState } from "react";
import type { DocumentSummary } from "@nexus/shared";
import { exportCsvUrl } from "../api/client.js";
import { useDocuments } from "../api/hooks.js";
import {
  EMPTY,
  formatDate,
  formatDaysLeft,
  formatMoney,
  formatPercent,
  noticeTone,
} from "../lib/format.js";
import { isPlainClick, selectionHref } from "../lib/selection.js";
import { countByStatus, sortDocuments, type SortKey } from "../lib/tableModel.js";
import { StatusBadge } from "./StatusBadge.js";

// Same line the api uses by default to flag a document for review (GROUNDING_REVIEW_THRESHOLD).
const GROUNDING_WARN_BELOW = 0.8;

interface Props {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function NoticeCell({ doc }: { doc: DocumentSummary }) {
  if (doc.notice_deadline === null) return <>{EMPTY}</>;
  const days = doc.days_until_notice_deadline;
  return (
    <>
      {formatDate(doc.notice_deadline)}
      {days !== null && (
        <span className={`notice-${noticeTone(days)}`}> ({formatDaysLeft(days)})</span>
      )}
    </>
  );
}

function RiskCell({ doc }: { doc: DocumentSummary }) {
  if (doc.risk_count === null) return <>{EMPTY}</>;
  if (doc.max_risk_severity === null) return <span className="tone-muted">None</span>;
  return (
    <>
      <span className={`badge severity-${doc.max_risk_severity}`}>{doc.max_risk_severity}</span>{" "}
      {doc.risk_count}
    </>
  );
}

function GroundingCell({ score }: { score: number | null }) {
  if (score === null) return <>{EMPTY}</>;
  return (
    <span className={score < GROUNDING_WARN_BELOW ? "tone-warn" : undefined}>
      {formatPercent(score)}
    </span>
  );
}

export function DocumentsTable({ selectedId, onSelect }: Props) {
  const documents = useDocuments();
  const [sortKey, setSortKey] = useState<SortKey>("newest");

  const data = documents.data;
  const rows = useMemo(() => sortDocuments(data ?? [], sortKey), [data, sortKey]);
  const counts = useMemo(() => countByStatus(data ?? []), [data]);

  if (data === undefined) {
    return documents.error ? (
      <p className="tone-error">Could not load documents: {documents.error.message}</p>
    ) : (
      <p className="tone-muted">Loading documents...</p>
    );
  }

  // Clicking the active sort header again goes back to newest first.
  const sortHeader = (key: Exclude<SortKey, "newest">, label: string) => (
    <th aria-sort={sortKey === key ? (key === "notice" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className="sort-button"
        onClick={() => setSortKey(sortKey === key ? "newest" : key)}
      >
        {label}
        {sortKey === key && <span aria-hidden="true">{key === "notice" ? " ▲" : " ▼"}</span>}
      </button>
    </th>
  );

  return (
    <section className="documents">
      <div className="documents-toolbar">
        <span className="tone-muted">
          {counts.queued} queued, {counts.processing} processing, {counts.completed} completed
          {counts.needs_review > 0 && ` (${counts.needs_review} to review)`}, {counts.failed} failed
        </span>
        <a href={exportCsvUrl()}>Export CSV</a>
      </div>

      {/* Stale rows stay up when a poll fails, with a note that they may be out of date. */}
      {documents.error && (
        <p className="tone-error">Could not refresh: {documents.error.message}</p>
      )}

      {rows.length === 0 ? (
        <p className="documents-empty">No documents yet. Upload a PDF or DOCX contract to start.</p>
      ) : (
        <table className="documents-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Status</th>
              <th>Vendor</th>
              <th className="numeric">Value</th>
              <th>Expires</th>
              {sortHeader("notice", "Notice by")}
              {sortHeader("risk", "Risk")}
              <th className="numeric">Grounding</th>
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
                <td>
                  {/* A real link, so the row is reachable by keyboard and can be opened in a new tab. */}
                  <a
                    href={selectionHref("", doc.id)}
                    aria-current={doc.id === selectedId ? "true" : undefined}
                    onClick={(event) => {
                      if (isPlainClick(event)) event.preventDefault();
                    }}
                  >
                    {doc.original_name}
                  </a>
                  {doc.duplicate_of !== null && <span className="tag">duplicate</span>}
                </td>
                <td>
                  <StatusBadge doc={doc} />
                </td>
                <td>{doc.vendor_name ?? EMPTY}</td>
                <td className="numeric">
                  {doc.total_contract_value ? formatMoney(doc.total_contract_value) : EMPTY}
                </td>
                <td>{doc.expiration_date ? formatDate(doc.expiration_date) : EMPTY}</td>
                <td>
                  <NoticeCell doc={doc} />
                </td>
                <td>
                  <RiskCell doc={doc} />
                </td>
                <td className="numeric">
                  <GroundingCell score={doc.grounding_score} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
