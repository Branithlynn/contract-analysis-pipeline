import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.js";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("index.html is missing #root");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1 },
    // An upload or a retry must never be sent twice by the client. bullmq owns retrying.
    mutations: { retry: 0 },
  },
});

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
