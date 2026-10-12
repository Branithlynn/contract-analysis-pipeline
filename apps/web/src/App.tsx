import { FileText, MessageSquare } from "lucide-react";
import { useCallback } from "react";
import { DocumentDetail } from "./components/DocumentDetail.js";
import { DocumentsTable } from "./components/DocumentsTable.js";
import { ModelPicker } from "./components/ModelPicker.js";
import { ToastProvider } from "./components/Toasts.js";
import { UploadDropzone } from "./components/UploadDropzone.js";
import { MODAL_DRAWER_QUERY, useMediaQuery } from "./lib/focusTrap.js";
import { ModelChoiceProvider } from "./lib/modelChoice.js";
import { useSelectedDocument } from "./lib/selection.js";

function Sidebar({ inert }: { inert: boolean }) {
  return (
    <aside className="sidebar" inert={inert}>
      <p className="app-name">Nexus Contracts</p>
      <nav aria-label="Main">
        <ul className="plain-list">
          <li>
            <a className="nav-item" href="." aria-current="page">
              <FileText size={16} aria-hidden="true" />
              Documents
            </a>
          </li>
          <li>
            {/* The slot for the chat. Not a link yet, so it is not in the tab order. */}
            <span className="nav-item nav-item-disabled" aria-disabled="true">
              <MessageSquare size={16} aria-hidden="true" />
              Chat
              <span className="tag">later</span>
            </span>
          </li>
        </ul>
      </nav>
      <ModelPicker />
    </aside>
  );
}

export function App() {
  const [selectedId, select] = useSelectedDocument();
  const close = useCallback(() => select(null), [select]);
  // On a narrow screen the drawer is a modal dialog: the page behind it is inert and dimmed.
  const modal = useMediaQuery(MODAL_DRAWER_QUERY) && selectedId !== null;

  return (
    <ToastProvider>
      <ModelChoiceProvider>
        <div className={selectedId === null ? "app" : "app app-with-drawer"}>
          <Sidebar inert={modal} />
          <main className="main" inert={modal}>
            <h1>Documents</h1>
            <UploadDropzone />
            <DocumentsTable selectedId={selectedId} onSelect={select} />
          </main>
          {/* Keyed by id so open sections and a retry error from one document don't carry over to the next. */}
          {modal && <div className="drawer-backdrop" onClick={close} />}
          {selectedId !== null && (
            <DocumentDetail
              key={selectedId}
              id={selectedId}
              modal={modal}
              onClose={close}
              onSelect={select}
            />
          )}
        </div>
      </ModelChoiceProvider>
    </ToastProvider>
  );
}
