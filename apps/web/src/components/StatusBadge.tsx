import type { DocumentSummary } from "@nexus/shared";
import { errorLabel } from "../lib/format.js";

export function StatusBadge({ doc }: { doc: DocumentSummary }) {
  switch (doc.status) {
    case "queued":
      return <span className="badge badge-grey">Queued</span>;
    case "processing":
      return (
        <span className="badge badge-blue">
          <span className="pulse-dot" aria-hidden="true" />
          Processing{doc.stage ? `: ${doc.stage}` : ""}
        </span>
      );
    case "completed":
      return doc.needs_review ? (
        <span className="badge badge-amber">Review</span>
      ) : (
        <span className="badge badge-green">Completed</span>
      );
    case "failed":
      return (
        <span className="badge badge-red" title={doc.error_message ?? undefined}>
          {doc.error_code ? errorLabel(doc.error_code) : "Failed"}
        </span>
      );
  }
}
