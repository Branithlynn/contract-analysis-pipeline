import { CircleCheck, CircleX, Info, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

// Short confirmations for things the user did: "Re-analysis queued", "Model set to gpt-5-mini".
// Errors that need reading stay next to what caused them, a toast only repeats the headline.

type Tone = "ok" | "error" | "info";

interface Toast {
  id: number;
  tone: Tone;
  text: string;
}

type Notify = (text: string, tone?: Tone) => void;

const Context = createContext<Notify | null>(null);

const VISIBLE_MS = 4500;
const ICONS = { ok: CircleCheck, error: CircleX, info: Info } as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback<Notify>(
    (text, tone = "ok") => {
      const id = nextId.current++;
      // The newest three. More than that at once is noise nobody reads.
      setToasts((current) => [...current.slice(-2), { id, tone, text }]);
      window.setTimeout(() => dismiss(id), VISIBLE_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => notify, [notify]);

  return (
    <Context.Provider value={value}>
      {children}
      {/* Always mounted: screen readers only announce changes inside a live region that exists. */}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => {
          const Icon = ICONS[toast.tone];
          return (
            <div key={toast.id} className={`toast toast-${toast.tone}`}>
              <Icon size={16} aria-hidden="true" />
              <span>{toast.text}</span>
              <button
                type="button"
                className="icon-button"
                aria-label="Dismiss"
                onClick={() => dismiss(toast.id)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </Context.Provider>
  );
}

export function useToast(): Notify {
  const notify = useContext(Context);
  if (!notify) throw new Error("useToast needs a ToastProvider above it");
  return notify;
}
