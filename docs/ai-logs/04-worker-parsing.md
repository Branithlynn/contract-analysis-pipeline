 ▐▛███▛█   Claude Code v2.1.296
▝▜██████▀  Opus 5.5 · Claude Team
 ▝▝   ▝▝   E:\contract-analysis-pipeline

  ⎿  SessionStart:clear says: <persisted-output>
     Output too large (10.9KB). Full output saved to: C:\Users\boris\.claude\pro
     jects\E--contract-analysis-pipeline\a20831a7-ef18-45d2-b217-29d5a8a9bbd3\to
     ol-results\hook-592d8f64-24fc-40c7-b162-e35b27b1c9ae-4-systemMessage.txt

     Preview (first 2KB):
     [contract-analysis-pipeline] recent context, 2026-10-10 6:25am GMT+3
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
       Loading: 50 observations (20,965 tokens to read)
       Work investment: 258,020 tokens spent on research, building, and 
     decisions
       Your savings: 92% reduction from reuse

     Oct 10, 2026

     #S946 Read project requirements and existing codebase structure; establish
     working methodology and constraints before beginning implementation (Oct 
     10, 4:49 AM)

     #S947 Implement Step 1 of API service: job queue producer for document
     extraction using BullMQ (Oct 10, 4:54 AM)

     #S948 Implement error handler (errors.ts), health checks (health.ts), and
     server factory (server.ts) with error mapping, multipart limit handling, 
     fail-fast redis behavior, and comprehensive test coverage (Oct 10, 4:57 AM)

     #S949 Implement POST /api/documents multipart upload endpoint with per-file
     rejection, SHA256 deduplication, MIME type validation, and fail-fast Redis
     error handling (Oct 10, 5:07 AM)

     ...
     </persisted-output>

❯ /clear                                                                        

❯ read CLAUDE.md and docs/TASK.md first. no code yet.                           
                                                                                
  quick context: take-home, contract upload -> async processing -> llm          
  extraction -> dashboard. backend has to be TS. I've got the architecture      
  worked out so I'll feed it to you step by step. only do what I ask in each    
  step, and if some library doesn't behave like I say, stop and tell me, don't  
  hack around it                                                                

  Read 1 file (ctrl+o to expand)

● Ready for step 1. I've read both files and haven't written anything.

  What I'm working from:
  - Task: a web UI to upload PDF/DOCX contracts, async processing, LLM
    extraction of value, renewal dates and risk clauses, and a dashboard.
    Deliverables are the README in your voice, Docker Compose setup, and the
    committed conversation log.
  - Rules from CLAUDE.md:
    - One step at a time, nothing extra.
    - Stop and report if a library doesn't behave the way you said.
    - Approved packages only.
    - Run typecheck && lint && test after every change.
    - No git writes.

  What's already in the repo:
  - Commit 208b6d0: packages/shared (status model, schemas, config, sqlite
    repos).
  - Commit 09f0345: services/api (uploads, read endpoints, retry, reconciler,
    CSV export).
  - Not started: services/worker and apps/web. From my session notes, the worker
    is the next step.

  The working tree is clean.

✻ Crunched for 11s · done 6:26 AM

❯ worker. deps bullmq ^6.3, ioredis ^6.0, unpdf ^1.8, mammoth ^1.13, zod ^4.6,  
  pino ^10, @nexus/shared.                                                      
                                                                                
  pipeline/errors.ts first:                                                     
  PermanentError(code, message, opts?) and TransientError(code, message, opts?) 
  classifyError(err): already classified -> return it.                          
  ECONNREFUSED/ECONNRESET/ETIMEDOUT/EAI_AGAIN and AbortError/TimeoutError ->    
  transient LLM_UNAVAILABLE. anything else -> transient INTERNAL                
                                                                                
  a broken pdf is broken every time, no point retrying it, so permanent ->      
  UnrecoverableError. unknown stuff gets retried until attempts run out.        
                                                                                
  also: bullmq is the ONLY thing that retries. if the sdk retried 2x and bullmq 
  3x, one bad minute at the provider = 9 calls.                                 
                                                                                
  deps.ts: WorkerDeps { db, config, logger, provider: LlmProvider | null (null  
  until we add llm), clock: () => Date }. clock injected so date stuff is       
  testable                                                                      

  Listed 1 directory, ran 3 shell commands (ctrl+o to expand)

● Installing deps into the worker.

