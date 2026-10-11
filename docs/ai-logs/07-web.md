 ▐▛███▛█   Claude Code v2.1.296
▝▜██████▀  Opus 5.5 · Claude Pro
 ▝▝   ▝▝   E:\contract-analysis-pipeline

  ⎿  SessionStart:clear says: <persisted-output>
     Output too large (11.5KB). Full output saved to: C:\Users\boris\.claude\pro
     jects\E--contract-analysis-pipeline\1d8dc9cf-dcda-415d-bec1-03388234dc15\to
     ol-results\hook-739ead31-6439-404d-8f8c-e4833c32af56-4-systemMessage.txt

     Preview (first 2KB):
     [contract-analysis-pipeline] recent context, 2026-10-11 3:16am GMT+3
     ────────────────────────────────────────────────────────────

     Legend: session-request | ● bugfix | ◆ feature | ↻ refactor | ✓ change | ○ 
     discovery | ⚖ decision | ⚠ security_alert | ⚷ security_note

     Column Key
       Read: Tokens to read this observation (cost to learn it now)
       Work: Tokens spent on work that produced this record ( research, 
     building, deciding)

     Context Index: This semantic index (titles, types, files, tokens) is 
     usually sufficient to understand past work.

     When you need implementation details, rationale, or debugging context:
       - Fetch by ID: get_observations([IDs]) for observations visible in this 
     index
       - Search history: Use the mem-search skill for past decisions, bugs, and 
     deeper research
       - Trust this index over re-reading code for past decisions and learnings

     Context Economics
       Loading: 50 observations (15,796 tokens to read)
       Work investment: 268,230 tokens spent on research, building, and 
     decisions
       Your savings: 94% reduction from reuse

     Oct 10, 2026

     #S988 Read documentation files (CLAUDE.md and docs/TASK.md) to establish
     task context and working agreements before beginning implementation. (Oct 
     10, 5:14 PM)

     #S989 Implement extraction pipeline chunking and concurrency control
     modules for contract document processing, following a seven-stage 
     architecture (chunk → extract → normalize → ground → merge → summarize → 
     derive → review) (Oct 10, 11:06 PM)

     #S990 Implement extractChunk with one-repair error handling, truncation
     detection, and enum normalization; all three LLM providers (Ollama, OpenAI,
     Anthropic) detect when output hits token limits (Oct 10, 11:18 PM)

     ...
     </persisted-output>

❯ /clear                                                                        

❯ read CLAUDE.md and docs/TASK.md first. no code yet.                           
                                                                                
  quick context: take-home, contract upload -> async processing -> llm          
  extraction -> dashboard. backend has to be TS. I've got the architecture      
  worked out so I'll feed it to you step by step. only do what I ask in each    
  step, and if some library doesn't behave like I say, stop and tell me, don't  
  hack around it                                                                

  Read 2 files (ctrl+o to expand)

● Read both CLAUDE.md and docs/TASK.md. No code written, nothing changed.

  How I'll work, per your rules:
  1. One step at a time, only what the step asks.
  2. If a library behaves differently from what you describe, I stop and report
     it, with no workaround.
  3. Packages you name are approved; for anything else I ask first and say why.
  4. After changes I run npm run typecheck && npm run lint && npm test and
     report the real output.
  5. No git writes, and I only call the mock provider from the session.

  From the task, the things graded are system design, the async decoupling, the
  README as your voice, and the committed AI conversation log (mandatory).

  Next: send step 1.

✻ Cooked for 10s · done 3:16 AM

❯ ui time. doesn't need to be pretty but the evidence has to be front and       
  center, every value with its confidence, page and the exact quote. the whole  
  idea is analysts don't have to blindly trust the model.                       
                                                                                
  no component lib, no router. one page, table + side panel, selected doc in    
  ?doc=<id> so links work. types from @nexus/shared (the list/detail DTOs,      
  ErrorCode, AlertCode, Derived) so if the api changes the build breaks instead 
  of the page.                                                                  
                                                                                
  vite.config: proxy /api and /healthz to http://localhost:3000 in dev, so the  
  client only ever uses relative urls. nginx does the same proxying in the      
  docker phase.                                                                 
                                                                                
  api/client.ts: getDocuments, getDocument, uploadDocuments (FormData "files"), 
  retryDocument, exportCsvUrl. non 2xx -> ApiError(status, code, message).      
  upload returns UploadResponse on both 202 and 400, and it can carry a         
  request-level error (TOO_MANY_FILES, UNEXPECTED_FIELD, NO_FILES) next to      
  accepted/rejected, show that too. retry and upload answer 202 even when redis 
  is down (the doc stays queued with a retry event and the reconciler delivers  
  it later, I saw this work live), so the ui shows queued + that event, not an  
  error.                                                                        
                                                                                
  api/hooks.ts:                                                                 
  useDocuments -> ["documents"], refetchInterval 2000 only while something      
  isn't terminal, otherwise false, refetchOnWindowFocus                         
  useDocument(id|null) -> same polling idea                                     
  useUpload / useRetry mutations that invalidate                                
                                                                                
  polling over sse on purpose: survives proxies and restarts with no extra      
  code, and processing takes ~75s per document on my local model anyway. sse    
  goes in "next steps"                                                          
                                                                                
  if @tanstack/react-query ^5.104 isn't in apps/web yet, add it, it's approved. 
  just the client + hooks this step, components come next.                      

  Read 1 file, listed 1 directory, ran 2 shell commands (ctrl+o to expand)

● Write(apps\web\src\api\client.test.ts)
  ⎿  Wrote 234 lines to apps\web\src\api\client.test.ts
       1 import { afterEach, beforeEach, describe, expect, it, vi } from 
         "vitest";
       2 import type { DocumentDetail, DocumentSummary, UploadResponse } 
       3 import {
       4   ApiError,
       5   exportCsvUrl,
       6   getDocument,
       8   retryDocument,
       9   uploadDocuments,
      10 } from "./client.js";
     … +260 lines (ctrl+o to expand)

● Write(apps\web\src\api\hooks.test.ts)
  ⎿  Wrote 17 lines to apps\web\src\api\hooks.test.ts
       1 import { describe, expect, it } from "vitest";
       2 import { pollInterval } from "./hooks.js";
       3 
       4 describe("pollInterval", () => {
       5   it("polls every 2s while something is queued or processing", (
       6     expect(pollInterval(["completed", "queued"])).toBe(2000);
       7     expect(pollInterval(["processing"])).toBe(2000);
       8   });
       9 
      10   it("stops once everything is terminal", () => {
     … +8 lines (ctrl+o to expand)

  Ran 1 shell command (ctrl+o to expand)

● Tests are written and failing for the right reason (no client.ts / hooks.ts
  yet). Writing the client, hooks, and the /healthz proxy now.

● Write(apps\web\src\api\client.ts)
  ⎿  Wrote 127 lines to apps\web\src\api\client.ts
      1 import {
      2   DocumentDetailSchema,
      3   DocumentSummarySchema,
      4   ErrorBodySchema,
      5   UploadResponseSchema,
      6   type DocumentDetail,
      7   type DocumentSummary,
      8   type UploadResponse,
      9 } from "@nexus/shared";
     … +134 lines (ctrl+o to expand)

● Write(apps\web\src\api\hooks.ts)
  ⎿  Wrote 50 lines to apps\web\src\api\hooks.ts
       1 import { skipToken, useMutation, useQuery, useQueryClient } from
       2 import { TERMINAL_STATUSES, type DocumentStatus } from "@nexus/s
         hared";
         ts } from "./client.js";
       4 
         list also refreshes the open document.
       6 const DOCUMENTS_KEY = ["documents"] as const;
       8 const POLL_MS = 2000;
       9 
         with no extra code, and a document takes
     … +55 lines (ctrl+o to expand)

● Update(apps\web\vite.config.ts)
  ⎿  Added 1 line
       8      port: 5173,
       9      proxy: {
      10        "/api": "http://localhost:3000",
      11 +      "/healthz": "http://localhost:3000",                     
      12      },
      13    },
      14  });

  Ran 1 shell command (ctrl+o to expand)

● Client and hooks are in, and typecheck, lint and tests all pass (43 files, 459
  tests, 20 of them new in apps/web).

  What changed:
  1. apps/web/vite.config.ts: added the /healthz proxy next to /api.
  2. apps/web/src/api/client.ts: getDocuments, getDocument, uploadDocuments,
     retryDocument, exportCsvUrl, ApiError(status, code, message).
  3. apps/web/src/api/hooks.ts: useDocuments, useDocument(id | null), useUpload,
     useRetry.
  4. client.test.ts and hooks.test.ts next to them, with fetch stubbed.

  @tanstack/react-query ^5.104.1 was already in apps/web/package.json, so
  nothing was installed.

  Things I decided that you didn't spell out:
  - Responses are zod-parsed, not just typed. I used the shared schemas because
    of the "zod at every boundary" rule. A 2xx body that fails the schema throws
    ApiError(status, "INVALID_RESPONSE", ...). ExtractionResultSchema is
    strict, so a new field inside result would fail the detail view at runtime
    until web is rebuilt.
  - Network failure becomes ApiError(0, "NETWORK_ERROR", ...), so components
    handle one error type. Aborts pass through untouched.
  - Non-JSON error bodies (a proxy answering for a dead api) become
    ApiError(status, "HTTP_<status>", statusText).
  - A 400 on upload that is a plain error body (for example BAD_REQUEST for an
    invalid field name) throws ApiError instead of returning an UploadResponse.
  - Mutations invalidate on settled, not only on success. A 413 mid-batch can
    still have stored earlier files, and a 409 on retry means the cached
    document is stale.
  - The detail key is ["documents", id], so one invalidation of ["documents"]
    refreshes both the list and the open document.

  Not done:
  - main.tsx has no QueryClientProvider yet. I left it for the components step;
    the hooks will throw without it.
  - The hooks themselves are not rendered in any test, only the polling rule
    (pollInterval) is. Rendering them needs jsdom plus @testing-library/react,
    which you haven't approved. Say if you want them.

  Next: send the components step, and tell me whether the provider goes in
  main.tsx there.

✻ Sautéed for 3m 14s · done 3:35 AM

❯ all choices fine. no jsdom / testing-library for now, the hooks are thin and  
  the polling rule is tested. we can revisit in the tests phase.                
                                                                                
  this step:                                                                    
                                                                                
  main.tsx: QueryClientProvider. queries retry 1, mutations retry 0 (an upload  
  or retry should never be sent twice by the client). App.tsx as a shell:       
  header with the app name, the dropzone at the top, an empty spot below where  
  the table and panel go next.                                                  
                                                                                
  UploadDropzone: drag n drop + "Choose files" button (multiple, .pdf .docx).   
  check extension, <= 20mb, max 10 before sending and list the rejects right    
  away. "Uploading N files..." while it runs. after: a line per file, green     
  Queued / grey "Duplicate of earlier upload" / red "Rejected: <msg>", cleared  
  next upload. aria-live polite for those. a request-level error                
  (TOO_MANY_FILES, UNEXPECTED_FIELD, NO_FILES) shows as one red line above the  
  list, and an ApiError (NETWORK_ERROR etc) the same way.                       
                                                                                
  keep the client-side limits in one place, and if shared already exports the   
  20mb / 10 files limits, use those instead of new constants.                   
                                                                                
  typecheck, lint, test.                                                        

  Searched for 1 pattern (ctrl+o to expand)

