import { useCallback } from "react";
import { DocumentDetail } from "./components/DocumentDetail.js";
import { DocumentsTable } from "./components/DocumentsTable.js";
import { UploadDropzone } from "./components/UploadDropzone.js";
import { useSelectedDocument } from "./lib/selection.js";

export function App() {
  const [selectedId, select] = useSelectedDocument();
  const close = useCallback(() => select(null), [select]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Nexus Contract Analyzer</h1>
      </header>
      <UploadDropzone />
      <main className="workspace">
        <DocumentsTable selectedId={selectedId} onSelect={select} />
      </main>
      {/* Keyed by id so "show more" and a retry error from one document don't carry over to the next. */}
      {selectedId !== null && (
        <DocumentDetail key={selectedId} id={selectedId} onClose={close} onSelect={select} />
      )}
    </div>
  );
}