● Bash(npm install -w @nexus/worker bullmq@^6.3.12 ioredis@^6.0.0 unpdf@^1.8.1
      mammoth@^1.13.0 zod@^4.6.5 pino@^10.4.0 @nexus/shared@^0.0.0 2>&1 | tail
      -5 && cat servi…)
  ⎿  npm warn allow-scripts 2 packages have install scripts not yet covered
      by allowScripts:
     npm warn allow-scripts   better-sqlite3@13.0.3 (install: node-gyp rebu
     … +22 lines (ctrl+o to expand)
  ⎿  Updated package-lock.json (+239 -1)
      1316          "url": "https://opencollective.com/vitest"
      1317        }
      1318      },
      1319 +    "node_modules/@xmldom/xmldom": {                         
      1320 +      "version": "0.8.15",                                   
      1321 +      "resolved": "https://registry.npmjs.org/@xmldom/xmldom/
           +-/xmldom-0.8.15.tgz",                                        
      1322 +      "integrity": "sha512-/5NV/vDALVFDXgLmfsy9TRCBlKwO2LNBFz
           +pzvb9iIj+jR+eSc6DLYYvVOdivT/jm7MtU6TebYuRmzEOI7w40UA==",     
      1323 +      "license": "MIT",                                      
      1324 +      "engines": {                                           
      1325 +        "node": ">=10.0.0"                                   
      1326 +      }                                                      
      1327 +    },                                                       
      1328      "node_modules/abstract-logging": {
      1329        "version": "2.0.1",
      1330        "resolved": "https://registry.npmjs.org/abstract-loggin
            g/-/abstract-logging-2.0.1.tgz",
     ...
      1452          "url": "https://github.com/chalk/ansi-styles?sponsor=
            1"
      1453        }
      1454      },
      1455 +    "node_modules/argparse": {                               
      1456 +      "version": "1.0.10",                                   
      1457 +      "resolved": "https://registry.npmjs.org/argparse/-/argp
           +arse-1.0.10.tgz",                                            
      1458 +      "integrity": "sha512-o5Roy6tNG4SL/FOkCAN6RzjiakZS25RLYF
           +rcMttJqbdd8BWrnA+fGz57iN5Pb06pvBGvl5gQ0B48dJlslXvoTg==",     
      1459 +      "license": "MIT",                                      
      1460 +      "dependencies": {                                      
      1461 +        "sprintf-js": "~1.0.2"                               
      1462 +      }                                                      
      1463 +    },                                                       
      1464      "node_modules/assertion-error": {
      1465        "version": "2.0.1",
      1466        "resolved": "https://registry.npmjs.org/assertion-error
            /-/assertion-error-2.0.1.tgz",
     ...
      1510          "node": "18 || 20 || >=22"
      1511        }
      1512      },
      1513 +    "node_modules/base64-js": {                              
      1514 +      "version": "1.5.1",                                    
      1515 +      "resolved": "https://registry.npmjs.org/base64-js/-/bas
           +e64-js-1.5.1.tgz",                                           
      1516 +      "integrity": "sha512-AKpaYlHn8t4SVbOHCy+b5+KKgvR4vrsD8v
           +bvrbiQJps7fKDTkjkDry6ji0rUJjC0kzbNePLwzxq8iypo41qeWA==",     
      1517 +      "funding": [                                           
      1518 +        {                                                    
      1519 +          "type": "github",                                  
     … 350 more lines (ctrl+o to expand)
  ⎿  Updated services\worker\package.json (+10 -1)
       2    "name": "@nexus/worker",
       3    "version": "0.0.0",
       4    "private": true,
       5 -  "type": "module"                                             
       5 +  "type": "module",                                            
       6 +  "dependencies": {                                            
       7 +    "@nexus/shared": "^0.0.0",                                 
       8 +    "bullmq": "^6.3.12",                                       
       9 +    "ioredis": "^6.0.0",                                       
      10 +    "mammoth": "^1.13.0",                                      
      11 +    "pino": "^10.4.0",                                         
      12 +    "unpdf": "^1.8.1",                                         
      13 +    "zod": "^4.6.5"                                            
      14 +  }                                                            
      15  }

● Write(services\worker\src\pipeline\errors.test.ts)
  ⎿  Wrote 85 lines to services\worker\src\pipeline\errors.test.ts
       1 import { describe, expect, it } from "vitest";
       2 import { ErrorCode } from "@nexus/shared";
       3 import { PermanentError, TransientError, classifyError } from ".
         /errors.js";
       4 
       6   return Object.assign(new Error(`connect ${code}`), { code });
       7 }
       8 
       9 describe("PermanentError / TransientError", () => {
      10   it("carry code, message, name and cause", () => {
     … +90 lines (ctrl+o to expand)

  Ran 1 shell command (ctrl+o to expand)

● Fails as expected (no module). Now the implementation.

● Write(services\worker\src\pipeline\errors.ts)
  ⎿  Wrote 56 lines to services\worker\src\pipeline\errors.ts
       1 import { ErrorCode } from "@nexus/shared";
       2 
       3 // Fails the same way on every attempt (broken pdf, no text laye
         r), so the job runner turns it into
       4 // bullmq's UnrecoverableError and skips the remaining attempts.
       6   constructor(
       7     readonly code: ErrorCode,
       8     message: string,
       9     opts?: ErrorOptions,
      10   ) {
     … +59 lines (ctrl+o to expand)

● Bash(npx prettier --write services/worker/src >/dev/null && npm run typecheck
      2>&1 | tail -5 && npm run lint 2>&1 | tail -5 && npm test 2>&1 | tail -8)
  ⎿  > @nexus/web@0.0.0 typecheck
     > tsc --noEmit
     … +11 lines (ctrl+o to expand)
  ⎿  Updated services\worker\src\pipeline\errors.test.ts (+5 -1)
      13      const transient = new TransientError(ErrorCode.LLM_UNAVAILA
          BLE, "ollama down");
      14  
      15      expect(permanent).toBeInstanceOf(Error);
      16 -    expect(permanent).toMatchObject({ name: "PermanentError", c
         -ode: "PARSE_ERROR", message: "bad pdf" });                     
      16 +    expect(permanent).toMatchObject({                          
      17 +      name: "PermanentError",                                  
      18 +      code: "PARSE_ERROR",                                     
      19 +      message: "bad pdf",                                      
      20 +    });                                                        
      21      expect(permanent.cause).toBe(cause);
      22      expect(transient).toMatchObject({ name: "TransientError", c
          ode: "LLM_UNAVAILABLE" });
      23      expect(transient.cause).toBeUndefined();
  ⎿  (timeout 5m)

● pipeline/errors.ts is done and the checks pass, but I held off on deps.ts
  because of a name clash.

  Name clash: @nexus/shared already exports LlmProvider at
  packages/shared/src/config.ts:3. It's the zod enum for the config value
  ("ollama" | "anthropic" | "openai" | "mock"), not a provider interface. If I
  write provider: LlmProvider | null in deps.ts, it compiles, but it types the
  field as a string name, not an object that calls the model. There's no
  provider interface anywhere yet.

  Done:
  1. Worker deps installed (services/worker/package.json): bullmq ^6.3.12,
     ioredis ^6.0.0, unpdf ^1.8.1, mammoth ^1.13.0, zod ^4.6.5, pino ^10.4.0,
     @nexus/shared. All those versions exist on npm. I checked that
     UnrecoverableError is exported by bullmq 6.3.12.
  2. services/worker/src/pipeline/errors.ts: PermanentError, TransientError and
     classifyError, with your rules (already classified → returned as is,
     network codes and Abort/Timeout → transient LLM_UNAVAILABLE, anything else
     → transient INTERNAL). The comments explain why bullmq is the only thing
     that retries.
  3. Tests are in errors.test.ts, 13 of them.

  Two choices of mine to review:
  - classifyError also checks err.cause, not just the top-level error. Node's
    fetch reports a refused connection as TypeError("fetch failed") with
    ECONNREFUSED on .cause. Without that check, "Ollama is down" would come out
    as INTERNAL. It also stops if a cause chain loops back on itself.
  - I didn't add the step that turns a PermanentError into an
    UnrecoverableError. That belongs where the job runs, which comes later.

  Checks: typecheck clean, lint clean, tests 130/130 passing across 16 files.
  npm printed allow-scripts warnings for better-sqlite3 and msgpackr-extract,
  the native modules that need a build step. I left those alone and didn't run
  any approve-scripts command.

  Your call on the name. Options:
  - A (my pick): rename the shared enum to LlmProviderName, which means editing
    its uses in config. Then LlmProvider is free for the interface when we add
    the LLM.
  - B: keep the enum and name the interface something else, e.g. LlmClient.

  Once you pick, deps.ts is about 5 minutes.

✻ Baked for 1m 54s · done 6:28 AM

❯ A. rename the shared enum to LlmProviderName. the worker reuses it later      
  instead of defining its own ProviderName list.                                
                                                                                
  for deps.ts create services/worker/src/llm/types.ts now with just the         
  interface part, the rest of the llm layer comes later:                        
  LlmRequest { system, messages: { role: user|assistant, content }[], schema,   
  schemaName, timeoutMs, maxOutputTokens }                                      
  LlmResponse { json: unknown, rawText, usage { inputTokens, outputTokens },    
  model, latencyMs }                                                            
  LlmProvider { name: LlmProviderName, model, complete(req) }                   
  then deps.ts with provider: LlmProvider | null.                               
                                                                                
  cause chain check is a good call, keep it. unrecoverable conversion goes in   
  processJob next step, agreed                                                  

  Searched for 1 pattern (ctrl+o to expand)

● Bash(sed -i 's/\bLlmProvider\b/LlmProviderName/g'
      packages/shared/src/config.ts && sed -n 1,4p packages/shared/src/config.ts
      && sed -n 20p packages/shared/src/config…)
  ⎿  import { z } from "zod";

     export const LlmProviderName = z.enum(["ollama", "anthropic", "openai"
     … +3 lines (ctrl+o to expand)
  ⎿  Updated packages\shared\src\config.ts (+3 -3)
      1  import { z } from "zod";
      2  
      3 -export const LlmProvider = z.enum(["ollama", "anthropic", "opena
        -i", "mock"]);                                                   
      4 -export type LlmProvider = z.infer<typeof LlmProvider>;          
      3 +export const LlmProviderName = z.enum(["ollama", "anthropic", "o
        +penai", "mock"]);                                               
      4 +export type LlmProviderName = z.infer<typeof LlmProviderName>;  
      5  
      6  const PositiveInt = z.coerce.number().int().positive();
      7  
     ...
      17      REDIS_URL: z.url().default("redis://localhost:6379"),
      18      MAX_UPLOAD_MB: PositiveInt.default(20),
      19      MAX_FILES_PER_REQUEST: PositiveInt.default(10),
      20 -    LLM_PROVIDER: LlmProvider.default("ollama"),               
      20 +    LLM_PROVIDER: LlmProviderName.default("ollama"),           
      21      LLM_MODEL: z.string().default("qwen2.5:7b-instruct"),
      22      OLLAMA_URL: z.url().default("http://localhost:11434"),
      23      ANTHROPIC_API_KEY: z.string().optional(),

  Ran 1 shell command (ctrl+o to expand)

● Write(services\worker\src\llm\types.ts)
  ⎿  Wrote 36 lines to services\worker\src\llm\types.ts
       1 import type { LlmProviderName } from "@nexus/shared/node";
       2 
       3 export interface LlmMessage {
       4   role: "user" | "assistant";
       5   content: string;
       6 }
       7 
       8 export interface LlmRequest {
       9   system: string;
      10   messages: LlmMessage[];
     … +27 lines (ctrl+o to expand)

● Write(services\worker\src\deps.ts)
  ⎿  Wrote 12 lines to services\worker\src\deps.ts
       1 import type { Config, Db, Logger } from "@nexus/shared/node";
       2 import type { LlmProvider } from "./llm/types.js";
       3 
       4 export interface WorkerDeps {
       5   db: Db;
       6   config: Config;
       7   logger: Logger;
       8   // null until the llm layer exists.
       9   provider: LlmProvider | null;
      10   // Injected so date math and timestamps are testable.
     … +2 lines (ctrl+o to expand)

  Ran 1 shell command (ctrl+o to expand)

● The enum is renamed, and llm/types.ts and deps.ts are in. Typecheck and lint
  are clean, tests are 130/130 passing, and prettier is clean.

  1. Rename: in packages/shared/src/config.ts, LlmProvider is now
     LlmProviderName, for both the zod enum and its type, and LLM_PROVIDER uses
     it. Nothing else referenced the old name.
  2. services/worker/src/llm/types.ts: LlmMessage, LlmRequest, LlmUsage,
     LlmResponse and LlmProvider (name: LlmProviderName, model, complete(req): 
     Promise<LlmResponse>).
     - I typed schema as Record<string, unknown>, which is a plain JSON Schema
       as z.toJSONSchema produces it. Each provider passes it to its own
       structured-output API.
     - json: unknown, because the caller validates it with zod.
  3. services/worker/src/deps.ts: WorkerDeps { db, config, logger, provider: 
     LlmProvider | null, clock }, with the types coming from @nexus/shared/node.

  No new tests: these two files only define types, with no runtime code.

  Next is processJob with the PermanentError → UnrecoverableError conversion.

✻ Brewed for 1m 1s · done 6:31 AM
❯ pipeline/stage.ts: runStage(ctx { deps, documentId, run }, stage, fn) ->      
  setStage, time it with performance.now(), write a processing_events row       
  ok/error (message = code + message, cap 500 chars), log it, rethrow as is.    
                                                                                
  pipeline/run.ts processJob(job, deps):                                        
  1. parse job.data, invalid -> UnrecoverableError                              
  2. doc missing -> warn and return. doc.run != payload.run -> "stale job",     
  return                                                                        
  3. transition to processing from [queued, processing] with bumpAttempts.      
  false -> already done, return                                                 
  4. run the analysis through runStage                                          
  5. ok -> completed                                                            
  6. error -> classifyError:                                                    
     permanent -> mark failed, throw UnrecoverableError                         
     transient on the last attempt (attemptsMade + 1 >= opts.attempts) -> mark  
  failed, rethrow                                                               
     transient otherwise -> "retry" event with the next attempt number,         
  rethrow, leave it processing                                                  
                                                                                
  worker writes status itself instead of the api listening to queue events, it  
  knows the stage and the error code and the db stays the one source of truth.  
                                                                                
  for now after parsing just complete it with needs_review true + an info event 
  "extraction not implemented yet"                                              

  Read 1 file, ran 2 shell commands (ctrl+o to expand)

● The attemptsMade + 1 >= attempts formula holds in bullmq 6: attemptsMade only
  goes up after a failure, so it's 0 while the first attempt runs. Writing tests
  first.

  Searched for 1 pattern, read 1 file, ran 1 shell command (ctrl+o to expand)

● Write(services\worker\src\test-support\fixtures.ts)
  ⎿  Wrote 49 lines to services\worker\src\test-support\fixtures.ts
      1 import {
      2   createDocument,
      3   createLogger,
      4   loadConfig,
      5   migrate,
      6   openMemoryDb,
      7   type CreateDocumentInput,
      8 } from "@nexus/shared/node";
      9 import type { WorkerDeps } from "../deps.js";
     … +42 lines (ctrl+o to expand)

● Bash(sed -i 's#"exclude": \["src/\*\*/\*.test.ts",
      "src/\*\*/\*.spec.ts"\]#"exclude": ["src/**/*.test.ts",
      "src/**/*.spec.ts", "src/test-support"]#' services/worker/…)
  ⎿    "exclude": ["src/**/*.test.ts", "src/**/*.spec.ts", "src/test-suppor
     t"],
  ⎿  Updated services\worker\tsconfig.json (+1 -1)
       5      "outDir": "dist"
       6    },
       7    "include": ["src"],
       8 -  "exclude": ["src/**/*.test.ts", "src/**/*.spec.ts"],         
       8 +  "exclude": ["src/**/*.test.ts", "src/**/*.spec.ts", "src/test
         +-support"],                                                    
       9    "references": [{ "path": "../../packages/shared" }]
      10  }

● Write(services\worker\src\pipeline\stage.test.ts)
  ⎿  Wrote 70 lines to services\worker\src\pipeline\stage.test.ts
       1 import { describe, expect, it } from "vitest";
       2 import { ErrorCode } from "@nexus/shared";
       3 import { getDocument, listEvents, transitionStatus } from "@nexu
       4 import { makeDeps, seedDocument } from "../test-support/fixtures
         .js";
       5 import { PermanentError } from "./errors.js";
       6 import { runStage } from "./stage.js";
       8 function setup() {
       9   const { deps, lines } = makeDeps();
      10   const documentId = seedDocument(deps);
     … +75 lines (ctrl+o to expand)

● Write(services\worker\src\pipeline\run.test.ts)
  ⎿  Wrote 141 lines to services\worker\src\pipeline\run.test.ts
       1 import { UnrecoverableError } from "bullmq";
       3 import { ErrorCode } from "@nexus/shared";
       4 import { getDocument, listEvents, transitionStatus } from "@nexu
         s/shared/node";
         ixtures.js";
       6 import { PermanentError, TransientError } from "./errors.js";
       8 
       9 function job(data: unknown, attemptsMade = 0, attempts = 3): Ext
         ractJob {
         ;
     … +155 lines (ctrl+o to expand)

● The insertEvent spy in that test won't work, because ESM namespaces can't be
  spied on. I'll move the placeholder analysis into analyze.ts and use vi.mock.

● Bash(python - <<'EOF'
      p='services/worker/src/pipeline/run.test.ts'…)
  ⎿  11:vi.mock("./analyze.js", async (importOriginal) => {
     13:  return { ...mod, analyze: vi.fn(mod.analyze) };
     85:  async function failWith(err: unknown, attemptsMade = 0, attempts?
     … +7 lines (ctrl+o to expand)
  ⎿  Updated services\worker\src\pipeline\run.test.ts (+140 -141)
        1 -import { UnrecoverableError } from "bullmq";                  
        2 -import { describe, expect, it, vi } from "vitest";            
        3 -import { ErrorCode } from "@nexus/shared";                    
        4 -import { getDocument, listEvents, transitionStatus } from "@ne
          -xus/shared/node";                                             
        5 -import { docId, makeDeps, seedDocument } from "../test-support
          -/fixtures.js";                                                
        6 -import { PermanentError, TransientError } from "./errors.js"; 
        7 -import { processJob, type ExtractJob } from "./run.js";       
        8 -                                                              
        9 -function job(data: unknown, attemptsMade = 0, attempts = 3): E
          -xtractJob {                                                   
       10 -  return { id: "job-1", data, attemptsMade, opts: { attempts }
          - };                                                           
       11 -}                                                             
       12 -                                                              
       13 -describe("processJob", () => {                                
       14 -  it("rejects an invalid payload as unrecoverable", async () =
          -> {                                                           
       15 -    const { deps } = makeDeps();                              
       16 -                                                              
       17 -    await expect(processJob(job({ documentId: "nope", run: 0 }
          -), deps)).rejects.toBeInstanceOf(                             
       18 -      UnrecoverableError,                                     
       19 -    );                                                        
       20 -  });                                                         
       21 -                                                              
       22 -  it("drops a job whose document does not exist", async () => 
          -{                                                             
       23 -    const { deps, lines } = makeDeps();                       
       24 -                                                              
       25 -    await processJob(job({ documentId: docId(9), run: 1 }), de
          -ps);                                                          
       26 -                                                              
       27 -    expect(lines.at(-1)).toMatchObject({ level: 40, documentId
          -: docId(9) });                                                
       28 -  });                                                         
       29 -                                                              
       30 -  it("drops a stale job without touching the document", async 
          -() => {                                                       
       31 -    const { deps } = makeDeps();                              
       32 -    const id = seedDocument(deps);                            
       33 -                                                              
       34 -    await processJob(job({ documentId: id, run: 2 }), deps);  
       35 -                                                              
       36 -    expect(getDocument(deps.db, id)).toMatchObject({ status: "
          -queued", attempts: 0 });                                      
       37 -    expect(listEvents(deps.db, id)).toEqual([]);              
       38 -  });                                                         
       39 -                                                              
       40 -  it("drops a job for a document that is already finished", as
          -ync () => {                                                   
     … 241 more lines (ctrl+o to expand)

● Now the implementations.

● Write(services\worker\src\pipeline\stage.ts)
  ⎿  Wrote 58 lines to services\worker\src\pipeline\stage.ts
       1 import type { Stage } from "@nexus/shared";
       2 import { insertEvent, setStage } from "@nexus/shared/node";
       3 import type { WorkerDeps } from "../deps.js";
       4 import { classifyError } from "./errors.js";
       5 
       6 export interface StageContext {
       7   deps: WorkerDeps;
       8   documentId: string;
       9   run: number;
      10 }
     … +53 lines (ctrl+o to expand)

● Write(services\worker\src\pipeline\analyze.ts)
  ⎿  Wrote 18 lines to services\worker\src\pipeline\analyze.ts
       1 import { insertEvent } from "@nexus/shared/node";
       2 import type { StageContext } from "./stage.js";
       3 
       5   needsReview: boolean;
       6 }
       7 
       8 // Placeholder until parsing and extraction exist. Those stages 
       9 export function analyze({ deps, documentId, run }: StageContext)
         : Promise<AnalysisResult> {
      10   insertEvent(deps.db, {
     … +10 lines (ctrl+o to expand)

● Write(services\worker\src\pipeline\run.ts)
  ⎿  Wrote 107 lines to services\worker\src\pipeline\run.ts
       1 import { UnrecoverableError, type Job } from "bullmq";
       2 import { z } from "zod";
       3 import {
       4   ExtractJobPayload,
       5   getDocument,
       6   insertEvent,
       7   transitionStatus,
       8   type Logger,
       9 } from "@nexus/shared/node";
      10 import type { WorkerDeps } from "../deps.js";
     … +117 lines (ctrl+o to expand)

● Bash(npx prettier --write services/worker/src >/dev/null && npm run typecheck
      2>&1 | grep -v "^$" | tail -15 && npm run lint 2>&1 | tail -15 && npm test
      2>&1 | tail…)
  ⎿  > typecheck
     > tsc -b && tsc -p tsconfig.test.json && npm run typecheck -w @nexus/w
     eb
     … +35 lines (ctrl+o to expand)
  ⎿  Updated services\worker\src\pipeline\run.test.ts (+143 -140)
        1 -import { UnrecoverableError } from "bullmq";                  
        2 -import { describe, expect, it, vi } from "vitest";            
        3 -import { ErrorCode } from "@nexus/shared";                    
        4 -import { getDocument, listEvents, transitionStatus } from "@ne
          -xus/shared/node";                                             
        5 -import { docId, makeDeps, seedDocument } from "../test-support
          -/fixtures.js";                                                
        6 -import { analyze } from "./analyze.js";                       
        7 -import { PermanentError, TransientError } from "./errors.js"; 
        8 -import { processJob, type ExtractJob } from "./run.js";       
        9 -                                                              
       10 -// Wraps the real placeholder so the happy path still runs it,
          - while failure tests can make it throw.                       
       11 -vi.mock("./analyze.js", async (importOriginal) => {           
       12 -  const mod = await importOriginal<typeof import("./analyze.js
          -")>();                                                        
       13 -  return { ...mod, analyze: vi.fn(mod.analyze) };             
       14 -});                                                           
       15 -                                                              
       16 -function job(data: unknown, attemptsMade = 0, attempts: number
          - | undefined = 3): ExtractJob {                               
       17 -  return { id: "job-1", data, attemptsMade, opts: attempts ===
          - undefined ? {} : { attempts } };                             
       18 -}                                                             
       19 -                                                              
       20 -describe("processJob", () => {                                
       21 -  it("rejects an invalid payload as unrecoverable", async () =
          -> {                                                           
       22 -    const { deps } = makeDeps();                              
       23 -                                                              
       24 -    await expect(processJob(job({ documentId: "nope", run: 0 }
          -), deps)).rejects.toBeInstanceOf(                             
       25 -      UnrecoverableError,                                     
       26 -    );                                                        
       27 -  });                                                         
       28 -                                                              
       29 -  it("drops a job whose document does not exist", async () => 
          -{                                                             
       30 -    const { deps, lines } = makeDeps();                       
       31 -                                                              
       32 -    await processJob(job({ documentId: docId(9), run: 1 }), de
          -ps);                                                          
       33 -                                                              
       34 -    expect(lines.at(-1)).toMatchObject({ level: 40, documentId
          -: docId(9) });                                                
       35 -  });                                                         
       36 -                                                              
       37 -  it("drops a stale job without touching the document", async 
          -() => {                                                       
       38 -    const { deps } = makeDeps();                              
       39 -    const id = seedDocument(deps);                            
       40 -                                                              
     … 243 more lines (ctrl+o to expand)
  ⎿  Updated services\worker\src\pipeline\run.ts (+6 -1)
      59      throw handleFailure(job, ctx, log, err);
      60    }
      61  
      62 -  if (!transitionStatus(deps.db, documentId, "completed", { fro
         -m: "processing", needs_review: needsReview })) {               
      62 +  if (                                                         
      63 +    !transitionStatus(deps.db, documentId, "completed", {      
      64 +      from: "processing",                                      
      65 +      needs_review: needsReview,                               
      66 +    })                                                         
      67 +  ) {                                                          
      68      log.warn("document left processing before it could be compl
          eted");
      69      return;
      70    }
  ⎿  (timeout 5m)

● Test bug, not a code bug: passing undefined to job() falls back to the default
  parameter of 3. I'll fix that and the lint error.

  Read 1 file (ctrl+o to expand)

● Bash(python - <<'EOF'
      p='services/worker/src/pipeline/run.test.ts'…)
  ⎿  E:\contract-analysis-pipeline\services\worker\src\pipeline\run.test.ts
       6:1  error  All imports in the declaration are only used as types. U
     se `import type`  @typescript-eslint/consistent-type-imports
     … +9 lines (ctrl+o to expand)
  ⎿  Updated services\worker\src\pipeline\run.test.ts (+14 -12)
       3  import { ErrorCode } from "@nexus/shared";
       4  import { getDocument, listEvents, transitionStatus } from "@nex
          us/shared/node";
       5  import { docId, makeDeps, seedDocument } from "../test-support/
          fixtures.js";
       6 +import * as analyzeModule from "./analyze.js";                 
       7  import { analyze } from "./analyze.js";
       8  import { PermanentError, TransientError } from "./errors.js";
       9  import { processJob, type ExtractJob } from "./run.js";
      10  
      11  // Wraps the real placeholder so the happy path still runs it, 
          while failure tests can make it throw.
      12  vi.mock("./analyze.js", async (importOriginal) => {
      12 -  const mod = await importOriginal<typeof import("./analyze.js"
         -)>();                                                          
      13 +  const mod = await importOriginal<typeof analyzeModule>();    
      14    return { ...mod, analyze: vi.fn(mod.analyze) };
      15  });
      16  
      16 -function job(data: unknown, attemptsMade = 0, attempts: number 
         -| undefined = 3): ExtractJob {                                 
      17 -  return { id: "job-1", data, attemptsMade, opts: attempts === 
         -undefined ? {} : { attempts } };                               
      17 +function job(                                                  
      18 +  data: unknown,                                               
      19 +  attemptsMade = 0,                                            
      20 +  opts: ExtractJob["opts"] = { attempts: 3 },                  
      21 +): ExtractJob {                                                
      22 +  return { id: "job-1", data, attemptsMade, opts };            
      23  }
      24  
      25  describe("processJob", () => {
     ...
      87  });
      88  
      89  describe("processJob failures", () => {
      85 -  async function failWith(err: unknown, attemptsMade = 0, attem
         -pts?: number) {                                                
      90 +  async function failWith(err: unknown, attemptsMade: number, o
         +pts: ExtractJob["opts"]) {                                     
      91      const { deps, lines } = makeDeps();
      92      const id = seedDocument(deps);
      93      vi.mocked(analyze).mockRejectedValueOnce(err);
      89 -    const thrown = await processJob(                           
      90 -      job({ documentId: id, run: 1 }, attemptsMade, attempts), 
      91 -      deps,                                                    
      92 -    ).then(                                                    
      94 +    const thrown = await processJob(job({ documentId: id, run: 
         +1 }, attemptsMade, opts), deps).then(                          
      95        () => undefined,
     … 34 more lines (ctrl+o to expand)
  ⎿  (timeout 5m)

● Bash(sed -i 's#^import \* as analyzeModule from "./analyze.js";#import type *
      as analyzeModule from "./analyze.js";#'
      services/worker/src/pipeline/run.test.ts && npm…)
  ⎿  0
     > lint
     > eslint .
     … +6 lines (ctrl+o to expand)
  ⎿  Updated services\worker\src\pipeline\run.test.ts (+1 -1)
      3  import { ErrorCode } from "@nexus/shared";
      4  import { getDocument, listEvents, transitionStatus } from "@nexu
         s/shared/node";
      5  import { docId, makeDeps, seedDocument } from "../test-support/f
         ixtures.js";
      6 -import * as analyzeModule from "./analyze.js";                  
      6 +import type * as analyzeModule from "./analyze.js";             
      7  import { analyze } from "./analyze.js";
      8  import { PermanentError, TransientError } from "./errors.js";
      9  import { processJob, type ExtractJob } from "./run.js";
  ⎿  (timeout 5m)

● stage.ts and run.ts are written, and processJob follows your six steps.
  Typecheck, lint and prettier are clean, and tests are 144/144 passing (up from
  130).

  1. pipeline/stage.ts, runStage(ctx, stage, fn): sets the stage, times it with
     performance.now(), then writes an ok or error event. The error event's
     message is CODE: message, capped at 500 characters. It logs with documentId
     and rethrows the original error unchanged.
  2. pipeline/run.ts, processJob(job, deps):
     - A bad payload throws UnrecoverableError.
     - A missing document gets a warning and is dropped. A run mismatch is
       dropped as "stale job". If the claim to processing doesn't go through,
       it's dropped as "already done".
     - On failure, classifyError decides between permanent (failed +
       UnrecoverableError), last attempt (failed + the original error rethrown),
       and retry (a retry event like "attempt 2 of 3", status stays
       processing).
     - A job with no attempts option counts as a single attempt, which is
       bullmq's default.
  3. Tests: stage.test.ts and run.test.ts, including stalled-job redelivery, a
     stale run, and each failure branch.

  Choices of mine to check:
  - "after parsing": I read this as after parsing job.data, since file parsing
    doesn't exist yet. The placeholder writes the info event and completes with
    needs_review = true. Tell me if you meant after the real PDF/DOCX parse
    stage.
  - Placeholder lives in pipeline/analyze.ts, outside runStage. Real stages will
    call runStage from inside analyze. It's a separate file so the tests can
    make it fail with vi.mock.
  - Event labels:
    - The placeholder info event uses stage extracting.
    - Retry events use job, matching how the API uses queue.
    - Successful stage events have the message ok.
  - Completing the document happens outside the try. If that update matches no
    row, it logs a warning and doesn't throw.
  - Test helpers: src/test-support/fixtures.ts is excluded from the worker build
    in tsconfig.json, the same way the API does it.

  Next: the worker entrypoint (the bullmq Worker and shutdown) or parsing with
  unpdf/mammoth, whichever you send next.

✻ Churned for 3m 46s · done 6:38 AM

❯ all good. "after parsing" will mean the real file parse once this next step   
  lands. keep analyze in pipeline/analyze.ts, that's where the real             
  analyzeDocument will go too. next:                                            
  pdf parsing with unpdf. I tried pdf-parse v2 next to it and it blew up with   
  "The API version does not match the Worker version" (pdf.js clash). unpdf     
  gave me clean text per page which is what I need.                             
                                                                                
  const pdf = await getDocumentProxy(new Uint8Array(buffer))                    
  const { totalPages, text } = await extractText(pdf, { mergePages: false })    
  destroy in finally                                                            
                                                                                
  question: does extractText keep line breaks? write a test with 2 pages x 3    
  lines. if it doesn't, build each page from page.getTextContent() and add \n   
  on item.hasEOL. tell me which way you went, I need the line breaks for clause 
  detection later.                                                              
                                                                                
  if average non-whitespace chars per page < 50 -> PermanentError NO_TEXT_LAYER 
  "PDF has no extractable text (likely scanned). OCR is not supported." rather  
  fail honestly than send empty text and get back nulls that look legit.        
                                                                                
  add pdfkit ^0.20, @types/pdfkit and docx ^9.9 as dev deps and generate        
  fixtures in test setup (temp dir under os.tmpdir(), cleaned up after)         

  Ran 1 shell command (ctrl+o to expand)

● Bash(npm install -D -w @nexus/worker pdfkit@^0.20.2 @types/pdfkit@^0.17.6
      docx@^9.9.0 2>&1 | grep -v allow-scripts | tail -3; P=node_modules/pdfkit;
      [ -d services/wo…)
  ⎿    npm audit fix --force

     Run `npm audit` for details.
     … +9 lines (ctrl+o to expand)
  ⎿  Updated services\worker\package.json (+5 -0)
      11      "pino": "^10.4.0",
      12      "unpdf": "^1.8.1",
      13      "zod": "^4.6.5"
      14 +  },                                                           
      15 +  "devDependencies": {                                         
      16 +    "@types/pdfkit": "^0.17.6",                                
      17 +    "docx": "^9.9.0",                                          
      18 +    "pdfkit": "^0.20.2"                                        
      19    }
      20  }
  ⎿  … 1 more file changed

  Ran 1 shell command (ctrl+o to expand)

● Before writing the test, a quick probe of what extractText actually returns:

  Ran 1 shell command (ctrl+o to expand)
● extractText does keep line breaks. But pdf.destroy() doesn't exist on what
  getDocumentProxy returns, which contradicts the spec. Checking what's actually
  there:

  Ran 1 shell command (ctrl+o to expand)

● extractText keeps line breaks, but pdf.destroy() doesn't exist in unpdf 1.8.1,
  so I stopped before writing any parser code.

  Line breaks: a 2-page × 3-line PDF made with pdfkit came back as:
  ["Page 1 line 1 …\nPage 1 line 2 …\nPage 1 line 3 …", "Page 2 line 1 …\nPage 2
  line 2 …\nPage 2 line 3 …"]
  So extractText(pdf, { mergePages: false }) is enough, and the getTextContent()
  + hasEOL fallback isn't needed. The test will check for exactly this.

  The problem: await pdf.destroy() throws TypeError: pdf.destroy is not a 
  function. The object getDocumentProxy returns only has:
  - pdf.cleanup(): frees cached page data only, and the document stays open.
  - pdf.loadingTask.destroy(): closes the whole document, which is what you
    described.

  Your call:
  - A (my pick): await pdf.loadingTask.destroy() in the finally.
  - B: pdf.cleanup() only. I'd skip it, because it doesn't close the document.

  Already done:
  - Dev deps are in the worker: pdfkit ^0.20.2, @types/pdfkit ^0.17.6, docx
    ^9.9.0.
  - pdfkit 0.20 ships no types of its own, and @types/pdfkit only goes up to
    0.17.6. That's fine for basic use and could miss newer API.
  - npm audit: 3 moderate findings, all from mammoth (via argparse →
    sprintf-js), not from these packages. The only fix npm offers downgrades
    mammoth to 0.3.29, so I left it alone.

  Reply A or B and I'll write parse/pdf.ts plus the tests. About 15 minutes.

✻ Sautéed for 1m 2s · done 6:42 AM

❯ A, loadingTask.destroy() in the finally. good that extractText keeps the line 
  breaks, put that 2 page x 3 line check in the test so we know if a future     
  unpdf version changes it.                                                     
                                                                                
  types for pdfkit are fine, it's only for fixtures. leave the mammoth audit,   
  it's argparse from mammoth's cli which we never run. I'll note it in the      
  readme. go ahead with pdf.ts + tests                                          

● Write(services\worker\src\test-support\pdf.ts)
  ⎿  Wrote 18 lines to services\worker\src\test-support\pdf.ts
       1 import PDFDocument from "pdfkit";
       2 
       3 // Each inner array is one page, each string one line. An empty 
         array gives a page with no text,
       4 // which is what a scanned page looks like to a text extractor.
       6   return new Promise((resolve, reject) => {
       7     const doc = new PDFDocument({ autoFirstPage: false });
       8     const chunks: Buffer[] = [];
       9     doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      10     doc.on("end", () => resolve(Buffer.concat(chunks)));
     … +9 lines (ctrl+o to expand)

● Write(services\worker\src\parse\pdf.test.ts)
  ⎿  Wrote 110 lines to services\worker\src\parse\pdf.test.ts
       1 import { mkdtemp, readFile, rm, writeFile } from "node:fs/promis
         es";
       3 import { join } from "node:path";
       4 import { afterAll, beforeAll, beforeEach, describe, expect, it, 
         vi } from "vitest";
       6 import { PermanentError } from "../pipeline/errors.js";
       7 import { makePdf } from "../test-support/pdf.js";
       8 import { parsePdf } from "./pdf.js";
      10 // Counts loadingTask.destroy() calls so the tests can check the
          document is closed on every path.
     … +119 lines (ctrl+o to expand)

● Write(services\worker\src\parse\pdf.ts)
  ⎿  Wrote 54 lines to services\worker\src\parse\pdf.ts
      1 import { extractText, getDocumentProxy } from "unpdf";
      2 import { ErrorCode } from "@nexus/shared";
      3 import { PermanentError } from "../pipeline/errors.js";
      4 
      5 export interface ParsedPdf {
      6   totalPages: number;
      7   // One entry per page, line breaks kept: clause detection needs
         them.
      8   pages: string[];
      9 }
     … +57 lines (ctrl+o to expand)

  Ran 2 shell commands, wrote 1 memory (ctrl+o to expand)

● PDF parsing is in, using extractText as is, since it keeps line breaks.
  parsePdf returns { totalPages, pages: string[] }. Typecheck and lint are
  clean, and tests are 150/150 passing (6 new).

  1. services/worker/src/parse/pdf.ts:
     - Calls getDocumentProxy(new Uint8Array(buffer)) and then extractText(pdf, 
       { mergePages: false }).
     - await pdf.loadingTask.destroy() runs in the finally.
     - Throws NO_TEXT_LAYER with your exact message when the average is under 50
       non-whitespace characters per page, or when there are 0 pages.
  2. services/worker/src/parse/pdf.test.ts: fixtures are generated in a mkdtemp
     folder under os.tmpdir() and removed in afterAll. It covers:
     - The 2 pages × 3 lines test, checking the exact text with \n breaks.
     - Blank pages, an average of 45 (rejected), and an average of exactly 50
       (accepted, whitespace not counted).
     - loadingTask.destroy() being called on both the success path and the
       NO_TEXT_LAYER path.
  3. services/worker/src/test-support/pdf.ts: a makePdf(pages) helper built on
     pdfkit.

  Added beyond the spec: if unpdf throws while opening or reading a file, I turn
  it into a permanent PARSE_ERROR with the original error as cause. Your rule
  was that a broken PDF is broken every time. Without this, classifyError would
  make it transient INTERNAL and the job would retry 3 times. There's a test
  with bytes that aren't a PDF.

  parsePdf isn't called from analyze() yet. I also saved the unpdf teardown
  gotcha to memory.

  Next: DOCX with mammoth, or wiring parsePdf into analyze as the parsing stage.
  Send whichever is next.

✻ Sautéed for 1m 26s · done 6:45 AM

❯ good, PARSE_ERROR for broken files is right. keep everything in parse/, the   
  step below says parsing/ but use parse/. next:                                
  docx: mammoth.extractRawText({ path }), debug log the messages.               
                                                                                
  normalize.ts:                                                                 
  normalizeText -> \r\n and \r to \n, nbsp/unicode spaces to space, dehyphenate 
  (\p{L})-\n(\p{Ll}) -> $1$2, trim line ends, max 2 newlines in a row, trim     
  normalizePages(pages) -> normalize each one, if 3+ pages drop lines (3..80    
  chars trimmed) that show up on 60%+ of pages (headers/footers), also drop     
  "page N (of M)" and bare numbers, then join as "[[page N]]\n<text>"           
                                                                                
  those markers are how I'll figure out which page a quote is on later, way     
  more reliable than asking the model.                                          
                                                                                
  parsing/index.ts: parseDocument(path, mime) -> { format, text, pageCount      
  (null for docx), charCount without markers }. unknown mime ->                 
  UNSUPPORTED_TYPE, parser crash -> PARSE_ERROR with cause, over 400k chars ->  
  TEXT_TOO_LONG                                                                 

  Ran 3 shell commands (ctrl+o to expand)

● mammoth works as described: paragraphs come back separated by \n\n, a non-zip
  file throws, and a missing file gives ENOENT. Tests first.

● Write(services\worker\src\parse\normalize.test.ts)
  ⎿  Wrote 94 lines to services\worker\src\parse\normalize.test.ts
       1 import { describe, expect, it } from "vitest";
       2 import { normalizePages, normalizeText, stripPageMarkers } from 
       3 
       4 describe("normalizeText", () => {
       5   it("turns \\r\\n and lone \\r into \\n", () => {
       7   });
       8 
       9   it("replaces nbsp and other unicode spaces with a plain space"
      10     expect(normalizeText("net 30 days now　ok")).toBe("net 30 da
         ys now ok");
     … +107 lines (ctrl+o to expand)

● Write(services\worker\src\test-support\docx.ts)
  ⎿  Wrote 9 lines to services\worker\src\test-support\docx.ts
      1 import { Document, Packer, Paragraph } from "docx";
      2 
      3 // One paragraph per string.
      4 export function makeDocx(paragraphs: string[]): Promise<Buffer> {
      5   const doc = new Document({
      6     sections: [{ children: paragraphs.map((text) => new Paragraph
        (text)) }],
      7   });
      8   return Packer.toBuffer(doc);
      9 }

● Write(services\worker\src\parse\index.test.ts)
  ⎿  Wrote 105 lines to services\worker\src\parse\index.test.ts
      1 import { mkdtemp, rm, writeFile } from "node:fs/promises";
      2 import { tmpdir } from "node:os";
      3 import { join } from "node:path";
      4 import { afterAll, beforeAll, describe, expect, it } from "vitest
        ";
      5 import { createLogger } from "@nexus/shared/node";
      6 import { PermanentError } from "../pipeline/errors.js";
      7 import { makeDocx } from "../test-support/docx.js";
      8 import { makePdf } from "../test-support/pdf.js";
      9 import { MAX_TEXT_CHARS, parseDocument } from "./index.js";
     … +113 lines (ctrl+o to expand)

  Ran 1 shell command (ctrl+o to expand)

● Fails as expected (modules missing). Implementing:

● Write(services\worker\src\parse\normalize.ts)
  ⎿  Wrote 67 lines to services\worker\src\parse\normalize.ts
       1 // Lines on at least this share of pages are running headers or 
         footers, not content.
       3 // With 1 or 2 pages a repeated line is as likely to be content 
         as a header.
       4 const MIN_PAGES_FOR_REPEAT_CHECK = 3;
       6 const MAX_HEADER_LENGTH = 80;
       7 const PAGE_NUMBER_LINE = /^(?:page\s+\d+(?:\s+of\s+\d+)?|\d+)$/i
         ;
       9 
      10 function collapseBlankLines(text: string): string {
     … +67 lines (ctrl+o to expand)

● Write(services\worker\src\parse\docx.ts)
  ⎿  Wrote 9 lines to services\worker\src\parse\docx.ts
      1 import mammoth from "mammoth";
      2 import type { Logger } from "@nexus/shared/node";
      4 export async function parseDocx(path: string, logger: Logger): Pr
        omise<string> {
      5   const { value, messages } = await mammoth.extractRawText({ path
      6   // Mostly unsupported styles or elements. Useful when a documen
        t comes out oddly, not worth a warning.
      7   for (const { type, message } of messages) logger.debug({ type, 
      8   return value;
      9 }
     … +3 lines (ctrl+o to expand)

● Write(services\worker\src\parse\index.ts)
  ⎿  Wrote 71 lines to services\worker\src\parse\index.ts
      1 import { readFile } from "node:fs/promises";
      2 import { ErrorCode } from "@nexus/shared";
      3 import type { Logger } from "@nexus/shared/node";
      4 import { PermanentError } from "../pipeline/errors.js";
      5 import { parseDocx } from "./docx.js";
      6 import { normalizePages, normalizeText, stripPageMarkers } from "
        ./normalize.js";
      7 import { parsePdf } from "./pdf.js";
      8 
      9 export type DocumentFormat = "pdf" | "docx";
     … +74 lines (ctrl+o to expand)

● Bash(npx prettier --write services/worker/src >/dev/null && npm run typecheck
      2>&1 | grep -E "error TS" | head; npm run lint 2>&1 | tail -6 && npm test
      2>&1 | tail -…)
  ⎿  > lint
     > eslint .
     … +17 lines (ctrl+o to expand)
  ⎿  Updated services\worker\src\parse\normalize.test.ts (+5 -1)
      80    });
      81  
      82    it("collapses the blank lines left behind by dropped lines", 
          () => {
      83 -    const pages = ["Header\n\nbody one\n\n7", "Header\n\nbody t
         -wo\n\n8", "Header\n\nbody three\n\n9"];                        
      83 +    const pages = [                                            
      84 +      "Header\n\nbody one\n\n7",                               
      85 +      "Header\n\nbody two\n\n8",                               
      86 +      "Header\n\nbody three\n\n9",                             
      87 +    ];                                                         
      88      expect(normalizePages(pages)).toBe(
      89        "[[page 1]]\nbody one\n\n[[page 2]]\nbody two\n\n[[page 3
          ]]\nbody three",
      90      );
  ⎿  (timeout 5m)

● Parsing is done in parse/. parseDocument(path, mime, logger) returns { format,
  text, pageCount, charCount }. Typecheck and lint are clean, and tests are
  173/173 passing (23 new).

  1. parse/docx.ts: calls mammoth.extractRawText({ path }) and debug-logs each
     message. I checked first that mammoth behaves as you described.
  2. parse/normalize.ts: normalizeText and normalizePages follow your rules.
     stripPageMarkers removes the markers so charCount doesn't include them.
  3. parse/index.ts:
     - An unknown mime gives UNSUPPORTED_TYPE. A parser crash gives PARSE_ERROR
       with the cause.
     - Errors parsePdf already classified pass through unchanged.
     - Over 400k characters gives TEXT_TOO_LONG, and exactly 400k passes.
  4. Tests: fixtures are made with pdfkit and docx in a temp folder that gets
     deleted afterwards. The PDF test checks the full output, including a
     hyphenated word joined across a line break.

  Choices of mine to check:
  - logger is a third parameter, because the mammoth debug log needs one. The
    worker will pass a child logger that carries documentId. I didn't write a
    test for the debug lines.
  - Page-number and bare-number lines are only dropped for 3+ pages, the same as
    headers. In a 1–2 page document a line like 12 can be real content.
  - "Trim line ends" means trailing whitespace only. It runs before
    dehyphenation, so agree-  \nment still joins.
  - A missing upload file becomes permanent PARSE_ERROR for both formats. For
    DOCX, mammoth opens the file itself and its ENOENT gets wrapped. I wrapped
    the PDF readFile the same way so the two formats behave alike.
  - The mime → format map is a copy of the one in
    services/api/src/services/upload.ts. I didn't move it to shared without
    asking.

  Two questions:
  - Fake markers: document text could already contain a literal [[page 5]],
    which would confuse the quote → page lookup later. Should normalizePages
    strip existing [[page N]] from the page text before adding its own? It's a
    one-line regex.
  - Empty DOCX: a DOCX with no text currently goes through with text: "". Should
    it fail like the PDF NO_TEXT_LAYER check?

  Next step after you answer: wire parseDocument into analyze as the parsing
  stage.

✻ Sautéed for 2m 58s · done 6:50 AM

❯ yes strip any existing [[page N]] from page text before adding ours, document 
  text is untrusted and fake markers would mess up page lookups.                
                                                                                
  empty docx: yes fail it. add EMPTY_DOCUMENT to ErrorCode, permanent, when a   
  docx has under 50 non-whitespace chars total. don't reuse NO_TEXT_LAYER, that 
  one says scanned pdf.                                                         
                                                                                
  move the mime -> format map to shared (browser safe, it's just constants) and 
  use it in both api upload and worker parse.                                   
                                                                                
  rest is fine. next:                                                           
                                                                                
  pipeline/analyze.ts: analyzeDocument({ path, mime, filename }, deps, hooks?:  
  { onStage }) -> { parsed, extraction: null, needsReview }. path is relative,  
  resolve it against UPLOAD_DIR. parsing stage calls parseDocument from parse/. 
  no db or queue in here, processJob passes onStage wrapping runStage. keeping  
  it separate so the eval script can call it directly later.                    
                                                                                
  worker index.ts: config, logger, openDb, assertMigrated (exit 1 with a clear  
  message). then                                                                
                                                                                
  new Worker(QUEUE_NAME, job => processJob(job, deps), {                        
    connection: { url: REDIS_URL, maxRetriesPerRequest: null },                 
    concurrency: WORKER_CONCURRENCY,                                            
    lockDuration: LLM_TIMEOUT_MS + 60_000,                                      
    maxStalledCount: 1,                                                         
  })                                                                            
                                                                                
  log failed + error events through pino, nothing to console. SIGTERM/SIGINT -> 
  await worker.close() (finishes active jobs), close db, exit 0. reuse the      
  same ordered-shutdown pattern as the api if it fits.                          
                                                                                
  lockDuration that big so a long parse can't look like a stall and run twice.  
  maxStalledCount 1 so a job that crashes a worker twice just fails.            
                                                                                
  tests:                                                                        
  - stripping fake [[page N]] markers                                           
  - empty docx -> EMPTY_DOCUMENT                                                
  - processJob with a real 2 page pdf through analyze: completed, needs_review  
  true, parsing event ok                                                        
  - whatever from the old list isn't covered yet (stale run, permanent,         
  transient retry, last attempt are done already, don't redo them)              
                                                                                
  also I want sample files for manual testing. add tsx ^4.23 as a root dev dep  
  (scripts only, never in services) and write scripts/make-test-files.ts that   
  generates them with pdfkit and docx, deterministic output, fictional content  
  only (made up company names, Nexus Corp as the customer). root script         
  "test-files". output:                                                         
                                                                                
  samples/SamplePDFs/                                                           
  - contract-2-pages.pdf: short fictional service agreement, 2 pages, numbered  
  clauses, a footer "Confidential | Page N" on each page                        
  - contract-5-pages.pdf: same idea but 5 pages so the header/footer stripping  
  kicks in                                                                      
  - scanned-no-text.pdf: 2 pages of only drawn rectangles and lines, no text    
  (should fail NO_TEXT_LAYER)                                                   
  - fake-markers.pdf: 1 page that contains the literal text "[[page 7]]" in a   
  clause                                                                        
  - not-a-pdf.pdf: plain text file with a .pdf name (should be rejected by the  
  api as UNSUPPORTED_TYPE)                                                      
                                                                                
  samples/SampleDocx/                                                           
  - contract.docx: fictional supplier agreement, a few headings and paragraphs  
  - empty.docx: valid docx with no text (should fail EMPTY_DOCUMENT)            
  - not-a-docx.docx: plain zip with a .docx name (should be rejected by the     
  api)                                                                          
    i will commit the generated files                                           

● Big step, so I'll start by reading the parts I'll reuse or change.
  Listed 1 directory, ran 3 shell commands (ctrl+o to expand)

● connection: { url } works in bullmq 6: it passes the url to ioredis. Next,
  checking whether pdfkit and docx can produce byte-for-byte identical output:

  Ran 2 shell commands (ctrl+o to expand)

● pdfkit output is deterministic once CreationDate is fixed. docx output isn't.
  Finding out why:

  Ran 1 shell command (ctrl+o to expand)

● Since docx uses new Date() for core.xml timestamps and zip entry dates with no
  override option, I'll check if freezing the clock alone works, keeping in
  mind it also relies on nanoid.

  Ran 1 shell command (ctrl+o to expand)

● I'll leave the two docx samples non-deterministic for now rather than pinning
  the global Date as a workaround, and instead start building the shared format
  map and EMPTY_DOCUMENT.

  Ran 1 shell command (ctrl+o to expand)

● Bash(cat > packages/shared/src/formats.ts <<'EOF'
      export type DocumentFormat = "pdf" | "docx";…)
  ⎿  10:import { ErrorCode, MIME_FORMATS, type UploadResponse } from "@nexu
     s/shared";
     74:    const ext = detected ? MIME_FORMATS.get(detected.mime) : undefi
     … +3 lines (ctrl+o to expand)
  ⎿  Updated eslint.config.js (+1 -0)
      35      files: [
      36        "packages/shared/src/index.ts",
      37        "packages/shared/src/status.ts",
      38 +      "packages/shared/src/formats.ts",                        
      39        "packages/shared/src/schemas/**",
      40      ],
      41      rules: {
  ⎿  Created packages\shared\src\formats.ts (+8 -0)
      1 +export type DocumentFormat = "pdf" | "docx";                    
      2 +                                                                
      3 +// Keyed by the mime sniffed from the file bytes. The api uses i
        +t to accept uploads and name the                                
      4 +// stored file, the worker to pick a parser, so the two can't dr
        +ift apart.                                                      
      5 +export const MIME_FORMATS: ReadonlyMap<string, DocumentFormat> =
        + new Map([                                                      
      6 +  ["application/pdf", "pdf"],                                   
      7 +  ["application/vnd.openxmlformats-officedocument.wordprocessing
        +ml.document", "docx"],                                          
      8 +]);                                                             
  ⎿  Updated packages\shared\src\index.ts (+4 -3)
      1 -export * from "./status.js";                                    
      2 -export * from "./schemas/extraction.js";                        
      3 -export * from "./schemas/api.js";                               
      1 +export * from "./status.js";                                    
      2 +export * from "./formats.js";                                   
      3 +export * from "./schemas/extraction.js";                        
      4 +export * from "./schemas/api.js";                               
  ⎿  Updated packages\shared\src\status.ts (+42 -41)
       1 -export const DocumentStatus = {                                
       2 -  queued: "queued",                                            
       3 -  processing: "processing",                                    
       4 -  completed: "completed",                                      
       5 -  failed: "failed",                                            
       6 -} as const;                                                    
       7 -export type DocumentStatus = (typeof DocumentStatus)[keyof type
         -of DocumentStatus];                                            
       8 -                                                               
       9 -export const Stage = {                                         
      10 -  parsing: "parsing",                                          
      11 -  extracting: "extracting",                                    
      12 -  validating: "validating",                                    
      13 -} as const;                                                    
      14 -export type Stage = (typeof Stage)[keyof typeof Stage];        
      15 -                                                               
      16 -export const ErrorCode = {                                     
      17 -  UNSUPPORTED_TYPE: "UNSUPPORTED_TYPE",                        
      18 -  FILE_TOO_LARGE: "FILE_TOO_LARGE",                            
      19 -  NO_TEXT_LAYER: "NO_TEXT_LAYER",                              
      20 -  TEXT_TOO_LONG: "TEXT_TOO_LONG",                              
      21 -  PARSE_ERROR: "PARSE_ERROR",                                  
      22 -  EXTRACTION_INVALID: "EXTRACTION_INVALID",                    
      23 -  LLM_UNAVAILABLE: "LLM_UNAVAILABLE",                          
      24 -  LLM_AUTH: "LLM_AUTH",                                        
      25 -  INTERNAL: "INTERNAL",                                        
      26 -} as const;                                                    
      27 -export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCo
         -de];                                                           
      28 -                                                               
      29 -export const TERMINAL_STATUSES: readonly DocumentStatus[] = [  
      30 -  DocumentStatus.completed,                                    
      31 -  DocumentStatus.failed,                                       
      32 -];                                                             
      33 -                                                               
      34 -export const ALLOWED_TRANSITIONS = {                           
      35 -  queued: [DocumentStatus.processing, DocumentStatus.failed],  
      36 -  // bullmq can redeliver a stalled job, so a document that is 
         -already processing gets picked up again.                       
      37 -  processing: [DocumentStatus.processing, DocumentStatus.comple
         -ted, DocumentStatus.failed],                                   
      38 -  // Terminal states only go back to queued, which is the retry
         - path.                                                         
      39 -  completed: [DocumentStatus.queued],                          
      40 -  failed: [DocumentStatus.queued],                             
     … 43 more lines (ctrl+o to expand)
  ⎿  Updated services\api\src\services\upload.ts (+133 -137)
        1 -import { createHash, randomUUID } from "node:crypto";         
        2 -import { createWriteStream } from "node:fs";                  
        3 -import { mkdir, rename, rm } from "node:fs/promises";         
        4 -import { join } from "node:path";                             
        5 -import { Transform, type Readable } from "node:stream";       
        6 -import { pipeline } from "node:stream/promises";              
        7 -import type { MultipartFile } from "@fastify/multipart";      
        8 -import type { FastifyBaseLogger } from "fastify";             
        9 -import { fileTypeFromFile } from "file-type";                 
       10 -import { ErrorCode, type UploadResponse } from "@nexus/shared"
          -;                                                             
       11 -import { createDocument, findCompletedBySha256, type Config, t
          -ype Db } from "@nexus/shared/node";                           
       12 -import type { JobQueue } from "../queue.js";                  
       13 -import { enqueueOrDefer } from "./enqueue.js";                
       14 -                                                              
       15 -// Keyed by the mime file-type detects from the bytes. The cli
          -ent's extension and content-type are ignored.                 
       16 -const ALLOWED_TYPES: ReadonlyMap<string, string> = new Map([  
       17 -  ["application/pdf", "pdf"],                                 
       18 -  ["application/vnd.openxmlformats-officedocument.wordprocessi
          -ngml.document", "docx"],                                      
       19 -]);                                                           
       20 -                                                              
       21 -export interface UploadDeps {                                 
       22 -  db: Db;                                                     
       23 -  queue: JobQueue;                                            
       24 -  config: Pick<Config, "UPLOAD_DIR" | "MAX_UPLOAD_MB">;       
       25 -}                                                             
       26 -                                                              
       27 -export type AcceptedFile = UploadResponse["accepted"][number];
       28 -export type RejectedFile = UploadResponse["rejected"][number];
       29 -export type UploadOutcome = { accepted: AcceptedFile } | { rej
          -ected: RejectedFile };                                        
       30 -                                                              
       31 -type LogOutcome = "queued" | "duplicate" | "queue_unavailable"
          - | "too_large" | "unsupported_type";                          
       32 -                                                              
       33 -// sha256 and size in the same pass that writes the file, so a
          - 20mb upload is never held in memory.                         
       34 -async function writeHashed(                                   
       35 -  source: Readable,                                           
       36 -  path: string,                                               
       37 -): Promise<{ sha256: string; size: number }> {                
       38 -  const hash = createHash("sha256");                          
       39 -  let size = 0;                                               
       40 -  const tap = new Transform({                                 
     … 230 more lines (ctrl+o to expand)

● Now marker stripping in normalize.ts, plus EMPTY_DOCUMENT and the shared map
  in parse/index.ts. Tests first:

● Bash(python - <<'EOF'
      p='services/worker/src/parse/normalize.test.ts';
      s=open(p,encoding='utf8').read()…)
  ⎿       × rejects empty.docx with under 50 non-whitespace chars as EMPTY_
     DOCUMENT 24ms
          × rejects almost-empty.docx with under 50 non-whitespace chars as
     … +10 lines (ctrl+o to expand)
  ⎿  Updated services\worker\src\parse\index.test.ts (+124 -105)
        1 -import { mkdtemp, rm, writeFile } from "node:fs/promises";    
        2 -import { tmpdir } from "node:os";                             
        3 -import { join } from "node:path";                             
        4 -import { afterAll, beforeAll, describe, expect, it } from "vit
          -est";                                                         
        5 -import { createLogger } from "@nexus/shared/node";            
        6 -import { PermanentError } from "../pipeline/errors.js";       
        7 -import { makeDocx } from "../test-support/docx.js";           
        8 -import { makePdf } from "../test-support/pdf.js";             
        9 -import { MAX_TEXT_CHARS, parseDocument } from "./index.js";   
       10 -                                                              
       11 -const PDF = "application/pdf";                                
       12 -const DOCX = "application/vnd.openxmlformats-officedocument.wo
          -rdprocessingml.document";                                     
       13 -const logger = createLogger("worker", "silent");              
       14 -                                                              
       15 -const BODY = "The supplier shall deliver the services describe
          -d in Schedule A";                                             
       16 -                                                              
       17 -let dir: string;                                              
       18 -const path = (name: string) => join(dir, name);               
       19 -                                                              
       20 -beforeAll(async () => {                                       
       21 -  dir = await mkdtemp(join(tmpdir(), "nexus-parse-"));        
       22 -  await writeFile(                                            
       23 -    path("contract.pdf"),                                     
       24 -    await makePdf([                                           
       25 -      [`${BODY} on page one.`, "It renews automa-", "tically e
          -very year."],                                                 
       26 -      [`${BODY} on page two.`],                               
       27 -    ]),                                                       
       28 -  );                                                          
       29 -  await writeFile(                                            
       30 -    path("contract.docx"),                                    
       31 -    await makeDocx(["Master Services Agreement", `${BODY}.`, "
          -Net 30 days."]),                                              
       32 -  );                                                          
       33 -  await writeFile(path("huge.docx"), await makeDocx(["x".repea
          -t(MAX_TEXT_CHARS + 1)]));                                     
       34 -  await writeFile(path("limit.docx"), await makeDocx(["x".repe
          -at(MAX_TEXT_CHARS)]));                                        
       35 -  await writeFile(path("broken.docx"), "not a zip");          
       36 -  await writeFile(path("broken.pdf"), "not a pdf");           
       37 -});                                                           
       38 -                                                              
       39 -afterAll(async () => {                                        
       40 -  await rm(dir, { recursive: true, force: true });            
     … 189 more lines (ctrl+o to expand)
  ⎿  Updated services\worker\src\parse\normalize.test.ts (+118 -98)
        1 -import { describe, expect, it } from "vitest";                
        2 -import { normalizePages, normalizeText, stripPageMarkers } fro
          -m "./normalize.js";                                           
        3 -                                                              
        4 -describe("normalizeText", () => {                             
        5 -  it("turns \\r\\n and lone \\r into \\n", () => {            
        6 -    expect(normalizeText("a\r\nb\rc\nd")).toBe("a\nb\nc\nd"); 
        7 -  });                                                         
        8 -                                                              
        9 -  it("replaces nbsp and other unicode spaces with a plain spac
          -e", () => {                                                   
       10 -    expect(normalizeText("net 30 days now　ok")).toBe("net 30 
          -days now ok");                                                
       11 -  });                                                         
       12 -                                                              
       13 -  it("joins words hyphenated across a line break", () => {    
       14 -    expect(normalizeText("the agree-\nment renews")).toBe("the
          - agreement renews");                                          
       15 -    expect(normalizeText("Kündi-\ngung")).toBe("Kündigung");  
       16 -  });                                                         
       17 -                                                              
       18 -  it("keeps the hyphen when the next line starts with a capita
          -l, a digit or a space", () => {                               
       19 -    expect(normalizeText("Acme-\nCorp")).toBe("Acme-\nCorp"); 
       20 -    expect(normalizeText("pages 1-\n2")).toBe("pages 1-\n2"); 
       21 -  });                                                         
       22 -                                                              
       23 -  it("trims line ends, before dehyphenating so trailing spaces
          - don't block the join", () => {                               
       24 -    expect(normalizeText("line one   \nterm-  \ninated\t")).to
          -Be("line one\nterminated");                                   
       25 -  });                                                         
       26 -                                                              
       27 -  it("keeps at most 2 newlines in a row and trims the whole te
          -xt", () => {                                                  
       28 -    expect(normalizeText("\n\n  a\n\n\n\n\nb\n \n \nc  \n\n"))
          -.toBe("a\n\nb\n\nc");                                         
       29 -  });                                                         
       30 -});                                                           
       31 -                                                              
       32 -describe("normalizePages", () => {                            
       33 -  it("prefixes each page with a [[page N]] marker", () => {   
       34 -    expect(normalizePages(["first", "second"])).toBe("[[page 1
          -]]\nfirst\n\n[[page 2]]\nsecond");                            
       35 -  });                                                         
       36 -                                                              
       37 -  it("normalizes each page", () => {                          
       38 -    expect(normalizePages(["a\r\nb  "])).toBe("[[page 1]]\na\n
          -b");                                                          
       39 -  });                                                         
       40 -                                                              
     … 176 more lines (ctrl+o to expand)

  Read 1 file, ran 1 shell command (ctrl+o to expand)

● Update(services\worker\src\parse\normalize.test.ts)
  ⎿  Added 5 lines, removed 11 lines
       93  
       94  describe("normalizePages with untrusted markers", () => {
       95    it("strips [[page N]] that is already in the page text befor
           e adding its own", () => {
       96 -    const pages = ["Clause 4 [[page 7]] applies.              
       97 -[[page 9]]                                                    
       98 -end", "second"];                                              
       96 +    const pages = ["Clause 4 [[page 7]] applies.\n[[page 9]]\n
          +end", "second"];                                              
       97  
      100 -    expect(normalizePages(pages)).toBe("[[page 1]]            
      101 -Clause 4 applies.                                             
      102 -end                                                           
      103 -                                                              
      104 -[[page 2]]                                                    
      105 -second");                                                     
       98 +    expect(normalizePages(pages)).toBe(                       
       99 +      "[[page 1]]\nClause 4 applies.\nend\n\n[[page 2]]\nsecon
          +d",                                                           
      100 +    );                                                        
      101    });
      102  
      103    it("also strips spacing and case variants", () => {
      109 -    expect(normalizePages(["a [[ Page 12 ]] b [[PAGE 3]]"])).t
          -oBe("[[page 1]]                                               
      110 -a b");                                                        
      104 +    expect(normalizePages(["a [[ Page 12 ]] b [[PAGE 3]]"])).t
          +oBe("[[page 1]]\na b");                                       
      105    });
      106  });
      107  

● Bash(sed -i $'s/Net 30 days/Net\\\\u00a030 days/'
      services/worker/src/parse/index.test.ts && grep -n "Net"
      services/worker/src/parse/index.test.ts)
  ⎿  31:    await makeDocx(["Master Services Agreement", `${BODY}.`, "Net00
     a030 days."]),
     76:      text: `Master Services Agreement\n\n${BODY}.\n\nNet 30 days.`
     ,
  ⎿  Updated services\worker\src\parse\index.test.ts (+124 -124)
        1 -import { mkdtemp, rm, writeFile } from "node:fs/promises";    
        2 -import { tmpdir } from "node:os";                             
        3 -import { join } from "node:path";                             
        4 -import { afterAll, beforeAll, describe, expect, it } from "vit
          -est";                                                         
        5 -import { createLogger } from "@nexus/shared/node";            
        6 -import { PermanentError } from "../pipeline/errors.js";       
        7 -import { makeDocx } from "../test-support/docx.js";           
        8 -import { makePdf } from "../test-support/pdf.js";             
        9 -import { MAX_TEXT_CHARS, parseDocument } from "./index.js";   
       10 -                                                              
       11 -const PDF = "application/pdf";                                
       12 -const DOCX = "application/vnd.openxmlformats-officedocument.wo
          -rdprocessingml.document";                                     
       13 -const logger = createLogger("worker", "silent");              
       14 -                                                              
       15 -const BODY = "The supplier shall deliver the services describe
          -d in Schedule A";                                             
       16 -                                                              
       17 -let dir: string;                                              
       18 -const path = (name: string) => join(dir, name);               
       19 -                                                              
       20 -beforeAll(async () => {                                       
       21 -  dir = await mkdtemp(join(tmpdir(), "nexus-parse-"));        
       22 -  await writeFile(                                            
       23 -    path("contract.pdf"),                                     
       24 -    await makePdf([                                           
       25 -      [`${BODY} on page one.`, "It renews automa-", "tically e
          -very year."],                                                 
       26 -      [`${BODY} on page two.`],                               
       27 -    ]),                                                       
       28 -  );                                                          
       29 -  await writeFile(                                            
       30 -    path("contract.docx"),                                    
       31 -    await makeDocx(["Master Services Agreement", `${BODY}.`, "
          -Net 30 days."]),                                              
       32 -  );                                                          
       33 -  await writeFile(path("huge.docx"), await makeDocx(["x".repea
          -t(MAX_TEXT_CHARS + 1)]));                                     
       34 -  await writeFile(path("limit.docx"), await makeDocx(["x".repe
          -at(MAX_TEXT_CHARS)]));                                        
       35 -  await writeFile(path("broken.docx"), "not a zip");          
       36 -  await writeFile(path("empty.docx"), await makeDocx([]));    
       37 -  // 49 non-whitespace chars spread over paragraphs with lots 
          -of spaces.                                                    
       38 -  await writeFile(path("almost-empty.docx"), await makeDocx(["
          -a".repeat(20), "  b b  ".repeat(10), "c".repeat(9)]));        
       39 -  await writeFile(path("just-enough.docx"), await makeDocx(["d
          -".repeat(50)]));                                              
       40 -  await writeFile(path("broken.pdf"), "not a pdf");           
     … 208 more lines (ctrl+o to expand)

  Read 1 file (ctrl+o to expand)

● Update(services\worker\src\parse\index.test.ts)
  ⎿  Added 1 line, removed 1 line
      28    );
      29    await writeFile(
      30      path("contract.docx"),
      31 -    await makeDocx(["Master Services Agreement", `${BODY}.`, "N
         -et00a030 days."]),                                             
      31 +    await makeDocx(["Master Services Agreement", `${BODY}.`, "N
         +et 30 days."]),                                                
      32    );
      33    await writeFile(path("huge.docx"), await makeDocx(["x".repeat
          (MAX_TEXT_CHARS + 1)]));
      34    await writeFile(path("limit.docx"), await makeDocx(["x".repea
          t(MAX_TEXT_CHARS)]));

● Status: shared map and EMPTY_DOCUMENT done. Now writing the marker stripping
  and empty-DOCX check, then analyze, worker entrypoint and sample script.

● Bash(python - <<'EOF'
      p='services/worker/src/parse/normalize.ts';
      s=open(p,encoding='utf8').read()…)
  ⎿  <stdin>:2: SyntaxWarning: invalid escape sequence '\['
     <stdin>:2: SyntaxWarning: invalid escape sequence '\['
     <stdin>:29: SyntaxWarning: invalid escape sequence '\s'
     … +30 lines (ctrl+o to expand)
  ⎿  Updated services\worker\src\parse\index.ts (+70 -71)
       1 -import { readFile } from "node:fs/promises";                   
       2 -import { ErrorCode } from "@nexus/shared";                     
       3 -import type { Logger } from "@nexus/shared/node";              
       4 -import { PermanentError } from "../pipeline/errors.js";        
       5 -import { parseDocx } from "./docx.js";                         
       6 -import { normalizePages, normalizeText, stripPageMarkers } from
         - "./normalize.js";                                             
       7 -import { parsePdf } from "./pdf.js";                           
       8 -                                                               
       9 -export type DocumentFormat = "pdf" | "docx";                   
      10 -                                                               
      11 -export interface ParsedDocument {                              
      12 -  format: DocumentFormat;                                      
      13 -  // pdf text carries [[page N]] markers, docx text has none si
         -nce docx has no fixed pages.                                   
      14 -  text: string;                                                
      15 -  pageCount: number | null;                                    
      16 -  // Without the page markers, so it reflects the document and 
         -not our formatting.                                            
      17 -  charCount: number;                                           
      18 -}                                                              
      19 -                                                               
      20 -// Roughly 100k tokens. Past this a contract is more likely a m
         -is-upload than something worth the cost.                       
      21 -export const MAX_TEXT_CHARS = 400_000;                         
      22 -                                                               
      23 -// Same mimes the api accepts. The api stores the type it sniff
         -ed from the bytes, not the client's.                           
      24 -const FORMATS: ReadonlyMap<string, DocumentFormat> = new Map([ 
      25 -  ["application/pdf", "pdf"],                                  
      26 -  ["application/vnd.openxmlformats-officedocument.wordprocessin
         -gml.document", "docx"],                                        
      27 -]);                                                            
      28 -                                                               
      29 -async function extract(                                        
      30 -  format: DocumentFormat,                                      
      31 -  path: string,                                                
      32 -  logger: Logger,                                              
      33 -): Promise<{ text: string; pageCount: number | null }> {       
      34 -  if (format === "pdf") {                                      
      35 -    const { totalPages, pages } = await parsePdf(await readFile
         -(path));                                                       
      36 -    return { text: normalizePages(pages), pageCount: totalPages
         - };                                                            
      37 -  }                                                            
      38 -  return { text: normalizeText(await parseDocx(path, logger)), 
         -pageCount: null };                                             
      39 -}                                                              
      40 -                                                               
     … 101 more lines (ctrl+o to expand)
  ⎿  Updated services\worker\src\parse\normalize.ts (+68 -67)
       1 -// Lines on at least this share of pages are running headers or
         - footers, not content.                                         
       2 -const REPEATED_LINE_SHARE = 0.6;                               
       3 -// With 1 or 2 pages a repeated line is as likely to be content
         - as a header.                                                  
       4 -const MIN_PAGES_FOR_REPEAT_CHECK = 3;                          
       5 -const MIN_HEADER_LENGTH = 3;                                   
       6 -const MAX_HEADER_LENGTH = 80;                                  
       7 -const PAGE_NUMBER_LINE = /^(?:page\s+\d+(?:\s+of\s+\d+)?|\d+)$/
         -i;                                                             
       8 -const PAGE_MARKER_LINE = /^\[\[page \d+\]\]\n/gm;              
       9 -                                                               
      10 -function collapseBlankLines(text: string): string {            
      11 -  return text.replace(/\n{3,}/g, "\n\n").trim();               
      12 -}                                                              
      13 -                                                               
      14 -export function normalizeText(text: string): string {          
      15 -  return collapseBlankLines(                                   
      16 -    text                                                       
      17 -      .replace(/\r\n?/g, "\n")                                 
      18 -      .replace(/\p{Zs}/gu, " ")                                
      19 -      // Before dehyphenating, so "agree-  \nment" still joins.
      20 -      .replace(/[^\S\n]+$/gm, "")                              
      21 -      // Only a lowercase continuation: "Acme-\nCorp" is a real
         - hyphen at a line break.                                       
      22 -      .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2"),                
      23 -  );                                                           
      24 -}                                                              
      25 -                                                               
      26 -function repeatedLines(pages: readonly string[]): Set<string> {
      27 -  const counts = new Map<string, number>();                    
      28 -  for (const page of pages) {                                  
      29 -    const lines = new Set(                                     
      30 -      page                                                     
      31 -        .split("\n")                                           
      32 -        .map((line) => line.trim())                            
      33 -        .filter((line) => line.length >= MIN_HEADER_LENGTH && l
         -ine.length <= MAX_HEADER_LENGTH),                              
      34 -    );                                                         
      35 -    for (const line of lines) counts.set(line, (counts.get(line
         -) ?? 0) + 1);                                                  
      36 -  }                                                            
      37 -  const threshold = pages.length * REPEATED_LINE_SHARE;        
      38 -  return new Set([...counts].filter(([, count]) => count >= thr
         -eshold).map(([line]) => line));                                
      39 -}                                                              
      40 -                                                               
     … 95 more lines (ctrl+o to expand)

● The UNTRUSTED_MARKER constant didn't get inserted because Python mangled the
  escapes. Switching to Edit.

  Read 1 file (ctrl+o to expand)

● Update(services\worker\src\parse\normalize.ts)
  ⎿  Added 2 lines
       6  const MAX_HEADER_LENGTH = 80;
       7  const PAGE_NUMBER_LINE = /^(?:page\s+\d+(?:\s+of\s+\d+)?|\d+)$/
          i;
       8  const PAGE_MARKER_LINE = /^\[\[page \d+\]\]\n/gm;
       9 +// Looser than our own marker on purpose: anything a page looku
         +p might mistake for one goes.                                  
      10 +const UNTRUSTED_MARKER = /\[\[\s*page\s*\d+\s*\]\]/gi;         
      11  
      12  function collapseBlankLines(text: string): string {
      13    return text.replace(/\n{3,}/g, "\n\n").trim();

  Ran 2 shell commands (ctrl+o to expand)

● Found two issues: MIME_FORMATS is undefined since the built @nexus/shared dist
  needs rebuilding, and marker stripping leaves behind double spaces and empty
  lines. I'll rebuild shared and fix the stripping logic to remove marker-only
  lines entirely along with leading spaces before inline markers.

● Update(services\worker\src\parse\normalize.ts)
  ⎿  Added 8 lines, removed 1 line
       7  const PAGE_NUMBER_LINE = /^(?:page\s+\d+(?:\s+of\s+\d+)?|\d+)$/
          i;
       8  const PAGE_MARKER_LINE = /^\[\[page \d+\]\]\n/gm;
       9  // Looser than our own marker on purpose: anything a page looku
          p might mistake for one goes.
      10 -const UNTRUSTED_MARKER = /\[\[\s*page\s*\d+\s*\]\]/gi;         
      10 +const UNTRUSTED_MARKER = String.raw`\[\[[^\S\n]*page[^\S\n]*\d+
         +[^\S\n]*\]\]`;                                                 
      11 +const UNTRUSTED_MARKER_LINE = new RegExp(String.raw`^[^\S\n]*${
         +UNTRUSTED_MARKER}[^\S\n]*(?:\n|$)`, "gim");                    
      12 +// The spaces before it go too, so "Clause 4 [[page 7]] applies
         +." doesn't end up with a double space.                         
      13 +const UNTRUSTED_MARKER_INLINE = new RegExp(String.raw`[^\S\n]*$
         +{UNTRUSTED_MARKER}`, "gi");                                    
      14  
      15 +function stripUntrustedMarkers(text: string): string {         
      16 +  return text.replace(UNTRUSTED_MARKER_LINE, "").replace(UNTRUS
         +TED_MARKER_INLINE, "");                                        
      17 +}                                                              
      18 +                                                               
      19  function collapseBlankLines(text: string): string {
      20    return text.replace(/\n{3,}/g, "\n\n").trim();
      21  }

● Bash(sed -i 's/normalizeText(page.replace(UNTRUSTED_MARKER,
      ""))/normalizeText(stripUntrustedMarkers(page))/'
      services/worker/src/parse/normalize.ts && npx tsc -b 2>…)
  ⎿        Tests  34 passed (34)
  ⎿  Updated services\worker\src\parse\normalize.ts (+77 -77)
       1 -// Lines on at least this share of pages are running headers or
         - footers, not content.                                         
       2 -const REPEATED_LINE_SHARE = 0.6;                               
       3 -// With 1 or 2 pages a repeated line is as likely to be content
         - as a header.                                                  
       4 -const MIN_PAGES_FOR_REPEAT_CHECK = 3;                          
       5 -const MIN_HEADER_LENGTH = 3;                                   
       6 -const MAX_HEADER_LENGTH = 80;                                  
       7 -const PAGE_NUMBER_LINE = /^(?:page\s+\d+(?:\s+of\s+\d+)?|\d+)$/
         -i;                                                             
       8 -const PAGE_MARKER_LINE = /^\[\[page \d+\]\]\n/gm;              
       9 -// Looser than our own marker on purpose: anything a page looku
         -p might mistake for one goes.                                  
      10 -const UNTRUSTED_MARKER = String.raw`\[\[[^\S\n]*page[^\S\n]*\d+
         -[^\S\n]*\]\]`;                                                 
      11 -const UNTRUSTED_MARKER_LINE = new RegExp(String.raw`^[^\S\n]*${
         -UNTRUSTED_MARKER}[^\S\n]*(?:\n|$)`, "gim");                    
      12 -// The spaces before it go too, so "Clause 4 [[page 7]] applies
         -." doesn't end up with a double space.                         
      13 -const UNTRUSTED_MARKER_INLINE = new RegExp(String.raw`[^\S\n]*$
         -{UNTRUSTED_MARKER}`, "gi");                                    
      14 -                                                               
      15 -function stripUntrustedMarkers(text: string): string {         
      16 -  return text.replace(UNTRUSTED_MARKER_LINE, "").replace(UNTRUS
         -TED_MARKER_INLINE, "");                                        
      17 -}                                                              
      18 -                                                               
      19 -function collapseBlankLines(text: string): string {            
      20 -  return text.replace(/\n{3,}/g, "\n\n").trim();               
      21 -}                                                              
      22 -                                                               
      23 -export function normalizeText(text: string): string {          
      24 -  return collapseBlankLines(                                   
      25 -    text                                                       
      26 -      .replace(/\r\n?/g, "\n")                                 
      27 -      .replace(/\p{Zs}/gu, " ")                                
      28 -      // Before dehyphenating, so "agree-  \nment" still joins.
      29 -      .replace(/[^\S\n]+$/gm, "")                              
      30 -      // Only a lowercase continuation: "Acme-\nCorp" is a real
         - hyphen at a line break.                                       
      31 -      .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2"),                
      32 -  );                                                           
      33 -}                                                              
      34 -                                                               
      35 -function repeatedLines(pages: readonly string[]): Set<string> {
      36 -  const counts = new Map<string, number>();                    
      37 -  for (const page of pages) {                                  
      38 -    const lines = new Set(                                     
      39 -      page                                                     
      40 -        .split("\n")                                           
     … 114 more lines (ctrl+o to expand)

● Parse tests pass (34/34). Next: moving createShutdown to @nexus/shared/node so
  the API and worker share it.

  Searched for 1 pattern (ctrl+o to expand)

● Bash(mv services/api/src/shutdown.ts packages/shared/src/shutdown.ts && mv
      services/api/src/shutdown.test.ts packages/shared/src/shutdown.test.ts &&
      sed -i 's#import…)
  ⎿  import { mkdirSync } from "node:fs";
     import { join } from "node:path";
     import {
     … +16 lines (ctrl+o to expand)
  ⎿  Updated packages\shared\src\node.ts (+1 -0)
      4  export * from "./db/repositories.js";
      5  export * from "./logger.js";
      6  export * from "./queue.js";
      7 +export * from "./shutdown.js";                                  
  ⎿  Created packages\shared\src\shutdown.test.ts (+87 -0)
       1 +import { describe, expect, it, vi } from "vitest";             
       2 +import { createLogger } from "./logger.js";                    
       3 +import { createShutdown } from "./shutdown.js";                
       4 +                                                               
       5 +function capture() {                                           
       6 +  const lines: Record<string, unknown>[] = [];                 
       7 +  const stream = {                                             
       8 +    write: (chunk: string) => lines.push(JSON.parse(chunk) as R
         +ecord<string, unknown>),                                       
       9 +  };                                                           
      10 +  return { lines, logger: createLogger("api", "info", stream) }
         +;                                                              
      11 +}                                                              
      12 +                                                               
      13 +describe("createShutdown", () => {                             
      14 +  it("closes the steps in order, once, then exits 0", async () 
         +=> {                                                           
      15 +    const order: string[] = [];                                
      16 +    const exit = vi.fn();                                      
      17 +    const { logger, lines } = capture();                       
      18 +    const shutdown = createShutdown({                          
      19 +      logger,                                                  
      20 +      exit,                                                    
      21 +      steps: [                                                 
      22 +        ["reconciler", () => void order.push("reconciler")],   
      23 +        ["http", async () => void order.push("http")],         
      24 +        ["queue", async () => void order.push("queue")],       
      25 +        ["db", () => void order.push("db")],                   
      26 +      ],                                                       
      27 +    });                                                        
      28 +                                                               
      29 +    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]
         +);                                                             
      30 +                                                               
      31 +    expect(order).toEqual(["reconciler", "http", "queue", "db"]
         +);                                                             
      32 +    expect(exit).toHaveBeenCalledTimes(1);                     
      33 +    expect(exit).toHaveBeenCalledWith(0);                      
      34 +    expect(lines[0]).toMatchObject({ msg: "shutting down", sign
         +al: "SIGTERM" });                                              
      35 +    expect(lines.at(-1)).toMatchObject({ msg: "shutdown complet
         +e" });                                                         
      36 +  });                                                          
      37 +                                                               
      38 +  it("logs a failing step and still closes the rest", async () 
         +=> {                                                           
      39 +    const order: string[] = [];                                
      40 +    const exit = vi.fn();                                      
     … 47 more lines (ctrl+o to expand)
  ⎿  Created packages\shared\src\shutdown.ts (+47 -0)
       1 +import type { Logger } from "./logger.js";                     
       2 +                                                               
       3 +export type ShutdownStep = [name: string, close: () => void | P
         +romise<void>];                                                 
       4 +                                                               
       5 +export interface ShutdownDeps {                                
       6 +  logger: Logger;                                              
       7 +  // In order: stop taking work first, close the stores the wor
         +k writes to last.                                              
       8 +  steps: ShutdownStep[];                                       
       9 +  exit: (code: number) => void;                                
      10 +  forceAfterMs?: number;                                       
      11 +}                                                              
      12 +                                                               
      13 +export function createShutdown({                               
      14 +  logger,                                                      
      15 +  steps,                                                       
      16 +  exit,                                                        
      17 +  forceAfterMs = 10_000,                                       
      18 +}: ShutdownDeps): (signal: string) => Promise<void> {          
      19 +  let started: Promise<void> | undefined;                      
      20 +                                                               
      21 +  async function run(signal: string): Promise<void> {          
      22 +    logger.info({ signal }, "shutting down");                  
      23 +    // A hung close (a stuck request, redis not answering) must
         + not keep the container from stopping.                         
      24 +    const force = setTimeout(() => {                           
      25 +      logger.error({ forceAfterMs }, "shutdown timed out, forci
         +ng exit");                                                     
      26 +      exit(1);                                                 
      27 +    }, forceAfterMs);                                          
      28 +    force.unref();                                             
      29 +                                                               
      30 +    // One failing close shouldn't leave the others open.      
      31 +    for (const [name, close] of steps) {                       
      32 +      try {                                                    
      33 +        await close();                                         
      34 +        logger.info(`${name} closed`);                         
      35 +      } catch (err) {                                          
      36 +        logger.error({ err }, `${name} close failed`);         
      37 +      }                                                        
      38 +    }                                                          
      39 +                                                               
      40 +    clearTimeout(force);                                       
     … 7 more lines (ctrl+o to expand)
  ⎿  Updated services\api\src\index.ts (+8 -2)
       1  import { mkdirSync } from "node:fs";
       2  import { join } from "node:path";
       3 -import { createLogger, LATEST_VERSION, loadConfig, migrate, ope
         -nDb } from "@nexus/shared/node";                               
       3 +import {                                                       
       4 +  createLogger,                                                
       5 +  createShutdown,                                              
       6 +  LATEST_VERSION,                                              
       7 +  loadConfig,                                                  
       8 +  migrate,                                                     
       9 +  openDb,                                                      
      10 +} from "@nexus/shared/node";                                   
      11  import { BullMqJobQueue } from "./queue.js";
      12  import { startReconciler } from "./reconciler.js";
      13  import { buildServer } from "./server.js";
       7 -import { createShutdown } from "./shutdown.js";                
      14  
      15  const config = loadConfig();
      16  const logger = createLogger("api", config.LOG_LEVEL);
  ⎿  Deleted services\api\src\shutdown.test.ts (+0 -87)
       1 -import { describe, expect, it, vi } from "vitest";             
       2 -import { createLogger } from "@nexus/shared/node";             
       3 -import { createShutdown } from "./shutdown.js";                
       4 -                                                               
       5 -function capture() {                                           
       6 -  const lines: Record<string, unknown>[] = [];                 
       7 -  const stream = {                                             
       8 -    write: (chunk: string) => lines.push(JSON.parse(chunk) as R
         -ecord<string, unknown>),                                       
       9 -  };                                                           
      10 -  return { lines, logger: createLogger("api", "info", stream) }
         -;                                                              
      11 -}                                                              
      12 -                                                               
      13 -describe("createShutdown", () => {                             
      14 -  it("closes the steps in order, once, then exits 0", async () 
         -=> {                                                           
      15 -    const order: string[] = [];                                
      16 -    const exit = vi.fn();                                      
      17 -    const { logger, lines } = capture();                       
      18 -    const shutdown = createShutdown({                          
      19 -      logger,                                                  
      20 -      exit,                                                    
      21 -      steps: [                                                 
      22 -        ["reconciler", () => void order.push("reconciler")],   
      23 -        ["http", async () => void order.push("http")],         
      24 -        ["queue", async () => void order.push("queue")],       
      25 -        ["db", () => void order.push("db")],                   
      26 -      ],                                                       
      27 -    });                                                        
      28 -                                                               
      29 -    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]
         -);                                                             
      30 -                                                               
      31 -    expect(order).toEqual(["reconciler", "http", "queue", "db"]
         -);                                                             
      32 -    expect(exit).toHaveBeenCalledTimes(1);                     
      33 -    expect(exit).toHaveBeenCalledWith(0);                      
      34 -    expect(lines[0]).toMatchObject({ msg: "shutting down", sign
         -al: "SIGTERM" });                                              
      35 -    expect(lines.at(-1)).toMatchObject({ msg: "shutdown complet
         -e" });                                                         
      36 -  });                                                          
      37 -                                                               
      38 -  it("logs a failing step and still closes the rest", async () 
         -=> {                                                           
      39 -    const order: string[] = [];                                
      40 -    const exit = vi.fn();                                      
     … 47 more lines (ctrl+o to expand)
  ⎿  … 1 more file changed
● Now analyzeDocument, test first:

● Write(services\worker\src\pipeline\analyze.test.ts)
  ⎿  Wrote 61 lines to services\worker\src\pipeline\analyze.test.ts
      1 import { mkdtemp, rm, writeFile } from "node:fs/promises";
      2 import { tmpdir } from "node:os";
      3 import { join } from "node:path";
      4 import { afterAll, beforeAll, describe, expect, it, vi } from "vi
        test";
      5 import type { Stage } from "@nexus/shared";
      6 import { makeDeps } from "../test-support/fixtures.js";
      7 import { makePdf } from "../test-support/pdf.js";
      8 import { analyzeDocument } from "./analyze.js";
      9 import { PermanentError } from "./errors.js";
     … +63 lines (ctrl+o to expand)

● Write(services\worker\src\pipeline\analyze.ts)
  ⎿  Added 37 lines, removed 12 lines
       1 -import { insertEvent } from "@nexus/shared/node";              
       2 -import type { StageContext } from "./stage.js";                
       1 +import { resolve } from "node:path";                           
       2 +import type { Stage } from "@nexus/shared";                    
       3 +import type { WorkerDeps } from "../deps.js";                  
       4 +import { parseDocument, type ParsedDocument } from "../parse/in
         +dex.js";                                                       
       5  
       6 +export interface AnalyzeInput {                                
       7 +  // As stored on the document row: relative to UPLOAD_DIR.    
       8 +  path: string;                                                
       9 +  mime: string;                                                
      10 +  filename: string;                                            
      11 +}                                                              
      12 +                                                               
      13 +// No db or queue: processJob owns those, and the eval script c
         +alls this directly without either.                             
      14 +export type AnalyzeDeps = Pick<WorkerDeps, "config" | "logger" 
         +| "provider" | "clock">;                                       
      15 +                                                               
      16 +export type StageRunner = <T>(stage: Stage, fn: () => Promise<T
         +>) => Promise<T>;                                              
      17 +                                                               
      18 +export interface AnalyzeHooks {                                
      19 +  // processJob wraps runStage here to get stage tracking and e
         +vents; the eval script needs neither.                          
      20 +  onStage?: StageRunner;                                       
      21 +}                                                              
      22 +                                                               
      23  export interface AnalysisResult {
      24 +  parsed: ParsedDocument;                                      
      25 +  extraction: null;                                            
      26    needsReview: boolean;
      27  }
      28  
       8 -// Placeholder until parsing and extraction exist. Those stages
         - will each go through runStage here.                           
       9 -export function analyze({ deps, documentId, run }: StageContext
         -): Promise<AnalysisResult> {                                   
      10 -  insertEvent(deps.db, {                                       
      11 -    document_id: documentId,                                   
      12 -    run,                                                       
      13 -    stage: "extracting",                                       
      14 -    outcome: "info",                                           
      15 -    message: "extraction not implemented yet",                 
      16 -  });                                                          
      17 -  return Promise.resolve({ needsReview: true });               
      29 +const runDirectly: StageRunner = (_stage, fn) => fn();         
      30 +                                                               
      31 +export async function analyzeDocument(                         
      32 +  input: AnalyzeInput,                                         
      33 +  deps: AnalyzeDeps,                                           
      34 +  hooks: AnalyzeHooks = {},                                    
      35 +): Promise<AnalysisResult> {                                   
      36 +  const onStage = hooks.onStage ?? runDirectly;                
      37 +  const path = resolve(deps.config.UPLOAD_DIR, input.path);    
      38 +                                                               
      39 +  const parsed = await onStage("parsing", () => parseDocument(p
         +ath, input.mime, deps.logger));                                
      40 +                                                               
      41 +  // Extraction is not built yet, and with nothing extracted th
         +ere is nothing to trust unreviewed.                            
      42 +  return { parsed, extraction: null, needsReview: true };      
      43  }

● Now updating processJob and its tests to use the real file path.

  Read 2 files (ctrl+o to expand)

● Bash(python - <<'PYEOF'
      p='services/worker/src/pipeline/run.ts';
      s=open(p,encoding='utf8').read()…)
  ⎿        Tests  66 passed (66)
  ⎿  Updated packages\shared\src\index.ts (+4 -4)
      1 -export * from "./status.js";                                    
      2 -export * from "./formats.js";                                   
      3 -export * from "./schemas/extraction.js";                        
      4 -export * from "./schemas/api.js";                               
      1 +export * from "./status.js";                                    
      2 +export * from "./formats.js";                                   
      3 +export * from "./schemas/extraction.js";                        
      4 +export * from "./schemas/api.js";                               
  ⎿  Updated packages\shared\src\status.ts (+42 -42)
       1 -export const DocumentStatus = {                                
       2 -  queued: "queued",                                            
       3 -  processing: "processing",                                    
       4 -  completed: "completed",                                      
       5 -  failed: "failed",                                            
       6 -} as const;                                                    
       7 -export type DocumentStatus = (typeof DocumentStatus)[keyof type
         -of DocumentStatus];                                            
       8 -                                                               
       9 -export const Stage = {                                         
      10 -  parsing: "parsing",                                          
      11 -  extracting: "extracting",                                    
      12 -  validating: "validating",                                    
      13 -} as const;                                                    
      14 -export type Stage = (typeof Stage)[keyof typeof Stage];        
      15 -                                                               
      16 -export const ErrorCode = {                                     
      17 -  UNSUPPORTED_TYPE: "UNSUPPORTED_TYPE",                        
      18 -  FILE_TOO_LARGE: "FILE_TOO_LARGE",                            
      19 -  NO_TEXT_LAYER: "NO_TEXT_LAYER",                              
      20 -  EMPTY_DOCUMENT: "EMPTY_DOCUMENT",                            
      21 -  TEXT_TOO_LONG: "TEXT_TOO_LONG",                              
      22 -  PARSE_ERROR: "PARSE_ERROR",                                  
      23 -  EXTRACTION_INVALID: "EXTRACTION_INVALID",                    
      24 -  LLM_UNAVAILABLE: "LLM_UNAVAILABLE",                          
      25 -  LLM_AUTH: "LLM_AUTH",                                        
      26 -  INTERNAL: "INTERNAL",                                        
      27 -} as const;                                                    
      28 -export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCo
         -de];                                                           
      29 -                                                               
      30 -export const TERMINAL_STATUSES: readonly DocumentStatus[] = [  
      31 -  DocumentStatus.completed,                                    
      32 -  DocumentStatus.failed,                                       
      33 -];                                                             
      34 -                                                               
      35 -export const ALLOWED_TRANSITIONS = {                           
      36 -  queued: [DocumentStatus.processing, DocumentStatus.failed],  
      37 -  // bullmq can redeliver a stalled job, so a document that is 
         -already processing gets picked up again.                       
      38 -  processing: [DocumentStatus.processing, DocumentStatus.comple
         -ted, DocumentStatus.failed],                                   
      39 -  // Terminal states only go back to queued, which is the retry
         - path.                                                         
      40 -  completed: [DocumentStatus.queued],                          
     … 44 more lines (ctrl+o to expand)
  ⎿  Updated services\api\src\services\upload.ts (+132 -133)
        1 -import { createHash, randomUUID } from "node:crypto";         
        2 -import { createWriteStream } from "node:fs";                  
        3 -import { mkdir, rename, rm } from "node:fs/promises";         
        4 -import { join } from "node:path";                             
        5 -import { Transform, type Readable } from "node:stream";       
        6 -import { pipeline } from "node:stream/promises";              
        7 -import type { MultipartFile } from "@fastify/multipart";      
        8 -import type { FastifyBaseLogger } from "fastify";             
        9 -import { fileTypeFromFile } from "file-type";                 
       10 -import { ErrorCode, MIME_FORMATS, type UploadResponse } from "
          -@nexus/shared";                                               
       11 -import { createDocument, findCompletedBySha256, type Config, t
          -ype Db } from "@nexus/shared/node";                           
       12 -import type { JobQueue } from "../queue.js";                  
       13 -import { enqueueOrDefer } from "./enqueue.js";                
       14 -                                                              
       15 -                                                              
       16 -export interface UploadDeps {                                 
       17 -  db: Db;                                                     
       18 -  queue: JobQueue;                                            
       19 -  config: Pick<Config, "UPLOAD_DIR" | "MAX_UPLOAD_MB">;       
       20 -}                                                             
       21 -                                                              
       22 -export type AcceptedFile = UploadResponse["accepted"][number];
       23 -export type RejectedFile = UploadResponse["rejected"][number];
       24 -export type UploadOutcome = { accepted: AcceptedFile } | { rej
          -ected: RejectedFile };                                        
       25 -                                                              
       26 -type LogOutcome = "queued" | "duplicate" | "queue_unavailable"
          - | "too_large" | "unsupported_type";                          
       27 -                                                              
       28 -// sha256 and size in the same pass that writes the file, so a
          - 20mb upload is never held in memory.                         
       29 -async function writeHashed(                                   
       30 -  source: Readable,                                           
       31 -  path: string,                                               
       32 -): Promise<{ sha256: string; size: number }> {                
       33 -  const hash = createHash("sha256");                          
       34 -  let size = 0;                                               
       35 -  const tap = new Transform({                                 
       36 -    transform(chunk: Buffer, _encoding, callback) {           
       37 -      hash.update(chunk);                                     
       38 -      size += chunk.length;                                   
       39 -      callback(null, chunk);                                  
       40 -    },                                                        
     … 225 more lines (ctrl+o to expand)
  ⎿  Updated services\worker\src\parse\index.test.ts (+4 -1)
      35    await writeFile(path("broken.docx"), "not a zip");
      36    await writeFile(path("empty.docx"), await makeDocx([]));
      37    // 49 non-whitespace chars spread over paragraphs with lots o
          f spaces.
      38 -  await writeFile(path("almost-empty.docx"), await makeDocx(["a
         -".repeat(20), "  b b  ".repeat(10), "c".repeat(9)]));          
      38 +  await writeFile(                                             
      39 +    path("almost-empty.docx"),                                 
      40 +    await makeDocx(["a".repeat(20), "  b b  ".repeat(10), "c".r
         +epeat(9)]),                                                    
      41 +  );                                                           
      42    await writeFile(path("just-enough.docx"), await makeDocx(["d"
          .repeat(50)]));
      43    await writeFile(path("broken.pdf"), "not a pdf");
      44  });
  ⎿  Updated services\worker\src\parse\index.ts (+70 -70)
       1 -import { readFile } from "node:fs/promises";                   
       2 -import { ErrorCode, MIME_FORMATS, type DocumentFormat } from "@
         -nexus/shared";                                                 
       3 -import type { Logger } from "@nexus/shared/node";              
       4 -import { PermanentError } from "../pipeline/errors.js";        
       5 -import { parseDocx } from "./docx.js";                         
       6 -import { normalizePages, normalizeText, stripPageMarkers } from
         - "./normalize.js";                                             
       7 -import { parsePdf } from "./pdf.js";                           
       8 -                                                               
       9 -export interface ParsedDocument {                              
      10 -  format: DocumentFormat;                                      
      11 -  // pdf text carries [[page N]] markers, docx text has none si
         -nce docx has no fixed pages.                                   
      12 -  text: string;                                                
      13 -  pageCount: number | null;                                    
      14 -  // Without the page markers, so it reflects the document and 
         -not our formatting.                                            
      15 -  charCount: number;                                           
      16 -}                                                              
      17 -                                                               
      18 -// Roughly 100k tokens. Past this a contract is more likely a m
         -is-upload than something worth the cost.                       
      19 -export const MAX_TEXT_CHARS = 400_000;                         
      20 -                                                               
      21 -// Same bar as the pdf text layer check. Below it there is noth
         -ing worth sending to the model.                                
      22 -const MIN_DOCX_CHARS = 50;                                     
      23 -                                                               
      24 -async function extract(                                        
      25 -  format: DocumentFormat,                                      
      26 -  path: string,                                                
      27 -  logger: Logger,                                              
      28 -): Promise<{ text: string; pageCount: number | null }> {       
      29 -  if (format === "pdf") {                                      
      30 -    const { totalPages, pages } = await parsePdf(await readFile
         -(path));                                                       
      31 -    return { text: normalizePages(pages), pageCount: totalPages
         - };                                                            
      32 -  }                                                            
      33 -  return { text: normalizeText(await parseDocx(path, logger)), 
         -pageCount: null };                                             
      34 -}                                                              
      35 -                                                               
      36 -export async function parseDocument(                           
      37 -  path: string,                                                
      38 -  mime: string,                                                
      39 -  logger: Logger,                                              
      40 -): Promise<ParsedDocument> {                                   
     … 100 more lines (ctrl+o to expand)
  ⎿  … 4 more files changed

● Worker tests pass (66/66). Now the worker entrypoint:

● Write(services\worker\src\index.ts)
  ⎿  Wrote 65 lines to services\worker\src\index.ts
       1 import { Worker } from "bullmq";
       2 import {
       3   assertMigrated,
       4   createLogger,
       5   createShutdown,
       6   ExtractJobPayload,
       7   loadConfig,
       8   openDb,
       9   QUEUE_NAME,
      10 } from "@nexus/shared/node";
     … +66 lines (ctrl+o to expand)

  Ran 1 shell command (ctrl+o to expand)

● The unmigrated-DB boot exits 1 with a clear message. Fixing the type error
  (db.close() returns the Database):

● Bash(sed -i 's/\["db", () => db.close()\],/["db", () => {\n
      db.close();\n      }],/' services/worker/src/index.ts && npx prettier
      --write services/worker/src/…)
  ⎿  44:      ["db", () => db.close()],
  ⎿  Updated services\worker\src\index.ts (+6 -1)
      54      forceAfterMs: config.LLM_TIMEOUT_MS + 30_000,
      55      steps: [
      56        ["worker", () => worker.close()],
      57 -      ["db", () => db.close()],                                
      57 +      [                                                        
      58 +        "db",                                                  
      59 +        () => {                                                
      60 +          db.close();                                          
      61 +        },                                                     
      62 +      ],                                                       
      63      ],
      64    });
      65    process.once("SIGTERM", () => void shutdown("SIGTERM"));

● Typecheck passes. Next, booting against a migrated DB with Redis down, to
  confirm connection errors go through pino and nothing goes to the console:

  Ran 1 shell command (ctrl+o to expand)

● Connection errors go through pino and nothing reaches stderr. SIGTERM isn't
  tested yet (more on that at the end). Now tsx and the sample script:

● Bash(npm install -D tsx@^4.23.15 2>&1 | grep -v allow-scripts | tail -2 &&
      grep -n tsx package.json)
  ⎿  Run `npm audit` for details.
     29:    "tsx": "^4.23.15",
  ⎿  Updated package.json (+1 -0)
      26      "concurrently": "^10.0.6",
      27      "eslint": "^10.12.0",
      28      "prettier": "~3.9.9",
      29 +    "tsx": "^4.23.15",                                         
      30      "typescript": "~6.0.3",
      31      "typescript-eslint": "^8.71.1",
      32      "vite": "^8.3.4",
  ⎿  … 1 more file changed

● Write(scripts\make-test-files.ts)
  ⎿  Wrote 278 lines to scripts\make-test-files.ts
       1 // Generates the files in samples/ for trying the app by hand. A
       2 // Nexus Corp is the customer throughout. Run with `npm run test
         -files`.
       3 import { mkdir, writeFile } from "node:fs/promises";
       5 import { fileURLToPath } from "node:url";
       6 import { crc32 } from "node:zlib";
         ;
       8 import PDFDocument from "pdfkit";
       9 
         l));
     … +330 lines (ctrl+o to expand)

  Ran 1 shell command (ctrl+o to expand)

● As expected, the PDFs and plain zip are consistent across runs, while the two
  docx files differ. Now I'll run each sample through the real parser and use
  file-type to check the two files the API should reject.

  Ran 1 shell command (ctrl+o to expand)

● Every sample behaves as intended except one gap in the 5-page PDF: the header
  is stripped, but the Confidential | Page N footer isn't. More on that at the
  end. Running the full checks:

● Bash(cd /e/contract-analysis-pipeline && npx prettier --write scripts
      package.json tsconfig.test.json >/dev/null; npm run typecheck 2>&1 | grep
      -E "error|TS[0-9]" |…)
  ⎿  services/worker/src/pipeline/analyze.test.ts(50,62): error TS2322: Typ
     e 'Mock<(<T>(stage: Stage, fn: () => Promise<T>) => Promise<T>)>' is n
     ot assignable to type 'StageRunner | undefined'.
     … +16 lines (ctrl+o to expand)
  ⎿  Updated scripts\make-test-files.ts (+16 -10)
      41  function writeInMargin(doc: PDFKit.PDFDocument, text: string, y
          : number): void {
      42    const bottom = doc.page.margins.bottom;
      43    doc.page.margins.bottom = 0;
      44 -  doc                                                          
      45 -    .fontSize(9)                                               
      46 -    .text(text, doc.page.margins.left, y, {                    
      47 -      width: doc.page.width - doc.page.margins.left - doc.page.
         -margins.right,                                                 
      48 -      align: "center",                                         
      49 -      lineBreak: false,                                        
      50 -    });                                                        
      44 +  doc.fontSize(9).text(text, doc.page.margins.left, y, {       
      45 +    width: doc.page.width - doc.page.margins.left - doc.page.ma
         +rgins.right,                                                   
      46 +    align: "center",                                           
      47 +    lineBreak: false,                                          
      48 +  });                                                          
      49    doc.page.margins.bottom = bottom;
      50  }
      51  
     ...
      135        for (let row = 0; row < 28; row++) {
      136          const y = 140 + row * 22;
      137          const width = row % 5 === 4 ? 260 : 420;
      140 -        doc.moveTo(80, y).lineTo(80 + width, y).lineWidth(6).s
          -troke("#bbbbbb");                                             
      138 +        doc                                                   
      139 +          .moveTo(80, y)                                      
      140 +          .lineTo(80 + width, y)                              
      141 +          .lineWidth(6)                                       
      142 +          .stroke("#bbbbbb");                                 
      143        }
      144      }
      145    });
     ...
      160          "registered in Norway (the Supplier), and Nexus Corp (
           the Customer).",
      161      ),
      162      heading("1. Scope"),
      161 -    para("The Supplier will provide cleaning and facility main
          -tenance for the Customer's Oslo office."),                    
      163 +    para(                                                     
      164 +      "The Supplier will provide cleaning and facility mainten
          +ance for the Customer's Oslo office.",                        
      165 +    ),                                                        
      166      heading("2. Term and renewal"),
      167      para(
      168        "The Agreement runs from 1 July 2026 for 12 months and t
           hen renews automatically for further " +
     … 10 more lines (ctrl+o to expand)
  ⎿  (timeout 5m)

  Read 1 file (ctrl+o to expand)

● Update(services\worker\src\pipeline\analyze.test.ts)
  ⎿  Added 2 lines, removed 2 lines
      42  
      43    it("runs parsing through onStage", async () => {
      44      const stages: Stage[] = [];
      45 -    const onStage = vi.fn(<T>(stage: Stage, fn: () => Promise<T
         ->) => {                                                        
      45 +    const onStage: StageRunner = (stage, fn) => {              
      46        stages.push(stage);
      47        return fn();
      48 -    });                                                        
      48 +    };                                                         
      49  
      50      await analyzeDocument(input("two-pages.pdf"), setup(), { on
          Stage });
      51  

● Bash(sed -i 's/import { afterAll, beforeAll, describe, expect, it, vi } from
      "vitest";/import { afterAll, beforeAll, describe, expect, it } from
      "vitest";/; s/import…)
  ⎿   Test Files  22 passed (22)
           Tests  183 passed (183)
     All matched files use Prettier code style!
  ⎿  Updated services\worker\src\pipeline\analyze.test.ts (+2 -2)
       1  import { mkdtemp, rm, writeFile } from "node:fs/promises";
       2  import { tmpdir } from "node:os";
       3  import { join } from "node:path";
       4 -import { afterAll, beforeAll, describe, expect, it, vi } from "
         -vitest";                                                       
       4 +import { afterAll, beforeAll, describe, expect, it } from "vite
         +st";                                                           
       5  import type { Stage } from "@nexus/shared";
       6  import { makeDeps } from "../test-support/fixtures.js";
       7  import { makePdf } from "../test-support/pdf.js";
       8 -import { analyzeDocument } from "./analyze.js";                
       8 +import { analyzeDocument, type StageRunner } from "./analyze.js
         +";                                                             
       9  import { PermanentError } from "./errors.js";
      10  
      11  const PDF = "application/pdf";
  ⎿  (timeout 5m)

  Ran 2 shell commands, wrote 1 memory (ctrl+o to expand)

● Everything in this step is done and passing, except two problems that need
  your call: the docx samples aren't deterministic, and the footer on the 5-page
  PDF doesn't get stripped. Typecheck, lint and prettier are clean, and tests
  are 183/183 passing (up from 173).

  Problems:
  1. docx output changes on every run. docx 9.9 writes the current time into
     core.xml and into every zip entry date, and has no option to set them. The
     PDFs and not-a-docx.docx are identical every run (pdfkit just needed
     CreationDate fixed).
     - A (my pick): in the script only, swap the global Date for a fixed clock
       while docx builds the file. I tested it and the output becomes identical.
       It's a workaround, which is why I'm asking first.
     - B: accept that the two docx files change on every regeneration.
  2. Confidential | Page N isn't stripped on the 5-page PDF. The header is
     removed. The footer is different on every page, so it never counts as
     repeated, and it isn't a bare page-number line either. It also shows up at
     the top of each page's text, because pdf.js reads it in the order pdfkit
     drew it.
     - Fix (my pick): replace digits with # only when counting repeats, so all
       five footers count as the same Confidential | Page # line. About 2 lines
       plus a test.

  Done:
  1. Parsing changes:
     - Fake [[page N]] markers are stripped before ours are added, including
       spacing and case variants. A marker alone on a line takes the line with
       it.
     - A DOCX with under 50 non-whitespace characters fails with the new
       EMPTY_DOCUMENT code.
     - The mime → format map is now MIME_FORMATS in
       packages/shared/src/formats.ts, used by the API upload and the worker
       parser.
  2. analyzeDocument (pipeline/analyze.ts): resolves the path against UPLOAD_DIR
     and runs parsing through onStage. It has no db or queue. processJob passes
     runStage in as onStage, along with a logger that carries documentId.
  3. Worker index.ts: your Worker options as given. It exits 1 with Database 
     schema is at version 0, expected 1. Start the api first so it can migrate.
     Failed and error events are logged through pino. I tested with Redis down:
     everything was JSON on stdout and stderr stayed empty.
  4. Samples: npm run test-files writes all 8 files. I ran each one through the
     real parser:
     - scanned-no-text.pdf → NO_TEXT_LAYER and empty.docx → EMPTY_DOCUMENT.
     - In fake-markers.pdf, the [[page 7]] is gone from the output.
     - File-type detection reports not-a-pdf.pdf as unknown and not-a-docx.docx
       as application/zip, so the API will reject both.
  5. New tests: marker stripping, empty DOCX, the real 2-page PDF through
     processJob (completed, needs_review, parsing event ok). Also not covered
     before: a blank PDF failing for good with an error event on parsing, and a
     missing upload file → PARSE_ERROR.

  Choices of mine to check:
  - createShutdown moved from the API to @nexus/shared/node, test included, and
    the API imports it from there.
  - The worker's forced shutdown timeout is LLM_TIMEOUT_MS + 30s rather than
    10s, so active jobs can finish. There's a TODO(me) noting that docker
    compose needs a stop_grace_period at least that long.
  - formats.ts is on the eslint browser-safe list. scripts/ is now typechecked
    through tsconfig.test.json.
  - The script uses pdfkit and docx from the worker's dev deps, which npm
    installs at the repo root. I didn't add them to the root package.json.
  - CLAUDE.md lists npm run samples, but you asked for test-files, so that's
    what I used. CLAUDE.md now has the wrong name.

  Not verified: a real job end to end through Redis, and SIGTERM handling,
  because Redis isn't running on this machine. To check it yourself: start Redis
  and the API, run node services/worker/dist/index.js, upload
  samples/SamplePDFs/contract-2-pages.pdf, then Ctrl+C the worker.

  Reply A or B for the docx, and yes or no on the footer fix. The two docx
  samples are the only files that will change.

✻ Worked for 9m 15s · done 7:11 AM

❯ B for docx, not worth monkeypatching Date, the files are committed once and   
  tests make their own fixtures. yes to the footer fix with digits -> # when    
  counting repeats, real contracts have exactly that kind of footer.            
                                                                                
  shutdown timeout is right. make the compose note a normal comment, not        
  TODO(me): stop_grace_period needs to be > LLM_TIMEOUT_MS + 30s, so 4m with    
  the defaults. add npm run test-files to the commands in CLAUDE.md and keep    
  samples, that one comes later. rest is fine, run everything once more         
  Read 1 file (ctrl+o to expand)

● Test first:

● Update(services\worker\src\parse\normalize.test.ts)
  ⎿  Added 8 lines
      54      );
      55    });
      56  
      57 +  it("drops footers that only differ in their numbers", () => {
      58 +    const pages = [1, 2, 3, 4, 5].map((n) => `Confidential | Pa
         +ge ${n} of 5\nbody ${"x".repeat(n)}`);                         
      59 +                                                               
      60 +    expect(normalizePages(pages)).toBe(                        
      61 +      [1, 2, 3, 4, 5].map((n) => `[[page ${n}]]\nbody ${"x".rep
         +eat(n)}`).join("\n\n"),                                        
      62 +    );                                                         
      63 +  });                                                          
      64 +                                                               
      65    it("keeps lines that repeat on fewer than 60% of pages", () =
          > {
      66      const pages = ["Schedule A\nx", "Schedule A\ny", "z", "w"];
      67      expect(normalizePages(pages)).toContain("Schedule A");

  Ran 1 shell command (ctrl+o to expand)

● Bash(python - <<'PYEOF'
      p='services/worker/src/parse/normalize.ts';
      s=open(p,encoding='utf8').read()…)
  ⎿  <stdin>:6: SyntaxWarning: invalid escape sequence '\d'
     1:// Lines on at least this share of pages are running headers or foot
     ers, not content.
     … +14 lines (ctrl+o to expand)
  ⎿  Updated CLAUDE.md (+46 -45)
       1 -# CLAUDE.md                                                    
       2 -                                                               
       3 -Take-home: upload vendor contracts (pdf/docx), process them asy
         -nc, extract structured data + risk clauses with an llm, show it
         - on a dashboard. Task is in docs/TASK.md.                      
       4 -                                                               
       5 -## how I want to work                                          
       6 -- I give instructions step by step. Do the step, nothing more, 
         -don't jump ahead.                                              
       7 -- If a lib doesn't behave the way I described, stop and tell me
         -. Don't quietly work around it.                                
       8 -- Don't redesign stuff I already decided. If you think somethin
         -g's wrong, say it first.                                       
       9 -- Packages + versions I name in a step are approved. Anything I
         - didn't mention, ask first and tell me why.                    
      10 -- After changes run `npm run typecheck && npm run lint && npm t
         -est` and tell me what actually happened. Never skip or loosen a
         - test to get green.                                            
      11 -- Don't touch git: no commits, branches, pushes or PRs. I revie
         -w the diff and commit myself. git status / diff / log are fine.
      12 -                                                               
      13 -## layout                                                      
      14 -- packages/shared: types + zod schemas used across services. `@
         -nexus/shared` is browser safe, node-only stuff goes in `@nexus/
         -shared/node`                                                   
      15 -- services/api: fastify, only fast work (upload, validate, enqu
         -eue, read)                                                     
      16 -- services/worker: bullmq consumer, parsing + llm + persisting 
      17 -- apps/web: react + vite                                       
      18 -                                                               
      19 -## versions / gotchas                                          
      20 -- node 24                                                      
      21 -- typescript ~6.0.3, NOT 7 (typescript-eslint doesn't support i
         -t yet)                                                         
      22 -- bullmq 6 needs ioredis installed explicitly                  
      23 -- pdfs with unpdf, not pdf-parse (pdf.js version clash). docx w
         -ith mammoth                                                    
      24 -- zod 4 (z.toJSONSchema, z.prettifyError, z.flattenError)      
      25 -- better-sqlite3, WAL mode, raw sql, no orm                    
      26 -- llm sdks with maxRetries: 0, bullmq is the only thing that re
         -tries                                                          
      27 -                                                               
      28 -## code                                                        
      29 -- strict TS, ESM, .js extensions in relative imports           
      30 -- no any, no `!`, no console.log (pino, include documentId when
         - there is one)                                                 
      31 -- zod at every boundary: env, http, llm output, job payloads, j
         -son read from db                                               
      32 -- status changes only through transitionStatus                 
      33 -- model extracts facts, code does date math. every value has a 
         -quote that gets verified against the doc text                  
      34 -- document text is untrusted, it only goes inside the <document
         -> block in the prompt                                          
      35 -- no network in unit tests, use MockProvider or stub fetch     
      36 -                                                               
      37 -## docs / readme                                               
      38 -- first person, plain, no marketing words, no em dashes        
      39 -- comments explain why, not what                               
      40 -- put TODO(me) where it needs my opinion, don't make it up     
     … 52 more lines (ctrl+o to expand)
  ⎿  Updated services\worker\src\index.ts (+71 -70)
       1 -import { Worker } from "bullmq";                               
       2 -import {                                                       
       3 -  assertMigrated,                                              
       4 -  createLogger,                                                
       5 -  createShutdown,                                              
       6 -  ExtractJobPayload,                                           
       7 -  loadConfig,                                                  
       8 -  openDb,                                                      
       9 -  QUEUE_NAME,                                                  
      10 -} from "@nexus/shared/node";                                   
      11 -import type { WorkerDeps } from "./deps.js";                   
      12 -import { processJob } from "./pipeline/run.js";                
      13 -                                                               
      14 -const config = loadConfig();                                   
      15 -const logger = createLogger("worker", config.LOG_LEVEL);       
      16 -                                                               
      17 -function documentIdOf(data: unknown): string | undefined {     
      18 -  return ExtractJobPayload.safeParse(data).data?.documentId;   
      19 -}                                                              
      20 -                                                               
      21 -try {                                                          
      22 -  const db = openDb(config.DATABASE_PATH);                     
      23 -  // Only the api migrates. Starting on an old schema would fai
         -l later on some query, so fail here.                           
      24 -  assertMigrated(db);                                          
      25 -                                                               
      26 -  const deps: WorkerDeps = { db, config, logger, provider: null
         -, clock: () => new Date() };                                   
      27 -                                                               
      28 -  const worker = new Worker(QUEUE_NAME, (job) => processJob(job
         -, deps), {                                                     
      29 -    connection: { url: config.REDIS_URL, maxRetriesPerRequest: 
         -null },                                                        
      30 -    concurrency: config.WORKER_CONCURRENCY,                    
      31 -    // Longer than the slowest llm call, so a long job can't lo
         -ok stalled and run twice in parallel.                          
      32 -    lockDuration: config.LLM_TIMEOUT_MS + 60_000,              
      33 -    // A job that crashes a worker twice is failed instead of t
         -aking down the next one too.                                   
      34 -    maxStalledCount: 1,                                        
      35 -  });                                                          
      36 -                                                               
      37 -  worker.on("failed", (job, err) => {                          
      38 -    logger.warn(                                               
      39 -      { jobId: job?.id, documentId: documentIdOf(job?.data), at
         -temptsMade: job?.attemptsMade, err },                          
      40 -      "job failed",                                            
     … 101 more lines (ctrl+o to expand)
  ⎿  Updated services\worker\src\parse\normalize.ts (+87 -80)
       1 -// Lines on at least this share of pages are running headers or
         - footers, not content.                                         
       2 -const REPEATED_LINE_SHARE = 0.6;                               
       3 -// With 1 or 2 pages a repeated line is as likely to be content
         - as a header.                                                  
       4 -const MIN_PAGES_FOR_REPEAT_CHECK = 3;                          
       5 -const MIN_HEADER_LENGTH = 3;                                   
       6 -const MAX_HEADER_LENGTH = 80;                                  
       7 -const PAGE_NUMBER_LINE = /^(?:page\s+\d+(?:\s+of\s+\d+)?|\d+)$/
         -i;                                                             
       8 -const PAGE_MARKER_LINE = /^\[\[page \d+\]\]\n/gm;              
       9 -// Looser than our own marker on purpose: anything a page looku
         -p might mistake for one goes.                                  
      10 -const UNTRUSTED_MARKER = String.raw`\[\[[^\S\n]*page[^\S\n]*\d+
         -[^\S\n]*\]\]`;                                                 
      11 -const UNTRUSTED_MARKER_LINE = new RegExp(                      
      12 -  String.raw`^[^\S\n]*${UNTRUSTED_MARKER}[^\S\n]*(?:\n|$)`,    
      13 -  "gim",                                                       
      14 -);                                                             
      15 -// The spaces before it go too, so "Clause 4 [[page 7]] applies
         -." doesn't end up with a double space.                         
      16 -const UNTRUSTED_MARKER_INLINE = new RegExp(String.raw`[^\S\n]*$
         -{UNTRUSTED_MARKER}`, "gi");                                    
      17 -                                                               
      18 -function stripUntrustedMarkers(text: string): string {         
      19 -  return text.replace(UNTRUSTED_MARKER_LINE, "").replace(UNTRUS
         -TED_MARKER_INLINE, "");                                        
      20 -}                                                              
      21 -                                                               
      22 -function collapseBlankLines(text: string): string {            
      23 -  return text.replace(/\n{3,}/g, "\n\n").trim();               
      24 -}                                                              
      25 -                                                               
      26 -export function normalizeText(text: string): string {          
      27 -  return collapseBlankLines(                                   
      28 -    text                                                       
      29 -      .replace(/\r\n?/g, "\n")                                 
      30 -      .replace(/\p{Zs}/gu, " ")                                
      31 -      // Before dehyphenating, so "agree-  \nment" still joins.
      32 -      .replace(/[^\S\n]+$/gm, "")                              
      33 -      // Only a lowercase continuation: "Acme-\nCorp" is a real
         - hyphen at a line break.                                       
      34 -      .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2"),                
      35 -  );                                                           
      36 -}                                                              
      37 -                                                               
      38 -function repeatedLines(pages: readonly string[]): Set<string> {
      39 -  const counts = new Map<string, number>();                    
      40 -  for (const page of pages) {                                  
     … 127 more lines (ctrl+o to expand)

  Ran 1 shell command (ctrl+o to expand)

● Regex is intact. Running all checks, then rechecking the 5-page sample:

● Bash(npx prettier --write services/worker/src >/dev/null; npm run typecheck
      2>&1 | grep -E "TS[0-9]"; echo "typecheck exit=${PIPESTATUS[0]}"; npm run
      lint >/dev/null…)
  ⎿  typecheck exit=0
     lint exit=0
      Test Files  22 passed (22)
     … +7 lines (ctrl+o to expand)
  ⎿  Updated services\worker\src\index.ts (+71 -71)
       1 -import { Worker } from "bullmq";                               
       2 -import {                                                       
       3 -  assertMigrated,                                              
       4 -  createLogger,                                                
       5 -  createShutdown,                                              
       6 -  ExtractJobPayload,                                           
       7 -  loadConfig,                                                  
       8 -  openDb,                                                      
       9 -  QUEUE_NAME,                                                  
      10 -} from "@nexus/shared/node";                                   
      11 -import type { WorkerDeps } from "./deps.js";                   
      12 -import { processJob } from "./pipeline/run.js";                
      13 -                                                               
      14 -const config = loadConfig();                                   
      15 -const logger = createLogger("worker", config.LOG_LEVEL);       
      16 -                                                               
      17 -function documentIdOf(data: unknown): string | undefined {     
      18 -  return ExtractJobPayload.safeParse(data).data?.documentId;   
      19 -}                                                              
      20 -                                                               
      21 -try {                                                          
      22 -  const db = openDb(config.DATABASE_PATH);                     
      23 -  // Only the api migrates. Starting on an old schema would fai
         -l later on some query, so fail here.                           
      24 -  assertMigrated(db);                                          
      25 -                                                               
      26 -  const deps: WorkerDeps = { db, config, logger, provider: null
         -, clock: () => new Date() };                                   
      27 -                                                               
      28 -  const worker = new Worker(QUEUE_NAME, (job) => processJob(job
         -, deps), {                                                     
      29 -    connection: { url: config.REDIS_URL, maxRetriesPerRequest: 
         -null },                                                        
      30 -    concurrency: config.WORKER_CONCURRENCY,                    
      31 -    // Longer than the slowest llm call, so a long job can't lo
         -ok stalled and run twice in parallel.                          
      32 -    lockDuration: config.LLM_TIMEOUT_MS + 60_000,              
      33 -    // A job that crashes a worker twice is failed instead of t
         -aking down the next one too.                                   
      34 -    maxStalledCount: 1,                                        
      35 -  });                                                          
      36 -                                                               
      37 -  worker.on("failed", (job, err) => {                          
      38 -    logger.warn(                                               
      39 -      { jobId: job?.id, documentId: documentIdOf(job?.data), at
         -temptsMade: job?.attemptsMade, err },                          
      40 -      "job failed",                                            
     … 102 more lines (ctrl+o to expand)
  ⎿  Updated services\worker\src\parse\normalize.test.ts (+3 -1)
      55    });
      56  
      57    it("drops footers that only differ in their numbers", () => {
      58 -    const pages = [1, 2, 3, 4, 5].map((n) => `Confidential | Pa
         -ge ${n} of 5\nbody ${"x".repeat(n)}`);                         
      58 +    const pages = [1, 2, 3, 4, 5].map(                         
      59 +      (n) => `Confidential | Page ${n} of 5\nbody ${"x".repeat(
         +n)}`,                                                          
      60 +    );                                                         
      61  
      62      expect(normalizePages(pages)).toBe(
      63        [1, 2, 3, 4, 5].map((n) => `[[page ${n}]]\nbody ${"x".rep
          eat(n)}`).join("\n\n"),
  ⎿  Updated services\worker\src\parse\normalize.ts (+87 -87)
       1 -// Lines on at least this share of pages are running headers or
         - footers, not content.                                         
       2 -const REPEATED_LINE_SHARE = 0.6;                               
       3 -// With 1 or 2 pages a repeated line is as likely to be content
         - as a header.                                                  
       4 -const MIN_PAGES_FOR_REPEAT_CHECK = 3;                          
       5 -const MIN_HEADER_LENGTH = 3;                                   
       6 -const MAX_HEADER_LENGTH = 80;                                  
       7 -const PAGE_NUMBER_LINE = /^(?:page\s+\d+(?:\s+of\s+\d+)?|\d+)$/
         -i;                                                             
       8 -const PAGE_MARKER_LINE = /^\[\[page \d+\]\]\n/gm;              
       9 -// Looser than our own marker on purpose: anything a page looku
         -p might mistake for one goes.                                  
      10 -const UNTRUSTED_MARKER = String.raw`\[\[[^\S\n]*page[^\S\n]*\d+
         -[^\S\n]*\]\]`;                                                 
      11 -const UNTRUSTED_MARKER_LINE = new RegExp(                      
      12 -  String.raw`^[^\S\n]*${UNTRUSTED_MARKER}[^\S\n]*(?:\n|$)`,    
      13 -  "gim",                                                       
      14 -);                                                             
      15 -// The spaces before it go too, so "Clause 4 [[page 7]] applies
         -." doesn't end up with a double space.                         
      16 -const UNTRUSTED_MARKER_INLINE = new RegExp(String.raw`[^\S\n]*$
         -{UNTRUSTED_MARKER}`, "gi");                                    
      17 -                                                               
      18 -function stripUntrustedMarkers(text: string): string {         
      19 -  return text.replace(UNTRUSTED_MARKER_LINE, "").replace(UNTRUS
         -TED_MARKER_INLINE, "");                                        
      20 -}                                                              
      21 -                                                               
      22 -function collapseBlankLines(text: string): string {            
      23 -  return text.replace(/\n{3,}/g, "\n\n").trim();               
      24 -}                                                              
      25 -                                                               
      26 -export function normalizeText(text: string): string {          
      27 -  return collapseBlankLines(                                   
      28 -    text                                                       
      29 -      .replace(/\r\n?/g, "\n")                                 
      30 -      .replace(/\p{Zs}/gu, " ")                                
      31 -      // Before dehyphenating, so "agree-  \nment" still joins.
      32 -      .replace(/[^\S\n]+$/gm, "")                              
      33 -      // Only a lowercase continuation: "Acme-\nCorp" is a real
         - hyphen at a line break.                                       
      34 -      .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2"),                
      35 -  );                                                           
      36 -}                                                              
      37 -                                                               
      38 -// Footers like "Confidential | Page 3 of 12" differ on every p
         -age only in their numbers, so repeats                          
      39 -// are counted on a key with the digits masked.                
      40 -function repeatKey(line: string): string {                     
     … 134 more lines (ctrl+o to expand)
  ⎿  (timeout 5m)

  Ran 1 shell command (ctrl+o to expand)

● The footer fix works: the 5-page sample now has no Confidential | Page N lines
  and no header left. Typecheck, lint and prettier are clean, and tests are
  184/184 passing across 22 files.

  1. Footer fix (services/worker/src/parse/normalize.ts): when counting repeated
     lines, digits are replaced with #. Lines are also dropped by that key, so
     footers like Confidential | Page 3 of 12 go. New test: 5 pages with
     Confidential | Page N of 5.
  2. Compose comment (services/worker/src/index.ts): a normal comment saying
     stop_grace_period must be longer than LLM_TIMEOUT_MS + 30s (4m with the
     defaults). No TODO(me).
  3. CLAUDE.md: added npm run test-files to the commands and kept samples.
  4. docx: left as is. Running npm run test-files again will show the two docx
     samples as changed in git diff. I didn't regenerate the samples after the
     fix, because the fix doesn't change any sample file.

  The memory note about docx now records your decision.

  Ready for you to review the diff. git status shows samples/, scripts/, the new
  worker folders, and the shared formats.ts / shutdown.ts as new files.

✻ Cooked for 1m 18s · done 7:15 AM

❯ found something in a live run: the reconciler's first pass runs right at boot 
  while redis is still "connecting", so every stale row fails and logs a        
  warning, then nothing happens for 60s. make the first pass wait until the     
  queue is ready (or skip a pass with a single debug log when redis isn't ready 
  yet, no per-row warnings). per-row warnings only when redis is ready and an   
  enqueue actually fails. add a test for the not-ready case                     

  Ran 2 shell commands (ctrl+o to expand)

● I'll add a synchronous isReady() method to JobQueue so passes skip cleanly
  with a single debug log while Redis isn't ready, and trigger a pass as soon as
  the connection is ready to avoid a 60s boot delay. Starting with tests, then
  updating queue.ts and the reconciler.

● Bash(python - <<'PYEOF'
      p='services/api/src/reconciler.test.ts';
      s=open(p,encoding='utf8').read()…)
  ⎿  services/api/src/errors.test.ts
     services/api/src/health.test.ts
     services/api/src/reconciler.test.ts
     … +3 lines (ctrl+o to expand)
  ⎿  Updated services\api\src\reconciler.test.ts (+221 -141)
        1 -import { afterEach, beforeEach, describe, expect, it, vi } fro
          -m "vitest";                                                   
        2 -import {                                                      
        3 -  createDocument,                                             
        4 -  createLogger,                                               
        5 -  migrate,                                                    
        6 -  openMemoryDb,                                               
        7 -  transitionStatus,                                           
        8 -  type Db,                                                    
        9 -} from "@nexus/shared/node";                                  
       10 -import type { JobQueue } from "./queue.js";                   
       11 -import { startReconciler } from "./reconciler.js";            
       12 -                                                              
       13 -const NOW = new Date("2026-06-01T12:00:00Z");                 
       14 -                                                              
       15 -let db: Db;                                                   
       16 -                                                              
       17 -beforeEach(() => {                                            
       18 -  db = openMemoryDb();                                        
       19 -  migrate(db);                                                
       20 -});                                                           
       21 -                                                              
       22 -afterEach(() => {                                             
       23 -  vi.useRealTimers();                                         
       24 -  if (db.open) db.close();                                    
       25 -});                                                           
       26 -                                                              
       27 -function id(n: number): string {                              
       28 -  return `00000000-0000-4000-8000-${String(n).padStart(12, "0"
          -)}`;                                                          
       29 -}                                                             
       30 -                                                              
       31 -function addDoc(n: number, updatedAt: Date) {                 
       32 -  createDocument(db, {                                        
       33 -    id: id(n),                                                
       34 -    original_name: `${n}.pdf`,                                
       35 -    mime: "application/pdf",                                  
       36 -    size_bytes: 1,                                            
       37 -    sha256: `sha-${n}`,                                       
       38 -    storage_path: `${id(n)}.pdf`,                             
       39 -    status: "queued",                                         
       40 -  });                                                         
     … 322 more lines (ctrl+o to expand)

  Searched for 1 pattern (ctrl+o to expand)

● Bash(for f in services/api/src/errors.test.ts services/api/src/health.test.ts
      services/api/src/routes/documents-retry.test.ts
      services/api/src/routes/documents.test.…)
  ⎿  services/api/src/errors.test.ts:1
     services/api/src/health.test.ts:1
     services/api/src/routes/documents-retry.test.ts:1
     … +2 lines (ctrl+o to expand)
  ⎿  Updated services\api\src\errors.test.ts (+2 -0)
      10  const okQueue: JobQueue = {
      11    enqueue: () => Promise.resolve(),
      12    ping: () => Promise.resolve(),
      13 +  isReady: () => true,                                         
      14 +  onReady: () => () => undefined,                              
      15    close: () => Promise.resolve(),
      16  };
      17  
  ⎿  Updated services\api\src\health.test.ts (+2 -0)
       7    return {
       8      enqueue: () => Promise.resolve(),
       9      ping: () => (pingError ? Promise.reject(pingError) : Promis
          e.resolve()),
      10 +    isReady: () => true,                                       
      11 +    onReady: () => () => undefined,                            
      12      close: () => Promise.resolve(),
      13    };
      14  }
  ⎿  Updated services\api\src\routes\documents-retry.test.ts (+2 -0)
      59        return failEnqueue ? Promise.reject(new Error("redis is n
          ot ready")) : Promise.resolve();
      60      },
      61      ping: () => Promise.resolve(),
      62 +    isReady: () => true,                                       
      63 +    onReady: () => () => undefined,                            
      64      close: () => Promise.resolve(),
      65    };
      66    const app = await buildServer({
  ⎿  Updated services\api\src\routes\documents.test.ts (+2 -0)
      121        return fail ? Promise.reject(new Error("redis is not rea
           dy")) : Promise.resolve();
      122      },
      123      ping: () => Promise.resolve(),
      124 +    isReady: () => true,                                      
      125 +    onReady: () => () => undefined,                           
      126      close: () => Promise.resolve(),
      127    };
      128    return { queue, calls };
  ⎿  Updated services\api\src\test-support\fixtures.ts (+2 -0)
       9  export const okQueue: JobQueue = {
      10    enqueue: () => Promise.resolve(),
      11    ping: () => Promise.resolve(),
      12 +  isReady: () => true,                                         
      13 +  onReady: () => () => undefined,                              
      14    close: () => Promise.resolve(),
      15  };
      16  

● Tests and fakes are updated. Now writing the queue and reconciler code.

● Bash(python - <<'PYEOF'
      p='services/api/src/queue.ts'; s=open(p,encoding='utf8').read()…)
  ⎿         × skips the pass with one debug line and no per-row warnings 7m
     s
     ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
           Tests  1 failed | 7 passed (8)
  ⎿  Updated services\api\src\queue.ts (+16 -1)
      10    enqueue(documentId: string, run: number): Promise<void>;
      11    // Rejects when redis does not answer within the timeout, so 
          the caller can log why.
      12    ping(): Promise<void>;
      13 +  // Synchronous connection check, so a caller can skip work in
         +stead of failing every enqueue.                                
      14 +  isReady(): boolean;                                          
      15 +  // Fires each time the connection becomes ready, reconnects i
         +ncluded. Returns an unsubscribe.                               
      16 +  onReady(listener: () => void): () => void;                   
      17    close(): Promise<void>;
      18  }
      19  
     ...
      45      const payload = ExtractJobPayload.parse({ documentId, run }
          );
      46      // add() waits for the connection to be ready, which with r
          edis down is forever, so offline queue and
      47      // commandTimeout never get a say. Checking first also cove
          rs redis dropping after it was up.
      44 -    if (this.redis.status !== "ready") {                       
      48 +    if (!this.isReady()) {                                     
      49        throw new Error(`redis is not ready (status ${this.redis.
          status})`);
      50      }
      51      await this.queue.add("extract", payload, {
     ...
      57      });
      58    }
      59  
      60 +  isReady(): boolean {                                         
      61 +    return this.redis.status === "ready";                      
      62 +  }                                                            
      63 +                                                               
      64 +  onReady(listener: () => void): () => void {                  
      65 +    this.redis.on("ready", listener);                          
      66 +    return () => {                                             
      67 +      this.redis.off("ready", listener);                       
      68 +    };                                                         
      69 +  }                                                            
      70 +                                                               
      71    async ping(): Promise<void> {
      72      let timer: NodeJS.Timeout | undefined;
      73      const timeout = new Promise<never>((_, reject) => {
  ⎿  Updated services\api\src\reconciler.ts (+20 -4)
      20    failed: number;
      21  }
      22  
      23 +// "skipped" means redis was not ready, so nothing was tried.  
      24 +export type PassOutcome = ReconcileResult | "skipped" | undefin
         +ed;                                                            
      25 +                                                               
      26  export interface Reconciler {
      27    // Resolves to undefined when the pass itself failed; it neve
          r rejects.
      25 -  runOnce(): Promise<ReconcileResult | undefined>;             
      28 +  runOnce(): Promise<PassOutcome>;                             
      29    stop(): void;
      30  }
      31  
     ...
      37    intervalMs = 60_000,
      38    staleAfterMs = 60_000,
      39  }: ReconcilerDeps): Reconciler {
      37 -  let inFlight: Promise<ReconcileResult | undefined> | undefine
         -d;                                                             
      40 +  let inFlight: Promise<PassOutcome> | undefined;              
      41  
      39 -  async function pass(): Promise<ReconcileResult | undefined> {
      42 +  async function pass(): Promise<PassOutcome> {                
      43 +    // While redis is connecting (at boot) or down, every enque
         +ue would fail and warn once per row.                           
      44 +    // Skip quietly instead; onReady below runs a pass as soon 
         +as the connection is back.                                     
      45 +    if (!queue.isReady()) {                                    
      46 +      logger.debug("reconciler pass skipped, queue not ready");
      47 +      return "skipped";                                        
      48 +    }                                                          
      49      try {
      50        const cutoff = new Date(clock().getTime() - staleAfterMs)
          .toISOString();
      51        const rows = findStaleQueued(db, cutoff);
      52        const result: ReconcileResult = { stale: rows.length, enq
          ueued: 0, failed: 0 };
      53        for (const row of rows) {
      54 +        // Same reason as above: if redis drops mid pass the re
         +maining rows would only add noise.                             
      55 +        if (!queue.isReady()) {                                
      56 +          logger.debug(result, "reconciler pass stopped, queue 
         +not ready");                                                   
      57 +          return result;                                       
      58 +        }                                                      
      59          try {
      60            await queue.enqueue(row.id, row.run);
      61            result.enqueued++;
     … 22 more lines (ctrl+o to expand)
  ⎿  … 1 more file changed

  Ran 1 shell command (ctrl+o to expand)

● The code is right and the test expectation was wrong: the boot pass is still
  in flight when runOnce() is called, so the two share one pass and log one
  line. Fixing the test:

  Read 1 file (ctrl+o to expand)

● Update(services\api\src\reconciler.test.ts)
  ⎿  Added 1 line, removed 2 lines
      163        await expect(reconciler.runOnce()).resolves.toBe("skippe
           d");
      164        expect(calls).toEqual([]);
      165        expect(lines.filter((l) => (l.level as number) >= 40)).t
           oEqual([]);
      166 -      // One from the boot pass, one from the runOnce above.  
      166 +      // runOnce joins the boot pass that is still in flight, 
          +so it is one pass and one line.                               
      167        expect(lines.filter((l) => l.msg === "reconciler pass sk
           ipped, queue not ready")).toEqual([
      168          expect.objectContaining({ level: 20 }),
      169 -        expect.objectContaining({ level: 20 }),               
      169        ]);
      170      });
      171  

  Ran 1 shell command (ctrl+o to expand)

● All checks pass. Last check: that ioredis 6 still emits a ready event and sets
  status = "ready", since there's no live Redis here to try it against:

  Searched for 2 patterns (ctrl+o to expand)

● The reconciler now skips its pass with one debug line while Redis isn't ready,
  and runs a pass the moment the connection becomes ready, so there's no 60s
  wait after boot. Typecheck, lint and prettier are clean, and tests are 188/188
  passing (4 new). I haven't tried it against a live Redis, because Redis isn't
  running here.

  1. services/api/src/queue.ts: JobQueue gets two new methods:
     - isReady() reports whether ioredis says the connection is ready.
     - onReady(listener) listens for ioredis's ready event, which also fires on
       reconnect, and returns an unsubscribe.

     enqueue uses the same isReady() check as before.
  2. services/api/src/reconciler.ts:
     - When Redis isn't ready, a pass logs reconciler pass skipped, queue not 
       ready at debug, returns "skipped", and tries no rows.
     - A pass also runs on onReady, so the boot sweep happens as soon as Redis
       connects, and again after any reconnect. stop() unsubscribes.
     - Per-row warnings now only appear when Redis is ready and an enqueue
       actually fails.
     - If Redis drops in the middle of a pass, the pass stops with one debug
       line instead of a warning for every remaining row. I added that because
       the same noise would otherwise come back after any short outage.
  3. Tests (services/api/src/reconciler.test.ts):
     - Not ready: no enqueues, no warnings, one debug line.
     - A pass runs immediately on ready.
     - stop() removes the ready listener.
     - Redis dropping mid-pass gives no per-row warnings.

     The other queue fakes in the API tests got the two new methods, always
     ready.

  Checked in ioredis 6: setStatus sets status = "ready" before emitting the
  event (on the next tick), so isReady() is already true when the listener runs.

  To see it live: start the API before Redis, then start Redis. You should get
  one debug skip line and then a reconciler pass line within a second of Redis
  coming up.

✻ Crunched for 2m 28s · done 8:13 AM

❯ ran it live: api booted with redis up, reconciler enqueued the 6 queued docs  
  within 40ms, no warnings. worker processed all of them: 4 completed with      
  needs_review, scanned -> NO_TEXT_LAYER and empty docx -> EMPTY_DOCUMENT, both 
  after 1 attempt with no retry. not-a-pdf and not-a-docx were rejected at      
  upload. phase done                                                            

● That run shows the whole parse phase working: upload → enqueue → reconciler →
  worker → parse → final status.

  - Reconciler: enqueued all 6 docs within 40ms of boot with no warnings, so the
    boot pass no longer fails while Redis connects.
  - Worker: 4 completed with needs_review. The two that should fail did, after 1
    attempt with no retries: scanned → NO_TEXT_LAYER, empty docx →
    EMPTY_DOCUMENT.
  - API: not-a-pdf.pdf and not-a-docx.docx were rejected at upload, so the
    shared MIME_FORMATS map works on the API side.

  The working tree is ready for you to review and commit.

  Next on my side is the LLM layer (provider, prompt, extraction), which fills
  analyzeDocument's extraction: null. Send that step when you're ready.
✻ Churned for 8s · done 8:18 AM