● Write(apps\web\src\lib\uploadLimits.test.ts)
  ⎿  Wrote 55 lines to apps\web\src\lib\uploadLimits.test.ts
       1 import { describe, expect, it } from "vitest";
       2 import { ACCEPT_ATTRIBUTE, checkFiles, UPLOAD_LIMITS } from "./u
         ploadLimits.js";
       3 
       4 const MB = 1024 * 1024;
       6 function file(name: string, size = 1000) {
       7   return { name, size };
       8 }
       9 
      10 describe("checkFiles", () => {
     … +58 lines (ctrl+o to expand)

● Write(apps\web\src\lib\uploadLimits.ts)
  ⎿  Wrote 50 lines to apps\web\src\lib\uploadLimits.ts
       1 import { MIME_FORMATS } from "@nexus/shared";
       2 
       4 
       5 // The api is what enforces these (MAX_UPLOAD_MB, MAX_FILES_PER_
         REQUEST). Checking here only saves the user
         se its config is node-only and env driven,
       7 // so a deployment that changes those env vars would also have t
         o change this file.
       9   maxFileMb: 20,
      10   maxFiles: 10,
     … +50 lines (ctrl+o to expand)

● Write(apps\web\src\components\UploadDropzone.tsx)
  ⎿  Wrote 121 lines to apps\web\src\components\UploadDropzone.tsx
       1 import { useRef, useState, type DragEvent } from "react";
       2 import { useUpload } from "../api/hooks.js";
       3 import {
       4   ACCEPT_ATTRIBUTE,
       5   checkFiles,
       6   UPLOAD_LIMITS,
       7   type LocalReject,
       8 } from "../lib/uploadLimits.js";
       9 
      10 type Tone = "ok" | "muted" | "error";
     … +125 lines (ctrl+o to expand)

● Write(apps\web\src\App.tsx)
  ⎿  Wrote 13 lines to apps\web\src\App.tsx
       1 import { UploadDropzone } from "./components/UploadDropzone.js";
       2 
       3 export function App() {
       4   return (
       5     <div className="app">
       6       <header className="app-header">
       7         <h1>Nexus Contract Analyzer</h1>
       8       </header>
       9       <UploadDropzone />
      10       <main className="workspace"></main>
     … +3 lines (ctrl+o to expand)

● Write(apps\web\src\main.tsx)  ⎿  Added 14 lines, removed 1 line
       1  import { StrictMode } from "react";
       2  import { createRoot } from "react-dom/client";
       3 +import { QueryClient, QueryClientProvider } from "@tanstack/rea
         +ct-query";                                                     
       4 +import { App } from "./App.js";                                
       5 +import "./styles.css";                                         
       6  
       7  const rootElement = document.getElementById("root");
       8  if (!rootElement) throw new Error("index.html is missing #root"
          );
       9  
      10 +const queryClient = new QueryClient({                          
      11 +  defaultOptions: {                                            
      12 +    queries: { retry: 1 },                                     
      13 +    // An upload or a retry must never be sent twice by the cli
         +ent. bullmq owns retrying.                                     
      14 +    mutations: { retry: 0 },                                   
      15 +  },                                                           
      16 +});                                                            
      17 +                                                               
      18  createRoot(rootElement).render(
      19    <StrictMode>
       9 -    <h1>Nexus Contract Analyzer</h1>                           
      20 +    <QueryClientProvider client={queryClient}>                 
      21 +      <App />                                                  
      22 +    </QueryClientProvider>                                     
      23    </StrictMode>,
      24  );

● Write(apps\web\src\styles.css)
  ⎿  Wrote 79 lines to apps\web\src\styles.css
       1 :root {
       2   --text: #1c1f24;
       3   --muted: #6b7280;
       4   --border: #d0d5dd;
       5   --ok: #17703a;
       6   --error: #b42318;
       7   --accent: #1d4ed8;
       8   font-family: system-ui, sans-serif;
       9   color: var(--text);
      10 }
     … +69 lines (ctrl+o to expand)

  Ran 1 shell command (ctrl+o to expand)

● The dropzone, shell and provider are in; typecheck, lint and tests pass (44
  files, 465 tests, 6 new) and vite build succeeds. I have not opened it in a
  browser, so the drag and drop and the rendered states are untested by hand.

  What changed:
  1. main.tsx: QueryClientProvider, queries retry 1, mutations retry 0.
  2. App.tsx: header, UploadDropzone, an empty <main className="workspace"> for
     the table and panel.
  3. components/UploadDropzone.tsx: drop area plus "Choose files", "Uploading N
     files...", one line per file, request-level error or ApiError as one red
     line above the list, all inside an aria-live="polite" region.
  4. lib/uploadLimits.ts (+ test): the limits and checkFiles, in one place.
  5. styles.css: plain CSS, no library.

  Shared does not export the limits in a browser-safe way. The 20 MB and 10
  files only exist as env defaults (MAX_UPLOAD_MB, MAX_FILES_PER_REQUEST) in the
  node-only config, which web can't import. So uploadLimits.ts has its own 20
  and 10, with a comment saying they repeat the api defaults. If someone changes
  the env vars, the client check drifts; the api still enforces the real limit.
  The extensions do come from shared (MIME_FORMATS).

  Choices you didn't spell out:
  - More than 10 files: the first 10 valid ones are sent and the rest are listed
    as "Rejected: Only 10 files per upload". Invalid files don't count towards
    the 10.
  - Nothing valid: no request is sent, only the rejects show.
  - While uploading: the button is disabled and drops are ignored.
  - Line order: server accepted, server rejected, then client-side rejects, not
    the order the files were picked in.

  Next: run npm run dev with LLM_PROVIDER=mock, drop a pdf, a .txt and a repeat
  of the pdf, and check the three line colours.

✻ Crunched for 1m 59s · done 3:42 AM

❯ checked in the browser, the dropzone works: queued, duplicate, server reject  
  and client reject all show right.                                             
                                                                                
  two small things first:                                                       
  1. the api's rejection for a file whose content isn't pdf/docx reads "Only    
  PDF and DOCX are accepted, detected unknown". make it "The file content is    
  not a PDF or DOCX" when nothing was detected, and "The file content is        
  <type>, not a PDF or DOCX" when file-type found something. update the api     
  test that pins the text.                                                      
  2. move the 20mb / 10 files defaults into shared as browser-safe constants    
  (e.g. packages/shared/src/limits.ts, exported from "."), make the node config 
  use them as the defaults for MAX_UPLOAD_MB / MAX_FILES_PER_REQUEST, and       
  import them in uploadLimits.ts. one source for the defaults, the api still    
  enforces whatever env says.                                                   
                                                                                
  then DocumentsTable, should answer who / how much / when do we have to act /  
  how risky:                                                                    
                                                                                
  File (+ "duplicate" tag)                                                      
  Status badge: queued grey, processing blue with stage + pulsing dot,          
  completed green, needs_review amber "Review", failed red with a short label   
  for the error code and the full message in the title                          
  Vendor                                                                        
  Value                                                                         
  Expires                                                                       
  Notice by: date + "(23 days)", red <= 30, amber <= 90, grey "passed" when     
  negative. use days_until_notice_deadline from the api, never compute days in  
  the browser: the api recomputes derived dates on every read with its own      
  clock, one clock means the table and csv always agree. this is the most       
  useful number in the app                                                      
  Risk: max severity badge + count                                              
  Grounding: %, amber under 80                                                  
                                                                                
  newest first, click Notice by / Risk headers to sort (nulls last). row click  
  -> ?doc=<id> + highlight. empty state "No documents yet. Upload a PDF or DOCX 
  contract to start." Export CSV link + counts per status above it.             
                                                                                
  lib/format.ts: money via Intl en-GB (fallback "amount CUR" if it throws),     
  dates like "28 Feb 2027", days left, and errorLabel(code) as a                
  Record<ErrorCode, string> so a new code in shared breaks the build until it   
  has a label: NO_TEXT_LAYER "Scanned PDF, no text layer", EMPTY_DOCUMENT "No   
  text in document", PARSE_ERROR "Could not read file", LLM_UNAVAILABLE "Model  
  unavailable", LLM_AUTH "Model credentials rejected", EXTRACTION_INVALID       
  "Model output invalid", WORKER_STOPPED "Processing interrupted twice",        
  INTERNAL "Internal error" (add any others shared has, tell me which).         
                                                                                
  the panel is the next step, for now selecting a row just sets ?doc and        
  highlights it. typecheck, lint, test.                                         

  Ran 1 shell command (ctrl+o to expand)

● Bash(python - <<'PY'
      import re,io…)
  ⎿   apps/web/src/main.tsx                     | 15 ++++++++++++++-
      apps/web/vite.config.ts                   |  1 +
      eslint.config.js                          |  1 +
     … +30 lines (ctrl+o to expand)
  ⎿  Updated apps\web\src\lib\uploadLimits.ts (+10 -6)
       1 -import { MIME_FORMATS } from "@nexus/shared";                  
       1 +import {                                                       
       2 +  DEFAULT_MAX_FILES_PER_REQUEST,                               
       3 +  DEFAULT_MAX_UPLOAD_MB,                                       
       4 +  MIME_FORMATS,                                                
       5 +} from "@nexus/shared";                                        
       6  
       7  const MB = 1024 * 1024;
       8  
       5 -// The api is what enforces these (MAX_UPLOAD_MB, MAX_FILES_PER
         -_REQUEST). Checking here only saves the user                   
       6 -// a pointless upload. The numbers repeat the api defaults beca
         -use its config is node-only and env driven,                    
       7 -// so a deployment that changes those env vars would also have 
         -to change this file.                                           
       9 +// The api is what enforces these. Checking here only saves the
         + user a pointless upload. The numbers are                      
      10 +// the api defaults from shared, so a deployment that overrides
         + MAX_UPLOAD_MB or MAX_FILES_PER_REQUEST                        
      11 +// gets a client check that is off, and the api answer is still
         + the one that counts.                                          
      12  export const UPLOAD_LIMITS = {
       9 -  maxFileMb: 20,                                               
      10 -  maxFiles: 10,                                                
      13 +  maxFileMb: DEFAULT_MAX_UPLOAD_MB,                            
      14 +  maxFiles: DEFAULT_MAX_FILES_PER_REQUEST,                     
      15    extensions: [...new Set(MIME_FORMATS.values())],
      16  } as const;
      17  
  ⎿  Updated eslint.config.js (+1 -0)
      36        "packages/shared/src/index.ts",
      37        "packages/shared/src/status.ts",
      38        "packages/shared/src/formats.ts",
      39 +      "packages/shared/src/limits.ts",                         
      40        "packages/shared/src/schemas/**",
      41      ],
      42      rules: {
  ⎿  Updated packages\shared\src\config.ts (+3 -2)
      1  import { z } from "zod";
      2 +import { DEFAULT_MAX_FILES_PER_REQUEST, DEFAULT_MAX_UPLOAD_MB } 
        +from "./limits.js";                                             
      3  
      4  export const LlmProviderName = z.enum(["ollama", "anthropic", "o
         penai", "mock"]);
      5  export type LlmProviderName = z.infer<typeof LlmProviderName>;
     ...
      16      DATABASE_PATH: z.string().default("./data/app.db"),
      17      UPLOAD_DIR: z.string().default("./data/uploads"),
      18      REDIS_URL: z.url().default("redis://localhost:6379"),
      18 -    MAX_UPLOAD_MB: PositiveInt.default(20),                    
      19 -    MAX_FILES_PER_REQUEST: PositiveInt.default(10),            
      19 +    MAX_UPLOAD_MB: PositiveInt.default(DEFAULT_MAX_UPLOAD_MB), 
      20 +    MAX_FILES_PER_REQUEST: PositiveInt.default(DEFAULT_MAX_FILE
         +S_PER_REQUEST),                                                
      21      LLM_PROVIDER: LlmProviderName.default("ollama"),
      22      LLM_MODEL: z.string().default("qwen2.5:7b-instruct"),
      23      OLLAMA_URL: z.url().default("http://localhost:11434"),
  ⎿  Updated packages\shared\src\index.ts (+1 -0)
      1  export * from "./status.js";
      2  export * from "./formats.js";
      3 +export * from "./limits.js";                                    
      4  export * from "./schemas/extraction.js";
      5  export * from "./schemas/api.js";
      6  export * from "./derive.js";
  ⎿  Created packages\shared\src\limits.ts (+4 -0)
      1 +// Defaults for MAX_UPLOAD_MB and MAX_FILES_PER_REQUEST. They li
        +ve here and not in config.ts so the web                         
      2 +// client can check files against the same numbers before upload
        +ing. The api enforces whatever env says.                        
      3 +export const DEFAULT_MAX_UPLOAD_MB = 20;                        
      4 +export const DEFAULT_MAX_FILES_PER_REQUEST = 10;                
  ⎿  … 2 more files changed

● Write(apps\web\src\lib\format.ts)
  ⎿  Wrote 65 lines to apps\web\src\lib\format.ts
       1 import type { ErrorCode } from "@nexus/shared";
       3 // Shown where a value is missing. A hyphen so an empty cell is 
         not mistaken for a loading one.
       4 export const EMPTY = "-";
       6 const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul",
          "Aug", "Sep", "Oct", "Nov", "Dec"];
       8 export function formatMoney(money: { amount: number; currency: s
         tring }): string {
       9   try {
         urrency: money.currency }).format(
     … +64 lines (ctrl+o to expand)

● Write(apps\web\src\lib\format.test.ts)
  ⎿  Wrote 70 lines to apps\web\src\lib\format.test.ts
       1 import { describe, expect, it } from "vitest";
       2 import { ErrorCode } from "@nexus/shared";
       3 import {
       4   errorLabel,
       5   formatDate,
       6   formatDaysLeft,
       7   formatMoney,
       8   formatPercent,
       9   noticeTone,
      10 } from "./format.js";
     … +67 lines (ctrl+o to expand)

● Write(apps\web\src\lib\tableModel.ts)
  ⎿  Wrote 60 lines to apps\web\src\lib\tableModel.ts
       1 import type { DocumentStatus, DocumentSummary, Severity } from "
       2 
       3 export type SortKey = "newest" | "notice" | "risk";
       4 
         : 2, high: 3 };
       6 
         line or no extraction is never the urgent one.
       8 function nullsLast<T>(a: T | null, b: T | null, compare: (a: T, 
         b: T) => number): number {
      10   if (b === null) return -1;
     … +63 lines (ctrl+o to expand)

● Write(apps\web\src\lib\tableModel.test.ts)
  ⎿  Wrote 105 lines to apps\web\src\lib\tableModel.test.ts
       1 import { describe, expect, it } from "vitest";
       2 import type { DocumentSummary } from "@nexus/shared";
       3 import { countByStatus, sortDocuments } from "./tableModel.js";
       4 
       5 function doc(id: string, over: Partial<DocumentSummary> = {}): D
       6   return {
       7     id,
       8     original_name: `${id}.pdf`,
       9     status: "completed",
      10     stage: null,
     … +106 lines (ctrl+o to expand)

● Write(apps\web\src\lib\selection.ts)
  ⎿  Wrote 41 lines to apps\web\src\lib\selection.ts
      1 import { useCallback, useSyncExternalStore } from "react";
      2 
      3 const PARAM = "doc";
      4 // pushState fires no event of its own, so the setter announces t
        he change with this one.
      5 const CHANGE_EVENT = "nexus:selectionchange";
      6 
      7 export function readSelectedId(search: string): string | null {
      8   return new URLSearchParams(search).get(PARAM) || null;
      9 }
     … +37 lines (ctrl+o to expand)

● Write(apps\web\src\lib\selection.test.ts)
  ⎿  Wrote 26 lines to apps\web\src\lib\selection.test.ts
       1 import { describe, expect, it } from "vitest";
       2 import { readSelectedId, selectionHref } from "./selection.js";
       3 
       4 describe("readSelectedId", () => {
       5   it("reads ?doc", () => {
       6     expect(readSelectedId("?doc=abc")).toBe("abc");
       7     expect(readSelectedId("?x=1&doc=abc")).toBe("abc");
       8   });
       9 
      10   it("is null when the param is missing or empty", () => {
     … +17 lines (ctrl+o to expand)

● Write(apps\web\src\components\DocumentsTable.tsx)
  ⎿  Wrote 198 lines to apps\web\src\components\DocumentsTable.tsx
       1 import { useMemo, useState, type MouseEvent } from "react";
       2 import type { DocumentSummary } from "@nexus/shared";
       3 import { exportCsvUrl } from "../api/client.js";
       4 import { useDocuments } from "../api/hooks.js";
       5 import {
       6   EMPTY,
       7   errorLabel,
       8   formatDate,
       9   formatDaysLeft,
      10   formatMoney,
     … +214 lines (ctrl+o to expand)

● Write(apps\web\src\App.tsx)
  ⎿  Added 7 lines, removed 1 line
       1 +import { DocumentsTable } from "./components/DocumentsTable.js"
         +;                                                              
       2  import { UploadDropzone } from "./components/UploadDropzone.js"
          ;
       3 +import { useSelectedDocument } from "./lib/selection.js";      
       4  
       5  export function App() {
       6 +  const [selectedId, select] = useSelectedDocument();          
       7 +                                                               
       8    return (
       9      <div className="app">
      10        <header className="app-header">
      11          <h1>Nexus Contract Analyzer</h1>
      12        </header>
      13        <UploadDropzone />
      10 -      <main className="workspace"></main>                      
      14 +      <main className="workspace">                             
      15 +        <DocumentsTable selectedId={selectedId} onSelect={selec
         +t} />                                                          
      16 +      </main>                                                  
      17      </div>
      18    );
      19  }

● Bash(cat >> apps/web/src/styles.css <<'EOF'…)
  ⎿  > typecheck
     > tsc -b && tsc -p tsconfig.test.json && npm run typecheck -w @nexus/w
     eb
     … +37 lines (ctrl+o to expand)
  ⎿  Updated apps\web\src\styles.css (+146 -0)
       4    --border: #d0d5dd;
       5    --ok: #17703a;
       6    --error: #b42318;
       7 +  --warn: #9a5b00;                                             
       8    --accent: #1d4ed8;
       9    font-family: system-ui, sans-serif;
      10    color: var(--text);
     ...
       78  .workspace {
       79    margin-top: 24px;
       80  }
       81 +                                                              
       82 +.tone-warn {                                                  
       83 +  color: var(--warn);                                         
       84 +}                                                             
       85 +                                                              
       86 +.documents-toolbar {                                          
       87 +  display: flex;                                              
       88 +  justify-content: space-between;                             
       89 +  align-items: baseline;                                      
       90 +  margin-bottom: 8px;                                         
       91 +}                                                             
       92 +                                                              
       93 +.documents-empty {                                            
       94 +  padding: 32px 0;                                            
       95 +  text-align: center;                                         
       96 +  color: var(--muted);                                        
       97 +}                                                             
       98 +                                                              
       99 +.documents-table {                                            
      100 +  width: 100%;                                                
      101 +  border-collapse: collapse;                                  
      102 +  font-size: 14px;                                            
      103 +}                                                             
      104 +                                                              
      105 +.documents-table th,                                          
      106 +.documents-table td {                                         
      107 +  padding: 8px 10px;                                          
      108 +  border-bottom: 1px solid var(--border);                     
      109 +  text-align: left;                                           
      110 +  white-space: nowrap;                                        
     … 115 more lines (ctrl+o to expand)

● Bash(npx prettier --write apps/web/src/components apps/web/src/lib 2>&1 | grep
      -v unchanged; npx prettier --check apps/web/src
      packages/shared/src/limits.ts packages…)
  ⎿  apps/web/src/components/DocumentsTable.tsx 125ms
     apps/web/src/components/UploadDropzone.tsx 32ms
     apps/web/src/lib/selection.ts 11ms
     … +22 lines (ctrl+o to expand)
  ⎿  Updated apps\web\src\components\DocumentsTable.tsx (+1 -3)
      132        )}
      133  
      134        {rows.length === 0 ? (
      135 -        <p className="documents-empty">                       
      136 -          No documents yet. Upload a PDF or DOCX contract to s
          -tart.                                                         
      137 -        </p>                                                  
      135 +        <p className="documents-empty">No documents yet. Uploa
          +d a PDF or DOCX contract to start.</p>                        
      136        ) : (
      137          <table className="documents-table">
      138            <thead>
  ⎿  Updated apps\web\src\components\UploadDropzone.tsx (+15 -20)
      46    const requestError = upload.error?.message ?? upload.data?.er
          ror?.message;
      47  
      48    const lines: ResultLine[] = [
      49 -    ...(upload.data?.accepted ?? []).map(                      
      50 -      (doc): ResultLine =>                                     
      51 -        doc.duplicate_of === null                              
      52 -          ? { name: doc.original_name, tone: "ok", text: "Queue
         -d" }                                                           
      53 -          : { name: doc.original_name, tone: "muted", text: "Du
         -plicate of earlier upload" },                                  
      54 -    ),                                                         
      55 -    ...(upload.data?.rejected ?? []).map(                      
      56 -      (file): ResultLine => ({                                 
      57 -        name: file.original_name,                              
      58 -        tone: "error",                                         
      59 -        text: `Rejected: ${file.message}`,                     
      60 -      }),                                                      
      61 -    ),                                                         
      62 -    ...localRejects.map(                                       
      63 -      (file): ResultLine => ({ name: file.name, tone: "error", 
         -text: `Rejected: ${file.message}` }),                          
      49 +    ...(upload.data?.accepted ?? []).map((doc): ResultLine =>  
      50 +      doc.duplicate_of === null                                
      51 +        ? { name: doc.original_name, tone: "ok", text: "Queued"
         + }                                                             
      52 +        : { name: doc.original_name, tone: "muted", text: "Dupl
         +icate of earlier upload" },                                    
      53      ),
      54 +    ...(upload.data?.rejected ?? []).map((file): ResultLine => 
         +({                                                             
      55 +      name: file.original_name,                                
      56 +      tone: "error",                                           
      57 +      text: `Rejected: ${file.message}`,                       
      58 +    })),                                                       
      59 +    ...localRejects.map((file): ResultLine => ({               
      60 +      name: file.name,                                         
      61 +      tone: "error",                                           
      62 +      text: `Rejected: ${file.message}`,                       
      63 +    })),                                                       
      64    ];
      65  
      66    return (
     ...
      75            Drop contracts here ({UPLOAD_LIMITS.extensions.map((e
          xt) => `.${ext}`).join(", ")}, up to{" "}
      76            {UPLOAD_LIMITS.maxFileMb} MB each, {UPLOAD_LIMITS.max
          Files} per upload)
      77          </p>
      79 -        <button                                                
     … 8 more lines (ctrl+o to expand)
  ⎿  Updated apps\web\src\lib\selection.ts (+1 -3)
      29  // The selected document lives in ?doc=<id> and nowhere else, s
          o a copied link opens the same document
      30  // and back / forward move between selections.
      31  export function useSelectedDocument(): [string | null, (id: str
          ing | null) => void] {
      32 -  const selectedId = useSyncExternalStore(subscribe, () =>     
      33 -    readSelectedId(window.location.search),                    
      34 -  );                                                           
      32 +  const selectedId = useSyncExternalStore(subscribe, () => read
         +SelectedId(window.location.search));                           
      33    const select = useCallback((id: string | null) => {
      34      if (id === readSelectedId(window.location.search)) return;
      35      window.history.pushState(null, "", selectionHref(window.loc
          ation.search, id));
  ⎿  Updated apps\web\src\lib\uploadLimits.ts (+1 -5)
      1 -import {                                                        
      2 -  DEFAULT_MAX_FILES_PER_REQUEST,                                
      3 -  DEFAULT_MAX_UPLOAD_MB,                                        
      4 -  MIME_FORMATS,                                                 
      5 -} from "@nexus/shared";                                         
      1 +import { DEFAULT_MAX_FILES_PER_REQUEST, DEFAULT_MAX_UPLOAD_MB, M
        +IME_FORMATS } from "@nexus/shared";                             
      2  
      3  const MB = 1024 * 1024;
      4  

● Both small fixes and DocumentsTable are in; typecheck, lint and tests pass (47
  files, 483 tests, 18 new). vite build succeeds, but I have not opened the
  table in a browser.

  1. Rejection text (services/api/src/services/upload.ts)
  - Nothing detected: "The file content is not a PDF or DOCX".
  - Something detected: "The file content is application/zip, not a PDF or DOCX"
    (the type is the mime from file-type).
  - The pinned test in documents.test.ts is updated to both strings.

  2. Limits in shared
  - New packages/shared/src/limits.ts exports DEFAULT_MAX_UPLOAD_MB (20) and
    DEFAULT_MAX_FILES_PER_REQUEST (10) from ".".
  - config.ts uses them as the env defaults and uploadLimits.ts imports them.
  - I added limits.ts to the browser-safe file list in eslint.config.js so it
    can't pick up node imports.

  3. Table
  - components/DocumentsTable.tsx, wired into App.tsx, with lib/format.ts,
    lib/tableModel.ts (sorting, counts) and lib/selection.ts (?doc=<id>), each
    with tests.
  - The days figure is only ever days_until_notice_deadline from the api;
    nothing reads the browser clock.

  Error labels I added for the codes you didn't list:
  - UNSUPPORTED_TYPE: "Unsupported file type"
  - FILE_TOO_LARGE: "File too large"
  - TEXT_TOO_LONG: "Document too long"

  Choices you didn't spell out:
  - Sort direction: Notice by is fewest days first, so passed deadlines sit at
    the top, above the red ones. Risk is highest severity first, then count.
    Clicking the active header again returns to newest first; there is no
    reverse direction.
  - Counts line: "2 queued, 1 processing, 5 completed (1 to review), 0 failed".
    Review documents are counted inside completed.
  - Row link: the file name is a real ?doc=<id> link, so it works from the
    keyboard and ctrl-click opens it in a new tab. Selecting uses pushState, so
    back and forward move between selections.
  - Notice by at 0 days reads "(today)", in red.
  - Risk with zero clauses shows grey "None"; with no extraction it shows "-".
  - Grounding amber line is a constant 0.8 in the component. It does not follow
    GROUNDING_REVIEW_THRESHOLD if that env var is changed.
  - Failed poll with rows already loaded: the rows stay and a red "Could not
    refresh" line appears above them.
  - Dates are formatted from the ISO text with a fixed month list instead of
    Intl, so the output is always "1 Sep 2026" and never shifts by timezone.

  I also ran prettier on apps/web/src/components and apps/web/src/lib, which
  reformatted UploadDropzone.tsx and uploadLimits.ts from the last step.

  git status shows two untracked files I did not create:
  samples/SampleDocx/note.txt and samples/SamplePDFs/note.txt.

  Next: reload the page with a few documents in different states, click "Notice
  by", and tell me if passed deadlines belong at the top or the bottom.

✻ Churned for 4m 9s · done 3:52 AM

❯ table works. one change: notice by sort puts upcoming deadlines first (fewest 
  days, 0 included), then passed ones, then nulls. a passed deadline means      
  that window is gone and the contract renews, it's not the next thing to act   
  on. the panel shows it as a critical alert anyway. update the sort test. the  
  two note.txt files were mine, deleted.                                        
                                                                                
  then DocumentDetail side panel, Esc or X closes it and clears ?doc. top to    
  bottom:                                                                       
                                                                                
  1. name, status, provider + model + prompt version, chunk count, tokens       
  in/out, processing time, when it was processed. the "review: " warnings in an 
  amber box at the top, those are the reasons a human has to look               
  2. alerts by level, keyed and styled by code (notice_deadline_soon,           
  no_notice_period, expiration_mismatch etc), text from message                 
  3. summary                                                                    
  4. key terms as FieldRows: vendor, customer, type, effective, expiration (tag 
  from derived.expiration_source: stated / computed), initial term, auto        
  renewal, renewal term, notice days, current term end, next renewal, notice    
  deadline, total value, payment terms, governing law, liability cap            
  5. risks grouped high -> low with title, category, explanation, quote, page,  
  verified flag                                                                 
  6. conflicts if any                                                           
  7. "processing notes": the other warnings (normalize drops like risk_clauses: 
  dropped "X" (quote was "null"), summary fallback), collapsed by default.      
  they show what the model actually sent and what the code threw away, that's   
  the honest part                                                               
  8. event timeline with durations (stages parsing/extracting/validating, plus  
  "queue" and "job" events for retries, the completion summary and              
  WORKER_STOPPED)                                                               
  9. raw json in <details>                                                      
  10. retry button for failed / needs_review. failed docs show errorLabel + the 
  message up top instead of 2-7                                                 
                                                                                
  FieldRow: label, value or "Not stated", confidence pill, "p. N" only when     
  quote_page isn't null (docx has no pages), quote in a blockquote clamped to 2 
  lines with show more. unverified -> amber icon + "Quote not found in          
  document text"                                                                
                                                                                
  typecheck, lint, test.                                                        

  Ran 2 shell commands (ctrl+o to expand)

● Bash(python - <<'PY'
      p='apps/web/src/components/DocumentsTable.tsx'…)
  ⎿  25:  created_at: string;
     52:  created_at: string;
     63:  created_at: string;
     … +5 lines (ctrl+o to expand)
  ⎿  Updated apps\web\src\components\DocumentsTable.tsx (+1 -27)
       4  import { useDocuments } from "../api/hooks.js";
       5  import {
       6    EMPTY,
       7 -  errorLabel,                                                  
       7    formatDate,
       8    formatDaysLeft,
       9    formatMoney,
     ...
      12  } from "../lib/format.js";
      13  import { selectionHref } from "../lib/selection.js";
      14  import { countByStatus, sortDocuments, type SortKey } from "../
          lib/tableModel.js";
      15 +import { StatusBadge } from "./StatusBadge.js";                
      16  
      17  // Same line the api uses by default to flag a document for rev
          iew (GROUNDING_REVIEW_THRESHOLD).
      18  const GROUNDING_WARN_BELOW = 0.8;
     ...
      27    return event.button === 0 && !event.metaKey && !event.ctrlKey
           && !event.shiftKey && !event.altKey;
      28  }
      29  
      30 -function StatusBadge({ doc }: { doc: DocumentSummary }) {      
      31 -  switch (doc.status) {                                        
      32 -    case "queued":                                             
      33 -      return <span className="badge badge-grey">Queued</span>; 
      34 -    case "processing":                                         
      35 -      return (                                                 
      36 -        <span className="badge badge-blue">                    
      37 -          <span className="pulse-dot" aria-hidden="true" />    
      38 -          Processing{doc.stage ? `: ${doc.stage}` : ""}        
      39 -        </span>                                                
      40 -      );                                                       
      41 -    case "completed":                                          
      42 -      return doc.needs_review ? (                              
      43 -        <span className="badge badge-amber">Review</span>      
      44 -      ) : (                                                    
      45 -        <span className="badge badge-green">Completed</span>   
      46 -      );                                                       
      47 -    case "failed":                                             
      48 -      return (                                                 
      49 -        <span className="badge badge-red" title={doc.error_mess
         -age ?? undefined}>                                             
      50 -          {doc.error_code ? errorLabel(doc.error_code) : "Faile
         -d"}                                                            
      51 -        </span>                                                
      52 -      );                                                       
     … 6 more lines (ctrl+o to expand)
  ⎿  Updated apps\web\src\lib\tableModel.test.ts (+12 -3)
      41      expect(ids(input)).toEqual(["old", "new", "mid"]);
      42    });
      43  
      44 -  it("sorts notice by fewest days first, passed deadlines on to
         -p, nulls last", () => {                                        
      44 +  it("sorts notice by upcoming first (0 included), then passed,
         + then nulls", () => {                                          
      45      const input = [
      46        doc("none"),
      47        doc("far", { days_until_notice_deadline: 200 }),
      48 -      doc("passed", { days_until_notice_deadline: -5 }),       
      48 +      doc("long-passed", { days_until_notice_deadline: -40 }), 
      49        doc("soon", { days_until_notice_deadline: 23 }),
      50 +      doc("just-passed", { days_until_notice_deadline: -1 }),  
      51 +      doc("today", { days_until_notice_deadline: 0 }),         
      52      ];
      51 -    expect(ids(sortDocuments(input, "notice"))).toEqual(["passe
         -d", "soon", "far", "none"]);                                   
      53 +    expect(ids(sortDocuments(input, "notice"))).toEqual([      
      54 +      "today",                                                 
      55 +      "soon",                                                  
      56 +      "far",                                                   
      57 +      "just-passed",                                           
      58 +      "long-passed",                                           
      59 +      "none",                                                  
      60 +    ]);                                                        
      61    });
      62  
      63    it("sorts risk by severity, then count, nulls last", () => {
  ⎿  Updated apps\web\src\lib\tableModel.ts (+6 -2)
      16    return a.created_at < b.created_at ? 1 : a.created_at > b.cre
          ated_at ? -1 : 0;
      17  }
      18  
      19 +// Upcoming deadlines first, the closest on top. A passed deadl
         +ine is not the next thing to act on (that                      
      20 +// window is gone and the contract renews), so those follow, mo
         +st recently passed first. Nulls go last.                       
      21  function byNotice(a: DocumentSummary, b: DocumentSummary): numb
          er {
      20 -  // Fewest days first, so a passed or close deadline is at the
         - top.                                                          
      21 -  return nullsLast(a.days_until_notice_deadline, b.days_until_n
         -otice_deadline, (x, y) => x - y);                              
      22 +  return nullsLast(a.days_until_notice_deadline, b.days_until_n
         +otice_deadline, (x, y) => {                                    
      23 +    if (x < 0 !== y < 0) return x < 0 ? 1 : -1;                
      24 +    return x < 0 ? y - x : x - y;                              
      25 +  });                                                          
      26  }
      27  
      28  function byRisk(a: DocumentSummary, b: DocumentSummary): number
           {

● Sort change and the StatusBadge extraction are done. Writing the panel pieces
  now: labels and formatters, the pure detail model with tests, then FieldRow
  and DocumentDetail.

● Bash(python - <<'PY'
      p='apps/web/src/lib/format.ts'…)  ⎿  Updated apps\web\src\lib\format.test.ts (+46 -1)
       1  import { describe, expect, it } from "vitest";
       2 -import { ErrorCode } from "@nexus/shared";                     
       2 +import { AlertCode, ErrorCode } from "@nexus/shared";          
       3  import {
       4 +  alertLabel,                                                  
       5    errorLabel,
       6 +  formatCount,                                                 
       7    formatDate,
       8 +  formatDateTime,                                              
       9 +  formatDuration,                                              
      10    formatDaysLeft,
      11    formatMoney,
      12    formatPercent,
      13    noticeTone,
      14 +  plural,                                                      
      15  } from "./format.js";
      16  
      17  describe("formatMoney", () => {
     ...
       73      expect(errorLabel("WORKER_STOPPED")).toBe("Processing inte
           rrupted twice");
       74    });
       75  });
       76 +                                                              
       77 +describe("formatDateTime", () => {                            
       78 +  it("writes the local date and a 24h time", () => {          
       79 +    // Built from local parts so the test does not depend on t
          +he machine's timezone.                                        
       80 +    const local = new Date(2026, 8, 11, 3, 6);                
       81 +    expect(formatDateTime(local.toISOString())).toBe("11 Sep 2
          +026, 03:06");                                                 
       82 +  });                                                         
       83 +                                                              
       84 +  it("returns the input when it is not a timestamp", () => {  
       85 +    expect(formatDateTime("nope")).toBe("nope");              
       86 +  });                                                         
       87 +});                                                           
       88 +                                                              
       89 +describe("formatDuration", () => {                            
       90 +  it("picks ms, seconds or minutes", () => {                  
       91 +    expect(formatDuration(850)).toBe("850 ms");               
       92 +    expect(formatDuration(12_340)).toBe("12.3 s");            
       93 +    expect(formatDuration(59_960)).toBe("1 min 0 s");         
       94 +    expect(formatDuration(75_400)).toBe("1 min 15 s");        
     … 21 more lines (ctrl+o to expand)
  ⎿  Updated apps\web\src\lib\format.ts (+104 -1)
       1 -import type { ErrorCode } from "@nexus/shared";                
       1 +import type {                                                  
       2 +  AlertCode,                                                   
       3 +  DocumentType,                                                
       4 +  ErrorCode,                                                   
       5 +  ExtractedFieldName,                                          
       6 +  RiskCategory,                                                
       7 +} from "@nexus/shared";                                        
       8  
       9  // Shown where a value is missing. A hyphen so an empty cell is
           not mistaken for a loading one.
      10  export const EMPTY = "-";
     ...
       69  export function errorLabel(code: ErrorCode): string {
       70    return ERROR_LABELS[code];
       71  }
       72 +                                                              
       73 +// Local time, for the event timeline. Only display: no day ma
          +th is done with it.                                           
       74 +export function formatDateTime(isoTimestamp: string): string {
       75 +  const date = new Date(isoTimestamp);                        
       76 +  const month = MONTHS[date.getMonth()];                      
       77 +  if (month === undefined) return isoTimestamp;               
       78 +  const two = (n: number) => String(n).padStart(2, "0");      
       79 +  return `${date.getDate()} ${month} ${date.getFullYear()}, ${
          +two(date.getHours())}:${two(date.getMinutes())}`;             
       80 +}                                                             
       81 +                                                              
       82 +export function formatDuration(ms: number): string {          
       83 +  if (ms < 1000) return `${ms} ms`;                           
       84 +  // 59.95s and up would print as "60.0 s".                   
       85 +  if (ms < 59_950) return `${(ms / 1000).toFixed(1)} s`;      
       86 +  const seconds = Math.round(ms / 1000);                      
       87 +  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`; 
       88 +}                                                             
       89 +                                                              
       90 +export function formatCount(n: number): string {              
       91 +  return new Intl.NumberFormat("en-GB").format(n);            
       92 +}                                                             
       93 +                                                              
       94 +export function plural(n: number, unit: string): string {     
       95 +  return `${n} ${unit}${n === 1 ? "" : "s"}`;                 
       96 +}                                                             
       97 +                                                              
     … 71 more lines (ctrl+o to expand)

● Write(apps\web\src\lib\detailModel.ts)
  ⎿  Wrote 65 lines to apps\web\src\lib\detailModel.ts
       1 import type {
       2   Alert,
       3   AlertLevel,
       4   DocumentEvent,
       5   DocumentSummary,
       7   Severity,
       8 } from "@nexus/shared";
       9 
      10 // The worker prefixes the reasons a document needs review with 
         this (REVIEW_PREFIX in
     … +72 lines (ctrl+o to expand)

● Write(apps\web\src\lib\detailModel.test.ts)
  ⎿  Wrote 106 lines to apps\web\src\lib\detailModel.test.ts
       1 import { describe, expect, it } from "vitest";
       2 import type { Alert, DocumentEvent } from "@nexus/shared";
       3 import {
       4   canRetry,
       5   groupRisks,
       6   processedAt,
       7   sortAlerts,
       8   splitWarnings,
       9   type RiskClause,
      10 } from "./detailModel.js";
     … +114 lines (ctrl+o to expand)

● Write(apps\web\src\components\StatusBadge.tsx)
  ⎿  Wrote 28 lines to apps\web\src\components\StatusBadge.tsx
       1 import type { DocumentSummary } from "@nexus/shared";
       2 import { errorLabel } from "../lib/format.js";
       3 
       4 export function StatusBadge({ doc }: { doc: DocumentSummary }) {
       5   switch (doc.status) {
       6     case "queued":
       7       return <span className="badge badge-grey">Queued</span>;
       8     case "processing":
       9       return (
      10         <span className="badge badge-blue">
     … +19 lines (ctrl+o to expand)

● Write(apps\web\src\components\FieldRow.tsx)
  ⎿  Wrote 95 lines to apps\web\src\components\FieldRow.tsx
       1 import { useLayoutEffect, useRef, useState } from "react";
       2 import type { Confidence } from "@nexus/shared";
       3 
          instead of trusting the model.
       5 export interface Evidence {
       6   quote: string | null;
       7   confidence: Confidence;
       9   // Null for docx, which has no pages, and when the quote was n
         ot found.
      10   quote_page: number | null;
     … +100 lines (ctrl+o to expand)

● Write(apps\web\src\components\DocumentDetail.tsx)
  ⎿  Wrote 396 lines to apps\web\src\components\DocumentDetail.tsx
       1 import { useEffect, type ReactNode } from "react";
       2 import type {
       3   DocumentDetail as DocumentDetailDto,
       4   ExtractionRecord,
       5   ExtractionResult,
       6 } from "@nexus/shared";
       7 import { useDocument, useRetry } from "../api/hooks.js";
       8 import {
       9   canRetry,
      10   groupRisks,
     … +429 lines (ctrl+o to expand)

● Write(apps\web\src\App.tsx)
  ⎿  Added 5 lines
       1 +import { useCallback } from "react";                           
       2 +import { DocumentDetail } from "./components/DocumentDetail.js"
         +;                                                              
       3  import { DocumentsTable } from "./components/DocumentsTable.js"
          ;
       4  import { UploadDropzone } from "./components/UploadDropzone.js"
          ;
       5  import { useSelectedDocument } from "./lib/selection.js";
       6  
       7  export function App() {
       8    const [selectedId, select] = useSelectedDocument();
       9 +  const close = useCallback(() => select(null), [select]);     
      10  
      11    return (
      12      <div className="app">
     ...
      17        <main className="workspace">
      18          <DocumentsTable selectedId={selectedId} onSelect={selec
          t} />
      19        </main>
      20 +      {/* Keyed by id so "show more" and a retry error from one
         + document don't carry over to the next. */}                    
      21 +      {selectedId !== null && <DocumentDetail key={selectedId} 
         +id={selectedId} onClose={close} />}                            
      22      </div>
      23    );
      24  }

● Bash(cat >> apps/web/src/styles.css <<'EOF'…)
  ⎿  > typecheck
     > tsc -b && tsc -p tsconfig.test.json && npm run typecheck -w @nexus/w
     eb
     … +17 lines (ctrl+o to expand)
  ⎿  Updated apps\web\src\components\DocumentDetail.tsx (+3 -1)
      388          </>
      389        ) : (
      390          <p className={document.error ? "detail-notice tone-err
           or" : "detail-notice tone-muted"}>
      391 -          {document.error ? `Could not load this document: ${d
          -ocument.error.message}` : "Loading..."}                       
      391 +          {document.error                                     
      392 +            ? `Could not load this document: ${document.error.
          +message}`                                                     
      393 +            : "Loading..."}                                   
      394          </p>
      395        )}
      396      </aside>
  ⎿  Updated apps\web\src\styles.css (+303 -0)
      223  .notice-passed {
      224    color: var(--muted);
      225  }
      226 +                                                              
      227 +.detail-panel {                                               
      228 +  position: fixed;                                            
      229 +  top: 0;                                                     
      230 +  right: 0;                                                   
      231 +  bottom: 0;                                                  
      232 +  width: min(600px, 100%);                                    
      233 +  display: flex;                                              
      234 +  flex-direction: column;                                     
      235 +  background: #fff;                                           
      236 +  border-left: 1px solid var(--border);                       
      237 +  box-shadow: -8px 0 24px rgb(0 0 0 / 10%);                   
      238 +  font-size: 14px;                                            
      239 +}                                                             
      240 +                                                              
      241 +.detail-header {                                              
      242 +  display: flex;                                              
      243 +  align-items: center;                                        
      244 +  justify-content: space-between;                             
      245 +  gap: 12px;                                                  
      246 +  padding: 12px 16px;                                         
      247 +  border-bottom: 1px solid var(--border);                     
      248 +}                                                             
      249 +                                                              
      250 +.detail-header h2 {                                           
      251 +  margin: 0;                                                  
      252 +  font-size: 16px;                                            
      253 +  overflow-wrap: anywhere;                                    
      254 +}                                                             
      255 +                                                              
      256 +.close-button {                                               
      257 +  border: 0;                                                  
      258 +  background: none;                                           
      259 +  font-size: 18px;                                            
      260 +  cursor: pointer;                                            
      261 +}                                                             
      262 +                                                              
     … 266 more lines (ctrl+o to expand)

● The sort change and the DocumentDetail panel are in; typecheck, lint and tests
  pass (48 files, 498 tests) and vite build succeeds. I have not opened the
  panel in a browser, so layout, the 2-line clamp and Esc are unchecked by hand.

  Sort: Notice by now goes upcoming first (0 included, fewest days on top), then
  passed, then nulls. The test is updated. Among passed deadlines I put the
  most recently passed first; say if you want the reverse.

  Two things that did not match what you described:
  - "When it was processed" has no field in the DTO. ExtractionRecord carries no
    timestamp, and updated_at moves on a retry. I take the newest job / info
    event (the completion summary the worker writes with the extraction) and
    leave the line out when there is none, for example on a duplicate. A
    created_at on ExtractionRecord would be the proper source, but that is an
    api and shared change.
  - The "review: " prefix lives in the worker (REVIEW_PREFIX in
    services/worker/src/extraction/review.ts), which web can't import. I
    repeated it in lib/detailModel.ts with a TODO(me) about moving it into
    @nexus/shared.

  What's there:
  - components/DocumentDetail.tsx: sections 1 to 10 in your order. X or Esc
    closes it and clears ?doc.
  - components/FieldRow.tsx: FieldRow, plus Quote (2-line clamp, "Show more"
    only when the text overflows) and the verified / "Quote not found in
    document text" line, both reused by the risks.
  - components/StatusBadge.tsx: moved out of the table so the panel uses the
    same badge.
  - lib/detailModel.ts (+ tests): warning split, alert order, risk grouping,
    processed time, retry rule.
  - lib/format.ts: durations, timestamps, and label Records for AlertCode,
    DocumentType, RiskCategory and field names, so a new value in shared breaks
    the build.

  Choices you didn't spell out:
  - Panel position: fixed on the right, 600px wide, over the table. It covers
    the right-hand columns while open; the rows on the left stay clickable.
  - Retry button: in a footer pinned to the bottom of the panel, so it is last
    in order but always visible.
  - Failed documents: error label and message, then events and raw JSON.
    Sections 2 to 7 are hidden even if an older extraction exists.
  - Queued or processing after a retry: the old extraction still shows, under a
    line saying "This is the result of the previous run."
  - Expiration row: the date is derived.expiration_date with the stated /
    computed tag. The quote shows only when the contract stated a date.
  - Computed rows (current term end, next renewal, notice deadline): tagged
    "computed", no confidence or quote, and "Not computed" instead of "Not
    stated" when empty.
  - Rows with no value show "Not stated" only, without a confidence pill.
  - Alerts get a short title from the code and the text from message. Colour
    follows the level; each also has an alert-code-<code> class with no styles
    on it yet.
  - Tokens read "tokens not reported" when both counts are 0.
  - Event times are in the browser's local time.

  Next: open a completed multi-chunk document and a failed one, and tell me
  whether the panel should cover the table or sit beside it.

✻ Brewed for 4m 27s · done 4:06 AM

❯ panel checked in the browser, works well. changes, then styling:              
                                                                                
  1. processed time: do it properly instead of reading the last event. if the   
  extractions table already has created_at, expose it on ExtractionRecord and   
  the detail dto. if it doesn't, add it with a migration (default current       
  timestamp, backfill existing rows from the document's updated_at).            
  2. duplicates: the panel header shows the original's provider, model, tokens  
  and "took 1 min 3 s", which reads like this upload took a minute. for a       
  duplicate, replace that line with "Result reused from <original name>"        
  linking to ?doc=<duplicate_of>, and no processed time of its own.             
  3. move REVIEW_PREFIX into @nexus/shared (browser-safe), worker and web both  
  import it. remove the TODO(me), those are only for places where I write my    
  own opinion.                                                                  
  4. passed deadlines most recent first is fine.                                
                                                                                
  then step 46, styles:                                                         
  styles.css only, css vars with light + dark (prefers-color-scheme), system    
  fonts, max 1400px, sticky table header. panel sits beside the table on wide   
  screens (table shrinks, panel ~520px), not over it: right now it covers       
  notice by and risk, and you can't click through rows and compare while it's   
  open. under 900px the panel goes full screen. focus styles visible for        
  keyboard use. build it and tell me the bundle size (js + css, gzipped).       
                                                                                
  side note, no change needed: fake-markers hit WORKER_STOPPED because npm run  
  dev restarted the worker twice while it ran (your edits). the handler did     
  exactly what it should.                                                       
                                                                                
  typecheck, lint, test.                                                        

  Ran 2 shell commands (ctrl+o to expand)

● Bash(python - <<'PY'
      import re…)
  ⎿  function orNull<T>(value: T | null, format: (value: T) => string): str
     ing | null {
       return value === null ? null : format(value);
     … +93 lines (ctrl+o to expand)
  ⎿  Updated apps\web\src\lib\detailModel.test.ts (+1 -24)
      1  import { describe, expect, it } from "vitest";
      2 -import type { Alert, DocumentEvent } from "@nexus/shared";      
      2 +import type { Alert } from "@nexus/shared";                     
      3  import {
      4    canRetry,
      5    groupRisks,
      6 -  processedAt,                                                  
      6    sortAlerts,
      7    splitWarnings,
      8    type RiskClause,
     ...
      69    });
      70  });
      71  
      73 -describe("processedAt", () => {                                
      74 -  function event(stage: string, outcome: DocumentEvent["outcome
         -"], at: string): DocumentEvent {                               
      75 -    return { stage, outcome, message: "m", duration_ms: null, c
         -reated_at: at };                                               
      76 -  }                                                            
      77 -                                                               
      78 -  it("is the newest job info event", () => {                   
      79 -    const events = [                                           
      80 -      event("job", "info", "2026-10-10T10:00:00.000Z"),        
      81 -      event("queue", "retry", "2026-10-11T09:00:00.000Z"),     
      82 -      event("extracting", "ok", "2026-10-11T09:01:00.000Z"),   
      83 -      event("job", "info", "2026-10-11T09:02:00.000Z"),        
      84 -      event("job", "retry", "2026-10-11T09:03:00.000Z"),       
      85 -    ];                                                         
      86 -    expect(processedAt(events)).toBe("2026-10-11T09:02:00.000Z"
         -);                                                             
      87 -  });                                                          
      88 -                                                               
      89 -  it("is null without one", () => {                            
      90 -    expect(processedAt([event("job", "error", "2026-10-11T09:00
         -:00.000Z")])).toBeNull();                                      
      91 -    expect(processedAt([])).toBeNull();                        
      92 -  });                                                          
      93 -});                                                            
      94 -                                                               
      72  describe("canRetry", () => {
      73    it("allows failed and completed documents that need review", 
          () => {
      74      expect(canRetry({ status: "failed", needs_review: false }))
          .toBe(true);
  ⎿  Updated apps\web\src\lib\detailModel.ts (+7 -23)
       1 -import type {                                                  
       2 -  Alert,                                                       
       3 -  AlertLevel,                                                  
       4 -  DocumentEvent,                                               
       5 -  DocumentSummary,                                             
       6 -  ExtractionResult,                                            
       7 -  Severity,                                                    
       1 +import {                                                       
       2 +  REVIEW_PREFIX,                                               
       3 +  type Alert,                                                  
       4 +  type AlertLevel,                                             
       5 +  type DocumentSummary,                                        
       6 +  type ExtractionResult,                                       
       7 +  type Severity,                                               
       8  } from "@nexus/shared";
       9  
      10 -// The worker prefixes the reasons a document needs review with
         - this (REVIEW_PREFIX in                                        
      11 -// services/worker/src/extraction/review.ts). It is repeated he
         -re because web can't import the worker.                        
      12 -// TODO(me): move the prefix into @nexus/shared so the worker a
         -nd this file can't drift?                                      
      13 -export const REVIEW_PREFIX = "review: ";                       
      14 -                                                               
      10  export interface SplitWarnings {
      11    // Why a human has to look, without the prefix.
      12    review: string[];
     ...
      43    })).filter((group) => group.clauses.length > 0);
      44  }
      45  
      51 -// The detail dto has no timestamp for the extraction itself, a
         -nd updated_at moves on a retry. The worker                     
      52 -// writes one "job" / "info" event when it stores an extraction
         -, so the newest of those is when the shown                     
      53 -// result was produced. Null when there is none, e.g. a duplica
         -te that reuses another document's result.                      
      54 -export function processedAt(events: readonly DocumentEvent[]): 
         -string | null {                                                
      55 -  for (let i = events.length - 1; i >= 0; i -= 1) {            
      56 -    const event = events[i];                                   
      57 -    if (event && event.stage === "job" && event.outcome === "in
         -fo") return event.created_at;                                  
      58 -  }                                                            
      59 -  return null;                                                 
      60 -}                                                              
      61 -                                                               
      46  // Mirrors the rule in the api's retry route. The api still dec
          ides: a stale answer here gets a 409.
      47  export function canRetry(doc: Pick<DocumentSummary, "status" | 
          "needs_review">): boolean {
     … 1 more lines (ctrl+o to expand)
  ⎿  Updated packages\shared\src\schemas\api.ts (+2 -0)
      58    output_tokens: NonNegInt,
      59    duration_ms: NonNegInt,
      60    chunk_count: z.int().min(1),
      61 +  // When the worker stored this result. For a duplicate it is 
         +the original's, since the result is reused.                    
      62 +  created_at: Timestamp,                                       
      63  });
      64  export type ExtractionRecord = z.infer<typeof ExtractionRecordS
          chema>;
      65  
  ⎿  Updated packages\shared\src\schemas\extraction.ts (+4 -0)
      180  export const ExtractedFieldName = LlmExtractionSchema.keyof().
           exclude(["risk_clauses", "summary"]);
      181  export type ExtractedFieldName = z.infer<typeof ExtractedField
           Name>;
      182  
      183 +// Warnings that start with this are the reasons a document ne
          +eds review. The worker writes it and the                      
      184 +// web panel splits on it, so it is defined once here.        
      185 +export const REVIEW_PREFIX = "review: ";                      
      186 +                                                              
      187  // Conflicting candidates are kept as the model returned them,
            so they use the loose value types.
      188  const Conflict = z.strictObject({
      189    field: ExtractedFieldName,
  ⎿  Updated services\api\src\services\dto.ts (+1 -0)
      142              output_tokens: extraction.output_tokens,
      143              duration_ms: extraction.duration_ms,
      144              chunk_count: extraction.chunk_count,
      145 +            created_at: extraction.created_at,                
      146            }
      147          : null,
      148      events: events.map(toEvent),
  ⎿  … 1 more file changed

● Bash(python - <<'PY'
      def rw(p,f):…)
  ⎿  apps/web/src/components/DocumentDetail.tsx 59ms
     apps/web/src/lib/detailModel.test.ts 10ms
     … +16 lines (ctrl+o to expand)
  ⎿  Updated apps\web\src\App.tsx (+3 -1)
      18          <DocumentsTable selectedId={selectedId} onSelect={selec
          t} />
      19        </main>
      20        {/* Keyed by id so "show more" and a retry error from one
           document don't carry over to the next. */}
      21 -      {selectedId !== null && <DocumentDetail key={selectedId} 
         -id={selectedId} onClose={close} />}                            
      21 +      {selectedId !== null && (                                
      22 +        <DocumentDetail key={selectedId} id={selectedId} onClos
         +e={close} onSelect={select} />                                 
      23 +      )}                                                       
      24      </div>
      25    );
      26  }
  ⎿  Updated apps\web\src\components\DocumentDetail.tsx (+43 -16)
       4    ExtractionRecord,
       5    ExtractionResult,
       6  } from "@nexus/shared";
       7 -import { useDocument, useRetry } from "../api/hooks.js";       
       8 -import {                                                       
       9 -  canRetry,                                                    
      10 -  groupRisks,                                                  
      11 -  processedAt,                                                 
      12 -  sortAlerts,                                                  
      13 -  splitWarnings,                                               
      14 -} from "../lib/detailModel.js";                                
       7 +import { useDocument, useDocuments, useRetry } from "../api/hoo
         +ks.js";                                                        
       8 +import { canRetry, groupRisks, sortAlerts, splitWarnings } from
         + "../lib/detailModel.js";                                      
       9  import {
      10    alertLabel,
      11    documentTypeLabel,
     ...
      19    plural,
      20    riskCategoryLabel,
      21  } from "../lib/format.js";
      22 +import { isPlainClick, selectionHref } from "../lib/selection.j
         +s";                                                            
      23  import { FieldRow, Quote, QuoteCheck } from "./FieldRow.js";
      24  import { StatusBadge } from "./StatusBadge.js";
      25  
      26  interface Props {
      27    id: string;
      28    onClose: () => void;
      29 +  onSelect: (id: string) => void;                              
      30  }
      31  
      32  type Conflict = ExtractionResult["conflicts"][number];
     ...
      48    return value === null ? null : format(value);
      49  }
      50  
      55 -function Meta({ doc, extraction }: { doc: DocumentDetailDto; ex
         -traction: ExtractionRecord }) {                                
      56 -  const processed = processedAt(doc.events);                   
      51 +function Meta({ extraction }: { extraction: ExtractionRecord })
         + {                                                             
      52    const tokens =
      53      extraction.input_tokens === 0 && extraction.output_tokens =
          == 0
      54        ? // Providers that report no usage store 0.
     ...
      59        {extraction.provider} / {extraction.model} / prompt {extr
          action.prompt_version}
     … 73 more lines (ctrl+o to expand)
  ⎿  Updated apps\web\src\components\DocumentsTable.tsx (+2 -7)
      1 -import { useMemo, useState, type MouseEvent } from "react";     
      1 +import { useMemo, useState } from "react";                      
      2  import type { DocumentSummary } from "@nexus/shared";
      3  import { exportCsvUrl } from "../api/client.js";
      4  import { useDocuments } from "../api/hooks.js";
     ...
      10    formatPercent,
      11    noticeTone,
      12  } from "../lib/format.js";
      13 -import { selectionHref } from "../lib/selection.js";           
      13 +import { isPlainClick, selectionHref } from "../lib/selection.j
         +s";                                                            
      14  import { countByStatus, sortDocuments, type SortKey } from "../
          lib/tableModel.js";
      15  import { StatusBadge } from "./StatusBadge.js";
      16  
     ...
      22    onSelect: (id: string) => void;
      23  }
      24  
      25 -// A modified click on the file link means "open in a new tab",
         - which the browser does on its own.                            
      26 -function isPlainClick(event: MouseEvent): boolean {            
      27 -  return event.button === 0 && !event.metaKey && !event.ctrlKey
         - && !event.shiftKey && !event.altKey;                          
      28 -}                                                              
      29 -                                                               
      25  function NoticeCell({ doc }: { doc: DocumentSummary }) {
      26    if (doc.notice_deadline === null) return <>{EMPTY}</>;
      27    const days = doc.days_until_notice_deadline;
  ⎿  Updated apps\web\src\lib\detailModel.test.ts (+1 -7)
       1  import { describe, expect, it } from "vitest";
       2  import type { Alert } from "@nexus/shared";
       3 -import {                                                       
       4 -  canRetry,                                                    
       5 -  groupRisks,                                                  
       6 -  sortAlerts,                                                  
       7 -  splitWarnings,                                               
       8 -  type RiskClause,                                             
       9 -} from "./detailModel.js";                                     
       3 +import { canRetry, groupRisks, sortAlerts, splitWarnings, type 
         +RiskClause } from "./detailModel.js";                          
       4  
       5  describe("splitWarnings", () => {
       6    it("separates review reasons from processing notes and strips
           the prefix", () => {
  ⎿  Updated apps\web\src\lib\selection.ts (+6 -1)
      1 -import { useCallback, useSyncExternalStore } from "react";      
      1 +import { useCallback, useSyncExternalStore, type MouseEvent } fr
        +om "react";                                                     
      2  
      3  const PARAM = "doc";
      4  // pushState fires no event of its own, so the setter announces 
         the change with this one.
     ...
      17    return query === "" ? "." : `?${query}`;
      18  }
      19  
      20 +// A modified click on a document link means "open in a new tab
         +", which the browser does on its own.                          
      21 +export function isPlainClick(event: MouseEvent): boolean {     
      22 +  return event.button === 0 && !event.metaKey && !event.ctrlKey
         + && !event.shiftKey && !event.altKey;                          
      23 +}                                                              
      24 +                                                               
      25  function subscribe(onChange: () => void): () => void {
      26    window.addEventListener("popstate", onChange);
      27    window.addEventListener(CHANGE_EVENT, onChange);

  Searched for 1 pattern (ctrl+o to expand)

● Changes 1 to 3 are in and green (496 tests). Pinning the new created_at in the
  api read test, then rewriting styles.css for step 46.

  Ran 1 shell command (ctrl+o to expand)

● Bash(python - <<'PY'
      p='services/api/src/routes/documents-read.test.ts'…)
  ⎿  7:  insertExtraction,
     13:} from "@nexus/shared/node";
  ⎿  Updated services\api\src\routes\documents-read.test.ts (+8 -3)
      45    });
      46  }
      47  
      48 -function complete(n: number, stored: unknown) {                
      48 +function complete(n: number, stored: unknown): string {        
      49    transitionStatus(db, id(n), "processing", { from: "queued" })
          ;
      50 -  insertExtraction(db, {                                       
      50 +  const extractionId = insertExtraction(db, {                  
      51      document_id: id(n),
      52      run: 1,
      53      provider: "mock",
     ...
      62      duration_ms: 30,
      63    });
      64    transitionStatus(db, id(n), "completed", { from: "processing"
           });
      65 +  return extractionId;                                         
      66  }
      67  
      68  async function setup(now = NOW) {
     ...
      173        message: "parsed",
      174        duration_ms: 12,
      175      });
      175 -    complete(1, result());                                    
      176 +    const extractionId = complete(1, result());               
      177      const { app } = await setup();
      178  
      179      const res = await app.inject({ method: "GET", url: `/api/d
           ocuments/${id(1)}` });
     ...
      198        events: [{ stage: "parsing", outcome: "ok", message: "pa
           rsed", duration_ms: 12 }],
      199      });
      200      expect(detail.extraction?.result.derived.days_until_notice
           _deadline).toBe(10);
      201 +    // The time the extraction row was written, not the docume
          +nt's updated_at.                                              
      202 +    const stored = getExtraction(db, extractionId);           
      203 +    expect(stored).toBeDefined();                             
      204 +    expect(detail.extraction?.created_at).toBe(stored?.created
          +_at);                                                         
      205    });
      206  
      207    it("recomputes the derived block from the facts, so a year l
           ater the term has rolled", async () => {

● Bash(sed -i 's/^  insertExtraction,$/  getExtraction,\n  insertExtraction,/'
      services/api/src/routes/documents-read.test.ts && sed -n 3,14p
      services/api/src/routes/d…)
  ⎿  import {
       createDocument,
       createLogger,
     … +9 lines (ctrl+o to expand)
  ⎿  Updated services\api\src\routes\documents-read.test.ts (+1 -0)
       4    createDocument,
       5    createLogger,
       6    insertEvent,
       7 +  getExtraction,                                               
       8    insertExtraction,
       9    loadConfig,
      10    migrate,

● Write(apps\web\src\styles.css)
  ⎿  Error writing file

  Read 1 file, ran 1 shell command (ctrl+o to expand)

● Write(apps\web\src\styles.css)
  ⎿  Added 262 lines, removed 73 lines
        1 +/* Colours are variables so dark mode is one block of override
          +s and no rule below names a colour itself. */                 
        2  :root {
        3 +  color-scheme: light dark;                                   
        4 +                                                              
        5 +  --bg: #ffffff;                                              
        6 +  --surface: #ffffff;                                         
        7 +  --subtle: #f6f7f9;                                          
        8    --text: #1c1f24;
        3 -  --muted: #6b7280;                                           
        9 +  --muted: #5f6672;                                           
       10 +  --quote: #374151;                                           
       11    --border: #d0d5dd;
       12 +  --border-soft: #eceef1;                                     
       13 +  --shadow: rgb(0 0 0 / 12%);                                 
       14 +                                                              
       15 +  --accent: #1d4ed8;                                          
       16 +  --accent-bg: #e6eeff;                                       
       17    --ok: #17703a;
       18 +  --ok-bg: #dff3e6;                                           
       19 +  --warn: #8a5200;                                            
       20 +  --warn-bg: #fdf0d5;                                         
       21    --error: #b42318;
        7 -  --warn: #9a5b00;                                            
        8 -  --accent: #1d4ed8;                                          
        9 -  font-family: system-ui, sans-serif;                         
       22 +  --error-bg: #fde4e1;                                        
       23 +  --grey: #4b5563;                                            
       24 +  --grey-bg: #eef0f3;                                         
       25 +                                                              
       26 +  --panel-width: 520px;                                       
       27 +  --page-pad-x: 24px;                                         
       28 +  --page-pad-y: 16px;                                         
       29 +  --gap: 24px;                                                
       30 +                                                              
       31 +  font-family:                                                
       32 +    system-ui,                                                
       33 +    -apple-system,                                            
       34 +    "Segoe UI",                                               
       35 +    Roboto,                                                   
       36 +    sans-serif;                                               
       37 +  font-size: 15px;                                            
       38 +  line-height: 1.45;                                          
       39    color: var(--text);
       40 +  background: var(--bg);                                      
       41  }
       42  
       43 +@media (prefers-color-scheme: dark) {                         
       44 +  :root {                                                     
       45 +    --bg: #14161a;                                            
       46 +    --surface: #1b1e24;                                       
       47 +    --subtle: #22262d;                                        
       48 +    --text: #e6e8eb;                                          
       49 +    --muted: #9aa3b0;                                         
       50 +    --quote: #c3c9d2;                                         
       51 +    --border: #3a404a;                                        
       52 +    --border-soft: #2a2f37;                                   
       53 +    --shadow: rgb(0 0 0 / 50%);                               
       54 +                                                              
       55 +    --accent: #8ab0ff;                                        
       56 +    --accent-bg: #1c2a4a;                                     
       57 +    --ok: #6fd093;                                            
       58 +    --ok-bg: #153524;                                         
       59 +    --warn: #f0b860;                                          
       60 +    --warn-bg: #3d2c0c;                                       
       61 +    --error: #ff8f85;                                         
       62 +    --error-bg: #43201c;                                      
       63 +    --grey: #c0c6cf;                                          
       64 +    --grey-bg: #2d323a;                                       
       65 +  }                                                           
       66 +}                                                             
       67 +                                                              
       68 +*,                                                            
       69 +*::before,                                                    
       70 +*::after {                                                    
       71 +  box-sizing: border-box;                                     
       72 +}                                                             
       73 +                                                              
       74  body {
       75    margin: 0;
       76  }
       77  
       78 +a {                                                           
       79 +  color: var(--accent);                                       
       80 +}                                                             
       81 +                                                              
       82 +/* Keyboard focus only: a mouse click does not leave a ring be
          +hind. */                                                      
       83 +:focus-visible {                                              
       84 +  outline: 2px solid var(--accent);                           
       85 +  outline-offset: 2px;                                        
       86 +  border-radius: 3px;                                         
       87 +}                                                             
       88 +                                                              
       89 +button {                                                      
       90 +  padding: 6px 14px;                                          
       91 +  border: 1px solid var(--border);                            
       92 +  border-radius: 6px;                                         
       93 +  background: var(--subtle);                                  
       94 +  color: var(--text);                                         
       95 +  font: inherit;                                              
       96 +  cursor: pointer;                                            
       97 +}                                                             
       98 +                                                              
       99 +button:hover:not(:disabled) {                                 
      100 +  border-color: var(--accent);                                
      101 +}                                                             
      102 +                                                              
      103 +button:disabled {                                             
      104 +  opacity: 0.6;                                               
      105 +  cursor: default;                                            
      106 +}                                                             
      107 +                                                              
      108 +/* Page */                                                    
      109 +                                                              
      110  .app {
      111    max-width: 1400px;
      112    margin: 0 auto;
       20 -  padding: 16px 24px;                                         
      113 +  padding: var(--page-pad-y) var(--page-pad-x);               
      114  }
      115  
      116  .app-header h1 {
     ...
      118    font-size: 20px;
      119  }
      120  
      121 +.workspace {                                                  
      122 +  margin-top: 24px;                                           
      123 +}                                                             
      124 +                                                              
      125 +.tone-ok {                                                    
      126 +  color: var(--ok);                                           
      127 +}                                                             
      128 +                                                              
      129 +.tone-muted {                                                 
      130 +  color: var(--muted);                                        
      131 +}                                                             
      132 +                                                              
      133 +.tone-warn {                                                  
      134 +  color: var(--warn);                                         
      135 +}                                                             
      136 +                                                              
      137 +.tone-error {                                                 
      138 +  color: var(--error);                                        
      139 +}                                                             
      140 +                                                              
      141 +/* Upload */                                                  
      142 +                                                              
      143  .dropzone {
      144    display: flex;
      145 +  flex-wrap: wrap;                                            
      146    align-items: center;
      147    justify-content: space-between;
      148    gap: 16px;
     ...
      158  
      159  .dropzone-active {
      160    border-color: var(--accent);
       45 -  background: #eff4ff;                                        
      161 +  background: var(--accent-bg);                               
      162  }
      163  
      164  .upload-status p {
     ...
      173  
      174  .upload-results li {
      175    padding: 2px 0;
      176 +  overflow-wrap: anywhere;                                    
      177  }
      178  
      179  .upload-name {
      180    font-weight: 600;
      181  }
      182  
       66 -.tone-ok {                                                    
       67 -  color: var(--ok);                                           
       68 -}                                                             
      183 +/* Table */                                                   
      184  
       70 -.tone-muted {                                                 
       71 -  color: var(--muted);                                        
       72 -}                                                             
       73 -                                                              
       74 -.tone-error {                                                 
       75 -  color: var(--error);                                        
       76 -}                                                             
       77 -                                                              
       78 -.workspace {                                                  
       79 -  margin-top: 24px;                                           
       80 -}                                                             
       81 -                                                              
       82 -.tone-warn {                                                  
       83 -  color: var(--warn);                                         
       84 -}                                                             
       85 -                                                              
      185  .documents-toolbar {
      186    display: flex;
      187 +  flex-wrap: wrap;                                            
      188    justify-content: space-between;
      189    align-items: baseline;
      190 +  gap: 8px;                                                   
      191    margin-bottom: 8px;
      192  }
      193  
     ...
      206  .documents-table th,
      207  .documents-table td {
      208    padding: 8px 10px;
      108 -  border-bottom: 1px solid var(--border);                     
      209 +  border-bottom: 1px solid var(--border-soft);                
      210    text-align: left;
      211 +  vertical-align: top;                                        
      212    white-space: nowrap;
      213  }
      214  
      113 -.documents-table th {                                         
      215 +/* File and Vendor are the only free text, so they are the col
          +umns that wrap when the panel takes room. */                  
      216 +.documents-table td:nth-child(1),                             
      217 +.documents-table td:nth-child(3) {                            
      218 +  white-space: normal;                                        
      219 +  overflow-wrap: anywhere;                                    
      220 +}                                                             
      221 +                                                              
      222 +/* Sticks to the page, which is the scroll container. The shad
          +ow stands in for the bottom border, which                     
      223 +   a collapsed table does not keep on a sticky cell. */       
      224 +.documents-table thead th {                                   
      225 +  position: sticky;                                           
      226 +  top: 0;                                                     
      227 +  z-index: 1;                                                 
      228 +  background: var(--bg);                                      
      229 +  box-shadow: inset 0 -1px 0 var(--border);                   
      230 +  border-bottom: 0;                                           
      231    font-weight: 600;
      232    color: var(--muted);
      233  }
     ...
      241    cursor: pointer;
      242  }
      243  
      127 -.documents-table tbody tr:hover {                             
      128 -  background: #f6f7f9;                                        
      244 +.documents-table tbody tr:hover,                              
      245 +.documents-table tbody tr:focus-within {                      
      246 +  background: var(--subtle);                                  
      247  }
      248  
      249  .documents-table tbody tr.row-selected {
      132 -  background: #eff4ff;                                        
      250 +  background: var(--accent-bg);                               
      251    box-shadow: inset 3px 0 0 var(--accent);
      252  }
      253  
      254 +.documents-table td a {                                       
      255 +  color: inherit;                                             
      256 +  font-weight: 600;                                           
      257 +  text-decoration: none;                                      
      258 +}                                                             
      259 +                                                              
      260 +.documents-table td a:hover {                                 
      261 +  text-decoration: underline;                                 
      262 +}                                                             
      263 +                                                              
      264  .sort-button {
      265    padding: 0;
      266    border: 0;
      267 +  border-radius: 0;                                           
      268    background: none;
      140 -  font: inherit;                                              
      269    color: inherit;
      142 -  cursor: pointer;                                            
      270 +  font-weight: inherit;                                       
      271    text-decoration: underline dotted;
      272  }
      273  
      274  .tag {
      275 +  display: inline-block;                                      
      276    margin-left: 8px;
      148 -  padding: 1px 6px;                                           
      277 +  padding: 0 6px;                                             
      278    border: 1px solid var(--border);
      279    border-radius: 4px;
      280    font-size: 12px;
      281 +  font-weight: 400;                                           
      282    color: var(--muted);
      283  }
      284  
     ...
      294  
      295  .badge-grey,
      296  .severity-low {
      167 -  background: #eef0f3;                                        
      168 -  color: #4b5563;                                             
      297 +  background: var(--grey-bg);                                 
      298 +  color: var(--grey);                                         
      299  }
      300  
      301  .badge-blue {
      172 -  background: #e0ebff;                                        
      302 +  background: var(--accent-bg);                               
      303    color: var(--accent);
      304  }
      305  
      306  .badge-green {
      177 -  background: #dff3e6;                                        
      307 +  background: var(--ok-bg);                                   
      308    color: var(--ok);
      309  }
      310  
      311  .badge-amber,
      312  .severity-medium {
      183 -  background: #fdf0d5;                                        
      313 +  background: var(--warn-bg);                                 
      314    color: var(--warn);
      315  }
      316  
      317  .badge-red,
      318  .severity-high {
      189 -  background: #fde4e1;                                        
      319 +  background: var(--error-bg);                                
      320    color: var(--error);
      321  }
      322  
     ...
      354    color: var(--muted);
      355  }
      356  
      357 +/* Detail panel. Default (900px to 1359px): fixed on the right
          +, over the table, because there is no room                    
      358 +   for both. The two media queries at the end of the file chan
          +ge that for wide and narrow screens. */                       
      359 +                                                              
      360  .detail-panel {
      361    position: fixed;
      362    top: 0;
      363    right: 0;
      364    bottom: 0;
      232 -  width: min(600px, 100%);                                    
      365 +  z-index: 2;                                                 
      366 +  width: var(--panel-width);                                  
      367    display: flex;
      368    flex-direction: column;
      235 -  background: #fff;                                           
      369 +  background: var(--surface);                                 
      370    border-left: 1px solid var(--border);
      237 -  box-shadow: -8px 0 24px rgb(0 0 0 / 10%);                   
      371 +  box-shadow: -8px 0 24px var(--shadow);                      
      372    font-size: 14px;
      373  }
      374  
      375  .detail-header {
      376    display: flex;
      243 -  align-items: center;                                        
      377 +  align-items: flex-start;                                    
      378    justify-content: space-between;
      379    gap: 12px;
      380    padding: 12px 16px;
     ...
      388  }
      389  
      390  .close-button {
      257 -  border: 0;                                                  
      391 +  padding: 2px 8px;                                           
      392 +  border-color: transparent;                                  
      393    background: none;
      259 -  font-size: 18px;                                            
      260 -  cursor: pointer;                                            
      394 +  font-size: 16px;                                            
      395  }
      396  
      397  .detail-body {
      398    flex: 1;
      399 +  min-height: 0;                                              
      400    overflow-y: auto;
      401    padding: 12px 16px 24px;
      402  }
     ...
      415    margin: 8px 0 0;
      416    color: var(--muted);
      417    font-size: 13px;
      418 +  overflow-wrap: anywhere;                                    
      419  }
      420  
      421  .detail-section {
     ...
      424  
      425  .detail-section h3 {
      426    margin: 0 0 8px;
      291 -  font-size: 14px;                                            
      427 +  font-size: 12px;                                            
      428    text-transform: uppercase;
      293 -  letter-spacing: 0.04em;                                     
      429 +  letter-spacing: 0.05em;                                     
      430    color: var(--muted);
      431  }
      432  
      433 +.detail-section p {                                           
      434 +  margin: 0;                                                  
      435 +}                                                             
      436 +                                                              
      437  .detail-section > summary {
      438    cursor: pointer;
      439    font-weight: 600;
     ...
      441  
      442  .detail-footer {
      443    display: flex;
      444 +  flex-wrap: wrap;                                            
      445    align-items: center;
      446    gap: 12px;
      447    padding: 12px 16px;
     ...
      464  }
      465  
      466  .box-warn {
      326 -  background: #fdf0d5;                                        
      327 -  color: #6b3f00;                                             
      467 +  background: var(--warn-bg);                                 
      468 +  color: var(--warn);                                         
      469  }
      470  
      471  .box-error {
      331 -  background: #fde4e1;                                        
      472 +  background: var(--error-bg);                                
      473    color: var(--error);
      474  }
      475  
     ...
      486    margin-bottom: 6px;
      487    padding: 8px 10px;
      488    border-left: 4px solid var(--border);
      348 -  background: #f6f7f9;                                        
      489 +  background: var(--subtle);                                  
      490  }
      491  
      492  .alert-critical {
      493    border-left-color: var(--error);
      353 -  background: #fde4e1;                                        
      494 +  background: var(--error-bg);                                
      495  }
      496  
      497  .alert-warning {
      498    border-left-color: var(--warn);
      358 -  background: #fdf0d5;                                        
      499 +  background: var(--warn-bg);                                 
      500  }
      501  
      502  .field-list {
     ...
      505  
      506  .field-row {
      507    display: grid;
      367 -  grid-template-columns: 130px 1fr;                           
      508 +  grid-template-columns: 120px minmax(0, 1fr);                
      509    gap: 8px;
      510    padding: 8px 0;
      370 -  border-bottom: 1px solid #eceef1;                           
      511 +  border-bottom: 1px solid var(--border-soft);                
      512  }
      513  
      514  .field-row dt {
     ...
      517  
      518  .field-row dd {
      519    margin: 0;
      379 -  min-width: 0;                                               
      520  }
      521  
      522  .field-value {
     ...
      542  }
      543  
      544  .confidence-high {
      405 -  background: #dff3e6;                                        
      545 +  background: var(--ok-bg);                                   
      546    color: var(--ok);
      547  }
      548  
      549  .confidence-medium {
      410 -  background: #fdf0d5;                                        
      550 +  background: var(--warn-bg);                                 
      551    color: var(--warn);
      552  }
      553  
      554  .confidence-low {
      415 -  background: #fde4e1;                                        
      555 +  background: var(--error-bg);                                
      556    color: var(--error);
      557  }
      558  
     ...
      560    margin: 6px 0 0;
      561    padding: 2px 0 2px 10px;
      562    border-left: 3px solid var(--border);
      423 -  color: #374151;                                             
      563 +  color: var(--quote);                                        
      564    font-style: italic;
      565    overflow-wrap: anywhere;
      566  }
     ...
      576  .link-button {
      577    padding: 0;
      578    border: 0;
      579 +  border-radius: 0;                                           
      580    background: none;
      440 -  font: inherit;                                              
      581    font-size: 12px;
      582    color: var(--accent);
      443 -  cursor: pointer;                                            
      583  }
      584  
      585  .risk-group h4 {
     ...
      589  
      590  .risk {
      591    padding: 8px 0;
      453 -  border-bottom: 1px solid #eceef1;                           
      592 +  border-bottom: 1px solid var(--border-soft);                
      593  }
      594  
      595  .risk p {
     ...
      607  .notes {
      608    margin: 8px 0 0;
      609    padding-left: 18px;
      471 -  font-family: ui-monospace, monospace;                       
      610 +  font-family: ui-monospace, "Cascadia Mono", Consolas, monosp
          +ace;                                                          
      611    font-size: 12px;
      612    overflow-wrap: anywhere;
      613  }
     ...
      621  
      622  .timeline li {
      623    display: grid;
      485 -  grid-template-columns: 130px 80px 1fr 70px;                 
      624 +  grid-template-columns: 124px 76px minmax(0, 1fr) 64px;      
      625    gap: 8px;
      626    padding: 4px 0 4px 8px;
      627    border-left: 3px solid var(--border);
      628  }
      629  
      491 -.timeline-ok {                                                
      492 -  border-left-color: var(--ok) !important;                    
      630 +.timeline li.timeline-ok {                                    
      631 +  border-left-color: var(--ok);                               
      632  }
      633  
      495 -.timeline-error {                                             
      496 -  border-left-color: var(--error) !important;                 
      634 +.timeline li.timeline-error {                                 
      635 +  border-left-color: var(--error);                            
      636  }
      637  
      499 -.timeline-retry {                                             
      500 -  border-left-color: var(--warn) !important;                  
      638 +.timeline li.timeline-retry {                                 
      639 +  border-left-color: var(--warn);                             
      640  }
      641  
      642  .timeline-when,
     ...
      662    padding: 10px;
      663    max-height: 400px;
      664    overflow: auto;
      526 -  background: #f6f7f9;                                        
      665 +  border-radius: 6px;                                         
      666 +  background: var(--subtle);                                  
      667 +  font-family: ui-monospace, "Cascadia Mono", Consolas, monosp
          +ace;                                                          
      668    font-size: 12px;
      669  }
      670 +                                                              
      671 +/* Wide: the panel is a second column, so the table shrinks in
          +stead of being covered and rows stay                          
      672 +   clickable for comparing. :has() keeps this in css: the page
          + only becomes a grid while a panel exists.                    
      673 +   1360px leaves the table about 770px, which is the least the
          + eight columns fit in. */                                     
      674 +@media (min-width: 1360px) {                                  
      675 +  .app:has(> .detail-panel) {                                 
      676 +    /* The 1400px cap is for the table column. The panel comes
          + on top of it. */                                             
      677 +    max-width: calc(1400px + var(--gap) + var(--panel-width));
      678 +    display: grid;                                            
      679 +    grid-template-columns: minmax(0, 1fr) var(--panel-width); 
      680 +    column-gap: var(--gap);                                   
      681 +    align-items: start;                                       
      682 +  }                                                           
      683 +                                                              
      684 +  .app:has(> .detail-panel) > * {                             
      685 +    grid-column: 1;                                           
      686 +  }                                                           
      687 +                                                              
      688 +  .app > .detail-panel {                                      
      689 +    grid-column: 2;                                           
      690 +    /* Header, upload and table are the three rows of the firs
          +t column. */                                                  
      691 +    grid-row: 1 / span 3;                                     
      692 +    position: sticky;                                         
      693 +    top: 0;                                                   
      694 +    height: 100vh;                                            
      695 +    /* Out to the top, right and bottom edges of the page, thr
          +ough the padding of .app. */                                  
      696 +    margin: calc(-1 * var(--page-pad-y)) calc(-1 * var(--page-
          +pad-x)) calc(-1 * var(--page-pad-y)) 0;                       
      697 +    box-shadow: none;                                         
      698 +  }                                                           
      699 +}                                                             
      700 +                                                              
      701 +/* Narrow: no room for a table next to or under a 520px panel,
          + so the panel is the whole screen. */                         
      702 +@media (max-width: 899px) {                                   
      703 +  .detail-panel {                                             
      704 +    left: 0;                                                  
      705 +    width: 100%;                                              
      706 +    border-left: 0;                                           
      707 +    box-shadow: none;                                         
      708 +  }                                                           
      709 +                                                              
      710 +  .field-row {                                                
      711 +    grid-template-columns: 100px minmax(0, 1fr);              
      712 +  }                                                           
      713 +                                                              
      714 +  .timeline li {                                              
      715 +    grid-template-columns: minmax(0, 1fr) auto;               
      716 +  }                                                           
      717 +}                                                             

  Ran 2 shell commands, wrote 1 memory (ctrl+o to expand)

● Changes 1 to 3 and the step 46 styles are in; typecheck, lint and tests pass
  (48 files, 496 tests). I have not looked at the new layout or dark mode in a
  browser.

  Bundle (gzipped): JS 111.22 kB, CSS 2.67 kB, so about 113.9 kB total. Raw
  sizes are 367.88 kB JS and 8.78 kB CSS.

  1. Processed time
  - The extractions table already had created_at, so no migration.
  - ExtractionRecord now carries created_at, toDetail fills it, and the panel
    reads it.
  - The event-based lookup is gone. documents-read.test.ts pins the value
    against the stored row.

  2. Duplicates
  - The header line is now "Result reused from <original name>", linking to
    ?doc=<duplicate_of>, with no model, tokens, duration or processed time.
  - The name comes from the cached list. If the original is not in it (the list
    is capped at 100), the link reads "an earlier upload".

  3. REVIEW_PREFIX
  - It lives in packages/shared/src/schemas/extraction.ts, and the worker and
    web both import it. The TODO(me) is removed.

  Step 46, styles.css only
  - Colours: all variables, with a prefers-color-scheme: dark block; system
    fonts.
  - Table: sticky header. File and Vendor wrap, the other columns don't.
  - Focus: a visible ring on keyboard focus, and the row highlights when its
    link has focus.
  - Panel, 1360px and up: beside the table at 520px, sticky, full height. The
    table shrinks and rows stay clickable.
  - Panel, 900 to 1359px: still fixed over the table. Beside it, the table would
    get under about 770px and the eight columns don't fit.
  - Panel, under 900px: full screen.

  Two things differ from what you asked:
  - The 1400px cap applies to the table column. With the panel open, the page
    can grow to 1400 + 24 + 520px, so on a 1920px screen the table keeps about
    1330px instead of dropping to about 810px. The content shifts left when the
    panel opens on screens wider than 1400px.
  - The middle range still overlays, as above. If you would rather have it
    beside the table from 900px with some columns hidden, that needs a decision
    on which columns go.

  The beside layout uses :has(), so it needs a current browser; older ones fall
  back to the overlay.

  I saved one note to memory: TODO(me) is only for your own opinion, and my
  suggestions go in chat.

  Next: open a document at full width, then narrow the window past 1360px and
  900px, and switch the OS to dark mode once.
✻ Baked for 5m 39s · done 4:19 AM

❯ live check found two dev setup bugs and two small ui things.                  
                                                                                
  1. the services don't seem to read .env under npm run dev. .env says          
  LLM_PROVIDER=mock, but the worker ran ollama / qwen2.5:7b-instruct, which are 
  the config defaults. check how config gets its env first and confirm. fix:    
  add --env-file-if-exists=.env to the node commands in the dev scripts (node   
  24 has it, existing env vars still win). the services themselves must not     
  load files, in docker compose passes the env.                                 
  2. node --watch restarted the worker on a change in                           
  node_modules/unpdf/dist/pdfjs.mjs, mid job, which leaves the row processing   
  until the lock runs out (that's how fake-markers got WORKER_STOPPED earlier). 
  use --watch-path so api and worker only restart on their own dist and         
  packages/shared/dist, never node_modules.                                     
  3. money: no ".00" for whole amounts (US$540,000 not US$540,000.00), keep     
  decimals when there are cents.                                                
  4. layout: big empty gaps above the drop zone and between the upload results  
  and the table. tighten the vertical spacing, the header + drop zone + results 
  + table should read as one compact page.                                      
                                                                                
  typecheck, lint, test. then tell me exactly how to confirm 1 and 2 by hand.   

  Ran 3 shell commands (ctrl+o to expand)

● Bash(python - <<'PY'
      def rw(p,f):…)
  ⎿  22:    "dev": "concurrently -n tsc,api,worker,web \"tsc -b --watch --p
     reserveWatchOutput\" \"node --env-file-if-exists=.env --watch-path=ser
     vices/api/dist --watch-path=packages/shared/dist services/api/dist/ind
     … +3 lines (ctrl+o to expand)
  ⎿  Updated apps\web\src\lib\format.test.ts (+7 -1)
      16  
      17  describe("formatMoney", () => {
      18    it("formats with the currency symbol and en-GB grouping", () 
          => {
      19 -    expect(formatMoney({ amount: 120000, currency: "GBP" })).to
         -Be("£120,000.00");                                             
      19      expect(formatMoney({ amount: 1234.5, currency: "USD" })).to
          Be("US$1,234.50");
      20 +    expect(formatMoney({ amount: 99.99, currency: "GBP" })).toB
         +e("£99.99");                                                   
      21 +  });                                                          
      22 +                                                               
      23 +  it("drops the decimals of a whole amount", () => {           
      24 +    expect(formatMoney({ amount: 540000, currency: "USD" })).to
         +Be("US$540,000");                                              
      25 +    expect(formatMoney({ amount: 120000, currency: "GBP" })).to
         +Be("£120,000");                                                
      26 +    expect(formatMoney({ amount: 0, currency: "EUR" })).toBe("€
         +0");                                                           
      27    });
      28  
      29    it("falls back to amount and code when Intl rejects the curre
          ncy", () => {
  ⎿  Updated apps\web\src\lib\format.ts (+7 -3)
      13  
      14  export function formatMoney(money: { amount: number; currency: 
          string }): string {
      15    try {
      16 -    return new Intl.NumberFormat("en-GB", { style: "currency", 
         -currency: money.currency }).format(                            
      17 -      money.amount,                                            
      18 -    );                                                         
      16 +    // A whole amount gets no ".00". With cents the currency's 
         +own number of decimals applies.                                
      17 +    const whole = Number.isInteger(money.amount) ? { maximumFra
         +ctionDigits: 0 } : {};                                         
      18 +    return new Intl.NumberFormat("en-GB", {                    
      19 +      style: "currency",                                       
      20 +      currency: money.currency,                                
      21 +      ...whole,                                                
      22 +    }).format(money.amount);                                   
      23    } catch {
      24      // Intl throws on a currency code it cannot parse. The amou
          nt is still worth showing.
      25      return `${money.amount} ${money.currency}`;
  ⎿  Updated apps\web\src\styles.css (+13 -10)
      25  
      26    --panel-width: 520px;
      27    --page-pad-x: 24px;
      28 -  --page-pad-y: 16px;                                          
      28 +  --page-pad-y: 12px;                                          
      29    --gap: 24px;
      30  
      31    font-family:
     ...
      114  }
      115  
      116  .app-header h1 {
      117 -  margin: 0 0 16px;                                           
      118 -  font-size: 20px;                                            
      117 +  margin: 0 0 10px;                                           
      118 +  font-size: 18px;                                            
      119  }
      120  
      121  .workspace {
      122 -  margin-top: 24px;                                           
      122 +  margin-top: 14px;                                           
      123  }
      124  
      125  .tone-ok {
     ...
      145    flex-wrap: wrap;
      146    align-items: center;
      147    justify-content: space-between;
      148 -  gap: 16px;                                                  
      149 -  padding: 16px;                                              
      148 +  gap: 12px;                                                  
      149 +  padding: 10px 14px;                                         
      150    border: 2px dashed var(--border);
      151    border-radius: 6px;
      152  }
     ...
      162  }
      163  
      164  .upload-status p {
      165 -  margin: 8px 0 0;                                            
      165 +  margin: 6px 0 0;                                            
      166  }
      167  
     … 30 more lines (ctrl+o to expand)
  ⎿  Updated package.json (+1 -1)
      19      "format:check": "prettier --check .",
      20      "test": "vitest run",
      21      "predev": "tsc -b",
      22 -    "dev": "concurrently -n tsc,api,worker,web \"tsc -b --watch
         - --preserveWatchOutput\" \"node --watch services/api/dist/index
         -.js\" \"node --watch services/worker/dist/index.js\" \"npm run 
         -dev -w @nexus/web\"",                                          
      22 +    "dev": "concurrently -n tsc,api,worker,web \"tsc -b --watch
         + --preserveWatchOutput\" \"node --env-file-if-exists=.env --wat
         +ch-path=services/api/dist --watch-path=packages/shared/dist ser
         +vices/api/dist/index.js\" \"node --env-file-if-exists=.env --wa
         +tch-path=services/worker/dist --watch-path=packages/shared/dist
         + services/worker/dist/index.js\" \"npm run dev -w @nexus/web\""
         +,                                                              
      23      "test-files": "tsx scripts/make-test-files.ts",
      24      "prellm-smoke": "tsc -b",
      25      "llm-smoke": "tsx scripts/llm-smoke.ts"

  Ran 1 shell command (ctrl+o to expand)

● All four changes are in and green (497 tests). Taking one headless screenshot
  of the built page with the panel open, to check the gap fix instead of
  guessing.

  Read 2 files, ran 1 shell command (ctrl+o to expand)

● Bash(cd /e/contract-analysis-pipeline && python - <<'PY'
      p='apps/web/src/styles.css'…)
  ⎿  All matched files use Prettier code style!
     dist/assets/index-CIFPiY1W.js   367.95 kB │ gzip: 111.26 kB
     … +9 lines (ctrl+o to expand)
  ⎿  Updated apps\web\src\styles.css (+8 -0)
      122    margin-top: 14px;
      123  }
      124  
      125 +/* The loading and error lines. A grid item's margins don't co
          +llapse, so their default margin would add                     
      126 +   to the one above when the panel is open. */                
      127 +.workspace > p {                                              
      128 +  margin: 0;                                                  
      129 +}                                                             
      130 +                                                              
      131  .tone-ok {
      132    color: var(--ok);
      133  }
     ...
      700      grid-row: 1 / span 3;
      701      position: sticky;
      702      top: 0;
      703 +    /* auto, so the negative right margin below widens it to t
          +he page edge instead of leaving a strip. */                   
      704 +    width: auto;                                              
      705      height: 100vh;
      706      /* Out to the top, right and bottom edges of the page, thr
           ough the padding of .app. */
      707      margin: calc(-1 * var(--page-pad-y)) calc(-1 * var(--page-
           pad-x)) calc(-1 * var(--page-pad-y)) 0;

  Read 1 file, ran 1 shell command (ctrl+o to expand)

● All four are in; typecheck, lint and tests pass (48 files, 497 tests). After
  that run I made one more CSS-only tweak and rebuilt the web app, which
  succeeded.

  1. .env under npm run dev: confirmed, fixed
  - loadConfig() only reads process.env, and nothing loaded .env. Without the
    flag it resolves to ollama qwen2.5:7b-instruct; with
    --env-file-if-exists=.env it resolves to mock.
  - Both node commands in the dev script now have the flag. The services still
    load no files.
  - A variable already set in the shell wins over .env, and a missing file only
    prints a notice. I checked both.

  2. Watch restarts: fixed
  - The api restarts only on services/api/dist and packages/shared/dist; the
    worker only on services/worker/dist and packages/shared/dist.
  - In a scratch folder with the same shape, a change under node_modules caused
    no restart, and changes in the two watched folders each caused one.
  - The Node docs say --watch-path is only supported on macOS and Windows. That
    is fine for your machine and docker doesn't use this script, but npm run dev
    may fail on Linux.

  3. Money: whole amounts drop the decimals (US$540,000), amounts with cents
  keep them (US$1,234.50). Test updated.

  4. Spacing
  - The big gaps came from the beside layout: the full-height panel spans three
    grid rows, and the grid shared that height across the header and upload
    rows. The last row is now flexible and absorbs it.
  - I also tightened the padding and margins around the header, drop zone,
    results and toolbar.
  - Headless screenshots at 1500px confirmed the gaps are gone with the panel
    open. They also showed a 24px strip to the right of the panel, which I
    fixed.
  - The screenshots had no api behind them, so they show the layout without
    table rows.

  Confirm 1 by hand
  1. Stop npm run dev and start it again; the script change only applies to a
     fresh start.
  2. Upload any PDF and open it in the panel.
  3. The header line should start with mock / instead of ollama / 
     qwen2.5:7b-instruct, and it should finish in seconds, not about a minute.
  4. For the override: stop, run $env:LLM_PROVIDER='ollama'; npm run dev, upload
     a different PDF (an identical one comes back as a duplicate), and the line
     should say ollama again. Then Remove-Item Env:LLM_PROVIDER.

  Confirm 2 by hand
  1. With npm run dev running, append a blank line to
     node_modules/unpdf/dist/pdfjs.mjs and save.
  2. Neither the [api] nor the [worker] output should print "Restarting". Undo
     the edit.
  3. Add a comment to any file in services/worker/src and save. After [tsc]
     rebuilds, only [worker] should print "Restarting
     'services/worker/dist/index.js'".
  4. Do the same in packages/shared/src: both [api] and [worker] should restart.

  I did not test whether editing .env while dev is running restarts the
  services; assume you need to restart npm run dev.

✻ Cooked for 4m 4s · done 5:41 AM

❯ the watch fix causes a restart loop. with a fresh data folder, npm run dev    
  prints over and over:                                                         
                                                                                
  [api] Change detected in 'E:\contract-analysis-pipeline\data\app.db-shm'      
  [api] Restarting 'services/api/dist/index.js'                                 
  [worker] Change detected in 'E:\contract-analysis-pipeline\data\app.db-shm'   
  [worker] Restarting 'services/worker/dist/index.js'                           
                                                                                
  opening the db changes app.db-shm, which restarts both, which opens the db    
  again. so the watcher is watching data/ even though it should only watch the  
  dist folders.                                                                 
                                                                                
  find out why (wrong path in --watch-path, the env file flag pulling in the    
  cwd, or --watch-path not behaving like the docs say on windows) and fix it.   
  this time verify for real: delete data, run npm run dev yourself for at least 
  60 seconds with redis up and LLM_PROVIDER=mock, and confirm:                  
  - api and worker each start once and stay up, no "Restarting" lines           
  - worker started says provider mock                                           
  - touching a file in services/worker/src restarts only the worker after tsc   
  rebuilds                                                                      
                                                                                
  if --watch-path can't be made to work reliably, tell me the options before    
  swapping in any new package. stop npm run dev when you're done and show me    
  the exact dev script line.                                                    

  Ran 7 shell commands (ctrl+o to expand)

● All three checks passed in a real run; stopping npm run dev and confirming
  nothing is left running.

  Ran 2 shell commands (ctrl+o to expand)

● Background command "Delete the data folder and start npm run dev, logging to
the scratchpad" failed with exit code 1

  Ran 1 shell command, wrote 1 memory (ctrl+o to expand)

● The restart loop is fixed and verified in a real npm run dev run. No new
  package was needed, and npm run dev is stopped (ports 3000 and 5173 are free).

  The dev script line now:
  "dev": "node --env-file-if-exists=.env 
  node_modules/concurrently/dist/bin/index.js -n tsc,api,worker,web \"tsc -b 
  --watch --preserveWatchOutput\" \"node --watch-path=services/api/dist 
  --watch-path=packages/shared/dist services/api/dist/index.js\" \"node 
  --watch-path=services/worker/dist --watch-path=packages/shared/dist 
  services/worker/dist/index.js\" \"npm run dev -w @nexus/web\"",

  Cause: it was the env file flag combined with --watch-path, not a wrong path.
  In a scratch folder, --watch-path alone ignored a write to data/app.db-shm;
  adding --env-file-if-exists=.env to the same command made that write restart
  the process. Putting the flag on a watching command makes node react to
  changes anywhere under the folder that holds .env, which here is the repo
  root.

  Fix: .env is loaded once by the node process that starts concurrently, and the
  api and worker inherit the variables. Their own commands only carry
  --watch-path. The services still load no files, and shell variables still win
  over .env.

  What I ran: deleted data/, started npm run dev with redis up and
  LLM_PROVIDER=mock from .env, and left it for 70 seconds.
  - Starts: api and worker each started once; zero "Restarting" and zero "Change
    detected" lines.
  - Provider: the worker logged "provider":"mock","model":"mock","msg":"worker 
    started".
  - Database writes: I uploaded samples/SamplePDFs/contract-2-pages.pdf; it
    reached completed with still zero restarts.
  - Worker source edit: I appended a comment to services/worker/src/index.ts.
    After tsc rebuilt, only the worker restarted; the api did not.
  - Revert: removing the comment restarted the worker once more. The file is
    unchanged in git status.
  - Totals: api 0 restarts, worker 2, both from my edits.

  Typecheck, lint and tests pass afterwards (48 files, 497 tests).

  Things to know:
  - The script calls concurrently by its file path
    (node_modules/concurrently/dist/bin/index.js), because node --env-file ... 
    --run <script> does not pass the variables on. A concurrently major upgrade
    could move that file.
  - tsc and vite now also get the .env variables.
  - data/ now holds a fresh database with the one sample document from my run.
  - I saved a memory note about this flag combination, since package.json can't
    hold a comment.

  Next: run npm run dev yourself and check that the first [worker] line says
  "provider":"mock".

✻ Churned for 4m 24s · done 6:05 AM