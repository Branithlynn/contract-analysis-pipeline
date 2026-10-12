import { FileText, MessageSquare } from "lucide-react";
import { useCallback, useState, type MouseEvent, type ReactNode } from "react";
import { ChatView } from "./components/ChatView.js";
import type { Passage } from "./components/CitedPassage.js";
import { DocumentDetail } from "./components/DocumentDetail.js";
import { DocumentsTable } from "./components/DocumentsTable.js";
import { ModelPicker } from "./components/ModelPicker.js";
import { ToastProvider } from "./components/Toasts.js";
import { UploadDropzone } from "./components/UploadDropzone.js";
import { ChatProvider, useChat } from "./lib/chat.js";
import type { CitationTarget } from "./lib/chatModel.js";
import { MODAL_DRAWER_QUERY, useMediaQuery } from "./lib/focusTrap.js";
import { ModelChoiceProvider } from "./lib/modelChoice.js";
import { routeHref, useRoute, type Route } from "./lib/route.js";
import { isPlainClick, useSelectedDocument } from "./lib/selection.js";

function NavLink({
  to,
  current,
  onNavigate,
  children,
}: {
  to: Route;
  current: boolean;
  onNavigate: (route: Route) => void;
  children: ReactNode;
}) {
  return (
    <a
      className="nav-item"
      href={routeHref("", to)}
      aria-current={current ? "page" : undefined}
      onClick={(event: MouseEvent) => {
        if (!isPlainClick(event)) return;
        event.preventDefault();
        onNavigate(to);
      }}
    >
      {children}
    </a>
  );
}

function Sidebar({ inert }: { inert: boolean }) {
  const [route, navigate] = useRoute();
  const { state } = useChat();
  return (
    <aside className="sidebar" inert={inert}>
      <p className="app-name">Nexus Contracts</p>
      <nav aria-label="Main">
        <ul className="plain-list">
          <li>
            <NavLink
              to={{ view: "documents", threadId: null, aboutId: null }}
              current={route.view === "documents"}
              onNavigate={navigate}
            >
              <FileText size={16} aria-hidden="true" />
              Documents
            </NavLink>
          </li>
          <li>
            {/* Back to the chat as it was left, an answer that is still running included. */}
            <NavLink
              to={{
                view: "chat",
                threadId: state.threadId,
                aboutId: state.threadId === null ? state.documentId : null,
              }}
              current={route.view === "chat"}
              onNavigate={navigate}
            >
              <MessageSquare size={16} aria-hidden="true" />
              Chat
              {state.running && route.view !== "chat" && <span className="tag">answering</span>}
            </NavLink>
          </li>
        </ul>
      </nav>
      <ModelPicker />
    </aside>
  );
}

function Pages() {
  const [selectedId, select] = useSelectedDocument();
  const [route, navigate] = useRoute();
  const { newChat } = useChat();
  // The passage a citation pointed at, for the document it belongs to.
  const [passage, setPassage] = useState<(Passage & { documentId: string }) | null>(null);
  const close = useCallback(() => {
    select(null);
    setPassage(null);
  }, [select]);
  // On a narrow screen the drawer is a modal dialog: the page behind it is inert and dimmed.
  const modal = useMediaQuery(MODAL_DRAWER_QUERY) && selectedId !== null;

  const openCitation = useCallback(
    (target: CitationTarget) => {
      setPassage(
        target.passage === null ? null : { ...target.passage, documentId: target.documentId },
      );
      select(target.documentId);
    },
    [select],
  );

  const askAbout = useCallback(
    (documentId: string) => {
      newChat(documentId);
      navigate({ view: "chat", threadId: null, aboutId: documentId });
      // The chat is behind the drawer otherwise.
      close();
    },
    [newChat, navigate, close],
  );

  return (
    <div className={selectedId === null ? "app" : "app app-with-drawer"}>
      <Sidebar inert={modal} />
      <main className={route.view === "chat" ? "main main-chat" : "main"} inert={modal}>
        {route.view === "chat" ? (
          <ChatView onOpenCitation={openCitation} />
        ) : (
          <>
            <h1>Documents</h1>
            <UploadDropzone />
            <DocumentsTable selectedId={selectedId} onSelect={select} />
          </>
        )}
      </main>
      {modal && <div className="drawer-backdrop" onClick={close} />}
      {/* Keyed by id so open sections and a retry error from one document don't carry over to the next. */}
      {selectedId !== null && (
        <DocumentDetail
          key={selectedId}
          id={selectedId}
          modal={modal}
          onClose={close}
          onSelect={select}
          passage={passage?.documentId === selectedId ? passage : null}
          onDismissPassage={() => setPassage(null)}
          onAsk={askAbout}
        />
      )}
    </div>
  );
}

export function App() {
  return (
    <ToastProvider>
      <ModelChoiceProvider>
        <ChatProvider>
          <Pages />
        </ChatProvider>
      </ModelChoiceProvider>
    </ToastProvider>
  );
}
