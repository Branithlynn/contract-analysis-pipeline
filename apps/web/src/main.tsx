import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("index.html is missing #root");

createRoot(rootElement).render(
  <StrictMode>
    <h1>Nexus Contract Analyzer</h1>
  </StrictMode>,
);
