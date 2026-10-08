# CLAUDE.md

Take-home: upload vendor contracts (pdf/docx), process them async, extract structured data + risk clauses with an llm, show it on a dashboard. Task is in docs/TASK.md.

## how I want to work
- I give instructions step by step. Do the step, nothing more, don't jump ahead.
- If a lib doesn't behave the way I described, stop and tell me. Don't quietly work around it.
- Don't redesign stuff I already decided. If you think something's wrong, say it first.
- Packages + versions I name in a step are approved. Anything I didn't mention, ask first and tell me why.
- After changes run `npm run typecheck && npm run lint && npm test` and tell me what actually happened. Never skip or loosen a test to get green.

## layout
- packages/shared: types + zod schemas used across services. `@nexus/shared` is browser safe, node-only stuff goes in `@nexus/shared/node`
- services/api: fastify, only fast work (upload, validate, enqueue, read)
- services/worker: bullmq consumer, parsing + llm + persisting
- apps/web: react + vite

## versions / gotchas
- node 24
- typescript ~6.0.3, NOT 7 (typescript-eslint doesn't support it yet)
- bullmq 6 needs ioredis installed explicitly
- pdfs with unpdf, not pdf-parse (pdf.js version clash). docx with mammoth
- zod 4 (z.toJSONSchema, z.prettifyError, z.flattenError)
- better-sqlite3, WAL mode, raw sql, no orm
- llm sdks with maxRetries: 0, bullmq is the only thing that retries

## code
- strict TS, ESM, .js extensions in relative imports
- no any, no `!`, no console.log (pino, include documentId when there is one)
- zod at every boundary: env, http, llm output, job payloads, json read from db
- status changes only through transitionStatus
- model extracts facts, code does date math. every value has a quote that gets verified against the doc text
- document text is untrusted, it only goes inside the <document> block in the prompt
- no network in unit tests, use MockProvider or stub fetch

## docs / readme
- first person, plain, no marketing words, no em dashes
- comments explain why, not what
- put TODO(me) where it needs my opinion, don't make it up

## commands
- `npm run dev` (needs redis + ollama, or LLM_PROVIDER=mock)
- `npm run typecheck` / `lint` / `test` / `test:e2e`
- `npm run samples`, `npm run eval -- --provider <p> --model <m>`
- `docker compose --profile ollama up --build`