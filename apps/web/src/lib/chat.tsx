import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { ApiError, askStream, getThread } from "../api/client.js";
import { THREADS_KEY } from "../api/hooks.js";
import { chatReducer, emptyChat, type ChatState, type Failure } from "./chatModel.js";
import { useModelChoice } from "./modelChoice.js";

// The chat's state lives above the pages, not in the chat view: an answer from a local model
// takes a minute, and looking at a document in the meantime must not throw it away.

interface Chat {
  state: ChatState;
  // Does nothing while an answer is running.
  ask: (question: string) => void;
  // Ends the running answer. The api stops the model too.
  stop: () => void;
  // Asks the question of the failed last message again.
  askAgain: () => void;
  // documentId: the contract the new chat is about, or null for all of them.
  newChat: (documentId: string | null) => void;
  // Rejects when the thread cannot be loaded.
  openThread: (threadId: string) => Promise<void>;
}

const Context = createContext<Chat | null>(null);

function toFailure(err: unknown): Failure {
  if (err instanceof ApiError) {
    return { status: err.status, code: err.code, message: err.message, details: err.details };
  }
  return { status: 0, code: "UNKNOWN", message: "Something went wrong while asking. Try again." };
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, undefined, () => emptyChat());
  const { selected } = useModelChoice();
  const queryClient = useQueryClient();
  // What the callbacks read: they outlive the render they were made in.
  const latest = useRef({ state, selected });
  useEffect(() => {
    latest.current = { state, selected };
  }, [state, selected]);
  const running = useRef<AbortController | null>(null);

  const ask = useCallback(
    (question: string) => {
      const { state: now, selected: model } = latest.current;
      const text = question.trim();
      if (now.running || running.current !== null || text === "") return;
      const controller = new AbortController();
      running.current = controller;
      dispatch({ type: "ask", question: text });
      askStream(
        {
          question: text,
          ...(now.threadId === null ? {} : { thread_id: now.threadId }),
          ...(now.documentId === null ? {} : { document_id: now.documentId }),
          // Without a selection the api answers with its default model.
          ...(model === null ? {} : model),
        },
        (event) => {
          if (!controller.signal.aborted) dispatch({ type: "event", event });
        },
        controller.signal,
      )
        .catch((err: unknown) => {
          // Aborted by stop(), which has already said so in the conversation.
          if (controller.signal.aborted) return;
          dispatch({ type: "failed", failure: toFailure(err) });
        })
        .finally(() => {
          if (running.current === controller) running.current = null;
          void queryClient.invalidateQueries({ queryKey: THREADS_KEY });
        });
    },
    [queryClient],
  );

  const stop = useCallback(() => {
    if (running.current === null) return;
    running.current.abort();
    running.current = null;
    dispatch({ type: "stopped" });
  }, []);

  const askAgain = useCallback(() => {
    const last = latest.current.state.messages.at(-1);
    if (last?.role !== "assistant" || last.phase !== "failed") return;
    dispatch({ type: "dropFailed" });
    // The reducer has not run yet, so the question goes out with the thread as it is now.
    ask(last.question);
  }, [ask]);

  const newChat = useCallback((documentId: string | null) => {
    running.current?.abort();
    running.current = null;
    dispatch({ type: "reset", documentId });
  }, []);

  const openThread = useCallback(async (threadId: string) => {
    if (latest.current.state.threadId === threadId) return;
    running.current?.abort();
    running.current = null;
    const thread = await getThread(threadId);
    dispatch({ type: "loaded", thread });
  }, []);

  const value = useMemo(
    (): Chat => ({ state, ask, stop, askAgain, newChat, openThread }),
    [state, ask, stop, askAgain, newChat, openThread],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useChat(): Chat {
  const value = useContext(Context);
  if (!value) throw new Error("useChat needs a ChatProvider above it");
  return value;
}
