 ▐▛███▛█   Claude Code v2.1.296
▝▜██████▀  Opus 5.5 · Claude Pro
 ▝▝   ▝▝   E:\contract-analysis-pipeline

  ⎿  SessionStart:startup says: <persisted-output>
     Output too large (11.8KB). Full output saved to: C:\Users\boris\.claude\pro
     jects\E--contract-analysis-pipeline\34ee5250-61a3-4a3e-bb78-b11e859c7112\to
     ol-results\hook-29395b88-d75d-491e-865c-e51505131318-4-systemMessage.txt

     Preview (first 2KB):
     [contract-analysis-pipeline] recent context, 2026-10-10 11:05pm GMT+3
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
       Loading: 50 observations (19,543 tokens to read)
       Work investment: 275,515 tokens spent on research, building, and 
     decisions
       Your savings: 93% reduction from reuse

     Oct 10, 2026

     #S978 Build llm-smoke.ts end-to-end LLM testing script with provider/model
     safety guard to prevent accidental API key misuse and provider/model 
     mismatches (Oct 10, 3:47 PM)

     #S979 Fixed flaky document retry test by diagnosing and eliminating fastify
     cold-start delay during test execution (Oct 10, 3:56 PM)

     #S980 Refactored Anthropic LLM provider to eliminate output_config.format
     constraint; moved JSON schema to system prompt with fence-stripping for 
     markdown-wrapped output (Oct 10, 4:25 PM)

     #S981 Updated stale comments referencing Anthropic structured outputs
     constraint; documented Ollama model performance findings in project memory 
     (Oct 10, 4:28 PM)

     ...
     </persisted-output>

● Remote Control is disabled by your organization's policy. Contact your
  organization admin for access.

❯ read CLAUDE.md and docs/TASK.md first. no code yet.                           
                                                                                
  quick context: take-home, contract upload -> async processing -> llm          
  extraction -> dashboard. backend has to be TS. I've got the architecture      
  worked out so I'll feed it to you step by step. only do what I ask in each    
  step, and if some library doesn't behave like I say, stop and tell me, don't  
  hack around it                                                                

  Read 1 file (ctrl+o to expand)

● Read both. No code touched.

  Task (docs/TASK.md): upload one or more PDF/DOCX contracts in a web UI,
  process them async, have an LLM pull out structured data (value, renewal
  dates, risk clauses), show it on a dashboard. TS/Node backend, containerized,
  README in my own voice explaining trade-offs, AI conversation log committed.

  Rules I'll follow (CLAUDE.md):
  1. One step at a time, only what you ask. No jumping ahead.
  2. If a library behaves differently from what you described, I stop and report
     it. No workarounds.
  3. No redesigning decisions you've made. If I think one is wrong, I say so
     first.
  4. New packages only if you named them. Anything else, I ask first and say
     why.
  5. After every change: npm run typecheck && npm run lint && npm test, and I
     report the real output. No git writes.

  Where the repo is now: the working tree is clean. The latest commit is 528c5ec
  feat(worker): llm providers and extraction prompt v1. Commits before it added
  the API (upload, read endpoints, retry, reconciler, CSV export), the worker
  job runtime, and PDF/DOCX parsing. So the next step would come after the LLM
  providers.

  Next: send the next step.

✻ Cogitated for 12s · done Saturday 11:06 PM

❯ the actual pipeline. order: chunk -> extract (repair once) -> normalize ->    
  ground -> merge -> summarize -> derive -> review. grounding before merge so   
  merge can prefer verified values, derive last on the final values.            
                                                                                
  add date-fns ^4.4 (to the worker now, and to shared in the derive step). no   
  fuzzy match / concurrency libs, small enough to write ourselves.              
                                                                                
  everything in this phase goes in services/worker/src/extraction/, except      
  deriveDates which goes in shared (see the derive step).                       
                                                                                
  extraction/chunk.ts chunkText(text, maxChars) -> { index, text }[]. maxChars  
  is LLM_MAX_INPUT_CHARS (12000 by default, sized so the 7b mostly fits a 6 GB  
  gpu). one pass if it fits, otherwise split, but on clause boundaries,         
  splitting mid clause can separate "Fees" from the number.                     
                                                                                
  1. fits -> 1 chunk                                                            
  2. blocks = split on blank lines. heading block if first line matches         
  /^\s*(?:(?:ARTICLE|SECTION|CLAUSE|SCHEDULE|EXHIBIT|ANNEX|APPENDIX)\b|\d{1,2}( 
  ?:\.\d{1,2}){0,3}\.?\s+\S)/i (or a page marker then that)                     
  3. block bigger than maxChars -> split at the last ". " before the limit,     
  hard cut if none                                                              
  4. greedy pack, when the next block won't fit cut at the last heading in the  
  chunk if it's past 50%, else cut right there                                  
  5. next chunk starts with the previous chunk's last block if <= 1500 chars    
  (overlap)                                                                     
  6. chunk without a leading [[page N]] gets the last seen marker prepended     
                                                                                
  limit.ts: mapLimit(items, limit, fn), keeps order.                            
                                                                                
  tests: short -> 1, 3x budget cuts on headings, giant block splits on a        
  sentence, overlap there, marker prepended, and a generated 100 clause doc     
  where every block lands in some chunk                                         

  Listed 1 directory, ran 1 shell command (ctrl+o to expand)

● Bash(grep -rn "LLM_MAX_INPUT_CHARS" packages/shared/src | head; npm install
      date-fns@^4.4 -w @nexus/worker 2>&1 | tail -3; grep date-fns
      services/worker/package.json)
  ⎿  packages/shared/src/config.test.ts:10:    expect(config.LLM_MAX_INPUT_
     CHARS).toBe(12000);
     packages/shared/src/config.ts:28:    LLM_MAX_INPUT_CHARS: PositiveInt.
     … +6 lines (ctrl+o to expand)
  ⎿  Updated package-lock.json (+11 -0)
      2275        "dev": true,
      2276        "license": "MIT"
      2277      },
      2278 +    "node_modules/date-fns": {                               
      2279 +      "version": "4.4.0",                                    
      2280 +      "resolved": "https://registry.npmjs.org/date-fns/-/date
           +-fns-4.4.0.tgz",                                             
      2281 +      "integrity": "sha512-+1UMbeh68lH1SegH83CGWwpb6OHHbpSgr3
           ++s5Eww5M4CAgswBpoWS0AjTOfEJ33HiYKz1hdj/KTFprzXHmq/6w==",     
      2282 +      "license": "MIT",                                      
      2283 +      "funding": {                                           
      2284 +        "type": "github",                                    
      2285 +        "url": "https://github.com/sponsors/kossnocorp"      
      2286 +      }                                                      
      2287 +    },                                                       
      2288      "node_modules/debug": {
      2289        "version": "4.4.3",
      2290        "resolved": "https://registry.npmjs.org/debug/-/debug-4
            .4.3.tgz",
     ...
      5116          "@anthropic-ai/sdk": "^0.132.1",
      5117          "@nexus/shared": "^0.0.0",
      5118          "bullmq": "^6.3.12",
      5119 +        "date-fns": "^4.4.0",                                
      5120          "ioredis": "^6.0.0",
      5121          "mammoth": "^1.13.0",
      5122          "openai": "^7.32.0",
  ⎿  Updated services\worker\package.json (+1 -0)
       7      "@anthropic-ai/sdk": "^0.132.1",
       8      "@nexus/shared": "^0.0.0",
       9      "bullmq": "^6.3.12",
      10 +    "date-fns": "^4.4.0",                                      
      11      "ioredis": "^6.0.0",
      12      "mammoth": "^1.13.0",
      13      "openai": "^7.32.0",

● Writing tests first.

● Write(services\worker\src\extraction\chunk.test.ts)
  ⎿  Wrote 126 lines to services\worker\src\extraction\chunk.test.ts
       1 import { describe, expect, it } from "vitest";
       2 import { chunkText } from "./chunk.js";
       3 
       4 const HEADING = /^(?:\[\[page \d+\]\]\n)?\d+\. Section \d+$/m;
       5 
       7   return `${label} `.padEnd(length, "x");
       8 }
       9 
      10 function section(n: number, bodies: number, bodyLength: number):
          string {
     … +138 lines (ctrl+o to expand)

● Write(services\worker\src\extraction\limit.test.ts)
  ⎿  Wrote 56 lines to services\worker\src\extraction\limit.test.ts
       1 import { describe, expect, it } from "vitest";
       2 import { mapLimit } from "./limit.js";
       3 
       4 function deferred(): { promise: Promise<void>; resolve: () => vo
         id } {
       6   const promise = new Promise<void>((r) => {
       7     resolve = r;
       8   });
       9   return { promise, resolve };
      10 }
     … +52 lines (ctrl+o to expand)

● Now the implementations.

● Write(services\worker\src\extraction\limit.ts)
  ⎿  Wrote 30 lines to services\worker\src\extraction\limit.ts
       1 // Like Promise.all over items.map(fn), but with at most `limit`
          calls in flight. After the first
         ft to settle on their own.
       3 export async function mapLimit<T, R>(
       4   items: readonly T[],
       6   fn: (item: T, index: number) => Promise<R>,
       7 ): Promise<R[]> {
       8   if (!Number.isInteger(limit) || limit < 1) {
         ${String(limit)}`);
      10   }
     … +24 lines (ctrl+o to expand)

● Write(services\worker\src\extraction\chunk.ts)
  ⎿  Wrote 129 lines to services\worker\src\extraction\chunk.ts
       1 export interface Chunk {
       2   index: number;
       3   text: string;
       4 }
       5 
       7   text: string;
       8   heading: boolean;
       9   // Page in effect where the block starts, from the last [[page
          N]] at or before it.
      10   page: number | undefined;
     … +141 lines (ctrl+o to expand)

● Tidying toBlocks (left a redundant ternary in it).

● Update(services\worker\src\extraction\chunk.ts)
  ⎿  Added 3 lines, removed 2 lines
      56    let page: number | undefined;
      57    for (const raw of text.split(/\n{2,}/)) {
      58      if (raw.trim().length === 0) continue;
      59 -    const startPage = startsWithMarker(raw) ? Number(PAGE_MARKE
         -R_LINE.exec(raw.split("\n", 1)[0] ?? "")?.[1]) : page;         
      59 +    const own = PAGE_MARKER_LINE.exec(raw.split("\n", 1)[0] ?? 
         +"");                                                           
      60 +    const startPage = own ? Number(own[1]) : page;             
      61      splitOversized(raw, budget).forEach((piece, i) => {
      61 -      blocks.push({ text: piece, heading: i === 0 && isHeading(
         -piece), page: i === 0 ? startPage : startPage });              
      62 +      blocks.push({ text: piece, heading: i === 0 && isHeading(
         +piece), page: startPage });                                    
      63      });
      64      for (const m of raw.matchAll(PAGE_MARKERS)) page = Number(m
          [1]);
      65    }

● Bash(npx prettier --write services/worker/src/extraction >/dev/null && npx
      vitest run services/worker/src/extraction 2>&1 | tail -30)
  ⎿   RUN  v5.0.3 E:/contract-analysis-pipeline
     … +4 lines (ctrl+o to expand)
  ⎿  Updated services\worker\src\extraction\chunk.test.ts (+8 -5)
       92  
       93      const chunks = chunkText(text, 1000);
       94  
       95 -    expect(chunks.map((c) => c.text.split("\n")[0])).toEqual([
          -"[[page 1]]", "[[page 1]]", "[[page 1]]"]);                   
       95 +    expect(chunks.map((c) => c.text.split("\n")[0])).toEqual([
       96 +      "[[page 1]]",                                           
       97 +      "[[page 1]]",                                           
       98 +      "[[page 1]]",                                           
       99 +    ]);                                                       
      100      expect(chunks[1]?.text).toBe(`[[page 1]]\n${body("b", 400)
           }\n\n${body("c", 400)}`);
       97 -    expect(chunks[2]?.text).toBe(                             
       98 -      `[[page 1]]\n${body("c", 400)}\n\n[[page 2]]\n${body("d"
          -, 400)}`,                                                     
       99 -    );                                                        
      101 +    expect(chunks[2]?.text).toBe(`[[page 1]]\n${body("c", 400)
          +}\n\n[[page 2]]\n${body("d", 400)}`);                         
      102    });
      103  
      104    it("puts every block of a 100 clause doc in some chunk and k
           eeps chunks within budget", () => {
     ...
      112        const heading = `${n}. Clause ${n}`;
      113        blocks.push(n % 6 === 1 ? `[[page ${Math.ceil(n / 6)}]]\
           n${heading}` : heading);
      114        const paras = 1 + Math.floor(next() * 3);
      113 -      for (let p = 0; p < paras; p++) blocks.push(body(`c${n}p
          -${p}`, 50 + Math.floor(next() * 900)));                       
      115 +      for (let p = 0; p < paras; p++)                         
      116 +        blocks.push(body(`c${n}p${p}`, 50 + Math.floor(next() 
          +* 900)));                                                     
      117      }
      118      const text = blocks.join("\n\n");
      119  
  ⎿  Updated services\worker\src\extraction\limit.test.ts (+10 -6)
      22    it("never runs more than limit at once", async () => {
      23      let running = 0;
      24      let peak = 0;
      25 -    await mapLimit(Array.from({ length: 10 }, (_, i) => i), 3, 
         -async () => {                                                  
      26 -      running++;                                               
      27 -      peak = Math.max(peak, running);                          
      28 -      await new Promise((r) => setTimeout(r, 1));              
      29 -      running--;                                               
      30 -    });                                                        
      25 +    await mapLimit(                                            
      26 +      Array.from({ length: 10 }, (_, i) => i),                 
      27 +      3,                                                       
      28 +      async () => {                                            
      29 +        running++;                                             
      30 +        peak = Math.max(peak, running);                        
      31 +        await new Promise((r) => setTimeout(r, 1));            
      32 +        running--;                                             
      33 +      },                                                       
      34 +    );                                                         
      35      expect(peak).toBe(3);
      36    });
      37  

  Ran 2 shell commands (ctrl+o to expand)

● Chunking and mapLimit are in. Typecheck and lint are clean, and npm test
  passed: 33 files, 337 tests (13 of them new).

  Changed:
  1. services/worker/package.json: added date-fns ^4.4.0 (installed 4.4.0), plus
     the package-lock.json change from installing it.
  2. services/worker/src/extraction/chunk.ts: chunkText(text, maxChars) follows
     your rules 1 to 6.
  3. services/worker/src/extraction/limit.ts: mapLimit(items, limit, fn). It
     keeps order, and after the first rejection it starts no new items.
  4. chunk.test.ts and limit.test.ts cover the cases you listed. I also added
     tests for hard cuts, for skipping overlap on blocks over 1500 chars, and
     for the concurrency cap and error handling in mapLimit.

  Choices your rules didn't settle (check these when you review):
  1. Room for the page marker. The packing limit is maxChars minus the length of
     the biggest [[page N]]\n in the doc. That way a prepended marker can't
     push a chunk over maxChars.
  2. Overlap can be dropped. If the overlap block is the only reason the next
     block won't fit, I drop the overlap. Otherwise the chunk would contain
     nothing but the repeated block.
  3. Where a cut can happen. A cut can't land on the chunk's first block or on
     the overlap block, because the chunk would then have no new content. "Past
     50%" means the heading starts after half the chunk's length in characters.
  4. Split blocks. When a block is too big and gets split, only the first piece
     can count as a heading. Every piece keeps the block's starting page.

  Next: review the diff (git diff, plus the new services/worker/src/extraction/
  folder), then send the extract step.

✻ Brewed for 4m 16s · done Saturday 11:18 PM

❯ extract.ts: extractChunk(provider, chunk, { filename, chunkCount, timeoutMs   
  }) -> { chunkIndex, data, usage, repaired, latencyMs }                        
                                                                                
  call with llmExtractionJsonSchema() and MAX_OUTPUT_TOKENS from extract.v1,    
  safeParse. before safeParse lowercase the enum strings (confidence, severity, 
  category, document_type), "High" shouldn't cost a whole repair call. ollama   
  already sizes num_ctx up for the repair conversation, nothing to do here for  
  that. fail (or bad_output) -> one repair with z.prettifyError cut to 2000     
  chars (or "Reply was not valid JSON"), add up the usage. fails again ->       
  PermanentError EXTRACTION_INVALID with the summary. use                       
  buildRepairConversation from extract.v1, don't build a second one.            
                                                                                
  only one repair, if the same prompt on the same text gives broken structure   
  twice, burning more attempts just hides the problem.                          
                                                                                
  one addition: if the bad_output was because the reply hit the output token    
  limit (the num_predict case from the 3b), don't send that junk back as the    
  assistant turn. it's up to 4096 tokens of garbage and forces a bigger num_ctx 
  and a model reload. repair = the original request again plus a short user     
  note "Your previous reply was cut off at the length limit. Keep every quote   
  to one sentence." if LlmError doesn't tell us it was a truncation yet, add a  
  field for it in the providers (ollama done_reason "length", openai incomplete 
  max_output_tokens, anthropic stop_reason "max_tokens").                       
                                                                                
  tests with a scripted MockProvider: fine first try, broken then fine          
  (repaired true, usage summed), broken twice -> EXTRACTION_INVALID, bad_output 
  then fine, truncated bad_output -> repair without the previous reply. mock    
  only, typecheck, lint, test.                                                  

  Ran 5 shell commands (ctrl+o to expand)

● Read the providers. LlmError has no truncation field yet, so I'm adding
  truncated to it and setting it in all three providers, then writing
  extract.ts.

  Listed 1 directory, ran 2 shell commands (ctrl+o to expand)

● Switching to direct edits.

  Read 4 files (ctrl+o to expand)

● Update(services\worker\src\llm\errors.ts)  ⎿  Added 10 lines, removed 1 line
       3  
       4  const RETRYABLE: ReadonlySet<LlmErrorKind> = new Set(["timeout"
          , "rate_limited", "unavailable"]);
       5  
       6 +export interface LlmErrorOptions extends ErrorOptions {        
       7 +  // The reply stopped at the output token limit. The repair st
         +ep must not send that reply back: it is                        
       8 +  // up to maxOutputTokens of junk that would also force ollama
         + into a bigger num_ctx and a reload.                           
       9 +  truncated?: boolean;                                         
      10 +}                                                              
      11 +                                                               
      12  // Providers translate their sdk/http failures into this one sh
          ape so classifyError doesn't need to
      13  // know about anthropic, openai or ollama error classes.
      14  export class LlmError extends Error {
      15 +  readonly truncated: boolean;                                 
      16 +                                                               
      17    constructor(
      18      readonly kind: LlmErrorKind,
      19      message: string,
      20      // Kept for bad_output so the repair step and the logs can 
          see what the model actually returned.
      21      readonly rawText?: string,
      14 -    opts?: ErrorOptions,                                       
      22 +    opts?: LlmErrorOptions,                                    
      23    ) {
      24      super(message, opts);
      25      this.name = "LlmError";
      26 +    this.truncated = opts?.truncated ?? false;                 
      27    }
      28  
      29    get retryable(): boolean {

● Update(services\worker\src\llm\openai.ts)
  ⎿  Added 7 lines, removed 6 lines
      126        if (reason === "content_filter") {
      127          throw new LlmError("bad_output", "output stopped by th
           e content filter", rawText);
      128        }
      129 +      // Reasoning tokens count against the limit too, so a cu
          +t-off reply can have no text at all.                          
      130 +      const truncated = reason === "max_output_tokens";       
      131        if (rawText === "") {
      130 -        throw new LlmError("bad_output", "reply has no output 
          -text", rawText);                                              
      132 +        throw new LlmError("bad_output", "reply has no output 
          +text", rawText, { truncated });                               
      133        }
      134  
      135        const parsed = parseJson(rawText);
      136        if (!parsed.ok) {
      135 -        const message =                                       
      136 -          reason === "max_output_tokens"                      
      137 -            ? `output stopped at max_output_tokens (${req.maxO
          -utputTokens}) before the json was complete`                   
      138 -            : "model output is not valid json";               
      139 -        throw new LlmError("bad_output", message, rawText, { c
          -ause: parsed.error });                                        
      137 +        const message = truncated                             
      138 +          ? `output stopped at max_output_tokens (${req.maxOut
          +putTokens}) before the json was complete`                     
      139 +          : "model output is not valid json";                 
      140 +        throw new LlmError("bad_output", message, rawText, { c
          +ause: parsed.error, truncated });                             
      141        }
      142  
      143        return {

● Update(services\worker\src\llm\anthropic.ts)
  ⎿  Added 7 lines, removed 6 lines
      129          const category = res.stop_details?.category ?? "unspec
           ified";
      130          throw new LlmError("bad_output", `model refused (categ
           ory: ${category})`, rawText);
      131        }
      132 +      // Thinking tokens count against max_tokens too, so a cu
          +t-off reply can have no text block.                           
      133 +      const truncated = res.stop_reason === "max_tokens";     
      134        if (rawText === "") {
      133 -        throw new LlmError("bad_output", "reply has no text bl
          -ock", rawText);                                               
      135 +        throw new LlmError("bad_output", "reply has no text bl
          +ock", rawText, { truncated });                                
      136        }
      137  
      138        // rawText stays as the model wrote it, fence included, 
           so the repair call shows its real reply.
      139        const parsed = parseJson(stripFence(rawText));
      140        if (!parsed.ok) {
      139 -        const reason =                                        
      140 -          res.stop_reason === "max_tokens"                    
      141 -            ? `output stopped at max_tokens (${req.maxOutputTo
          -kens}) before the json was complete`                          
      142 -            : "model output is not valid json";               
      143 -        throw new LlmError("bad_output", reason, rawText, { ca
          -use: parsed.error });                                         
      141 +        const reason = truncated                              
      142 +          ? `output stopped at max_tokens (${req.maxOutputToke
          +ns}) before the json was complete`                            
      143 +          : "model output is not valid json";                 
      144 +        throw new LlmError("bad_output", reason, rawText, { ca
          +use: parsed.error, truncated });                              
      145        }
      146  
      147        return {

● Update(services\worker\src\llm\ollama.ts)
  ⎿  Added 8 lines, removed 5 lines
      190        const { message, done_reason, prompt_eval_count, eval_co
           unt } = parsed.data;
      191        const content = parseJson(message.content);
      192        if (!content.ok) {
      193 -        const reason =                                        
      194 -          done_reason === "length"                            
      195 -            ? `output stopped at num_predict (${req.maxOutputT
          -okens} tokens) before the json was complete`                  
      196 -            : "model output is not valid json";               
      197 -        throw new LlmError("bad_output", reason, message.conte
          -nt, { cause: content.error });                                
      193 +        const truncated = done_reason === "length";           
      194 +        const reason = truncated                              
      195 +          ? `output stopped at num_predict (${req.maxOutputTok
          +ens} tokens) before the json was complete`                    
      196 +          : "model output is not valid json";                 
      197 +        throw new LlmError("bad_output", reason, message.conte
          +nt, {                                                         
      198 +          cause: content.error,                               
      199 +          truncated,                                          
      200 +        });                                                   
      201        }
      202  
      203        return {

● Provider tests next.

  Read 4 files (ctrl+o to expand)

● Update(services\worker\src\llm\errors.test.ts)
  ⎿  Added 5 lines
      20      expect(new LlmError("auth", "401").rawText).toBeUndefined()
          ;
      21    });
      22  
      23 +  it("is not truncated unless the provider says so", () => {   
      24 +    expect(new LlmError("bad_output", "not json", "{oops").trun
         +cated).toBe(false);                                            
      25 +    expect(new LlmError("bad_output", "cut off", "{oo", { trunc
         +ated: true }).truncated).toBe(true);                           
      26 +  });                                                          
      27 +                                                               
      28    it.each<[LlmErrorKind, boolean]>([
      29      ["timeout", true],
      30      ["rate_limited", true],

● Update(services\worker\src\llm\ollama.test.ts)
  ⎿  Added 2 lines
      346      expect(err.kind).toBe("bad_output");
      347      expect(err.rawText).toBe('{"term": "12 mon');
      348      expect(err.cause).toBeInstanceOf(SyntaxError);
      349 +    expect(err.truncated).toBe(false);                        
      350    });
      351  
      352    it("says so when the output hit num_predict, since that is t
           he usual reason for cut-off json", async () => {
     ...
      358  
      359      expect(err.kind).toBe("bad_output");
      360      expect(err.message).toContain("2048");
      361 +    expect(err.truncated).toBe(true);                         
      362    });
      363  
      364    it("maps a 200 with an unexpected envelope to bad_output", a
           sync () => {

● Update(services\worker\src\llm\openai.test.ts)
  ⎿  Added 21 lines
      161      expect(err.kind).toBe("bad_output");
      162      expect(err.rawText).toBe('{"term": "12 mon');
      163      expect(err.cause).toBeInstanceOf(SyntaxError);
      164 +    expect(err.truncated).toBe(false);                        
      165    });
      166  
      167    it("says so when the output hit max_output_tokens", async ()
            => {
     ...
      179  
      180      expect(err.kind).toBe("bad_output");
      181      expect(err.message).toContain("4096");
      182 +    expect(err.truncated).toBe(true);                         
      183    });
      184  
      185    it("maps an empty output to bad_output", async () => {
     ...
      189  
      190      expect(err.kind).toBe("bad_output");
      191      expect(err.rawText).toBe("");
      192 +    expect(err.truncated).toBe(false);                        
      193    });
      194  
      195 +  it("marks an empty output as truncated when reasoning used u
          +p max_output_tokens", async () => {                           
      196 +    const { provider } = setup(() =>                          
      197 +      Promise.resolve(                                        
      198 +        reply({                                               
      199 +          output_text: "",                                    
      200 +          output: [],                                         
      201 +          status: "incomplete",                               
      202 +          incomplete_details: { reason: "max_output_tokens" },
      203 +        }),                                                   
      204 +      ),                                                      
      205 +    );                                                        
      206 +                                                              
      207 +    const err = await expectLlmError(provider.complete(request
          +));                                                           
      208 +                                                              
      209 +    expect(err.kind).toBe("bad_output");                      
      210 +    expect(err.truncated).toBe(true);                         
      211 +  });                                                         
      212 +                                                              
      213    it.each<[string, () => Error, LlmErrorKind]>([
      214      ["connection timeout", () => new APIConnectionTimeoutError
           (), "timeout"],
      215      [

● Update(services\worker\src\llm\anthropic.test.ts)
  ⎿  Added 14 lines
      192      expect(err.kind).toBe("bad_output");
      193      expect(err.rawText).toBe('{"term": "12 mon');
      194      expect(err.cause).toBeInstanceOf(SyntaxError);
      195 +    expect(err.truncated).toBe(false);                        
      196    });
      197  
      198    it("says so when the output hit max_tokens", async () => {
     ...
      204  
      205      expect(err.kind).toBe("bad_output");
      206      expect(err.message).toContain("4096");
      207 +    expect(err.truncated).toBe(true);                         
      208    });
      209  
      210 +  it("marks a reply with no text block as truncated when think
          +ing used up max_tokens", async () => {                        
      211 +    const { provider } = setup(() =>                          
      212 +      Promise.resolve(reply({ content: [], stop_reason: "max_t
          +okens" })),                                                   
      213 +    );                                                        
      214 +                                                              
      215 +    const err = await expectLlmError(provider.complete(request
          +));                                                           
      216 +                                                              
      217 +    expect(err.kind).toBe("bad_output");                      
      218 +    expect(err.truncated).toBe(true);                         
      219 +  });                                                         
      220 +                                                              
      221    it("maps a reply with no text block to bad_output", async ()
            => {
      222      const { provider } = setup(() => Promise.resolve(reply({ c
           ontent: [] })));
      223  
     ...
      225  
      226      expect(err.kind).toBe("bad_output");
      227      expect(err.rawText).toBe("");
      228 +    expect(err.truncated).toBe(false);                        
      229    });
      230  
      231    it.each<[string, () => Error, LlmErrorKind]>([

● Now the truncation note in extract.v1.ts, next to the existing repair builder.

● Update(services\worker\src\llm\prompts\extract.v1.ts)
  ⎿  Added 12 lines
      58    return `Your previous reply did not match the required schema
          . Problems:\n${errors}\nReply again with the complete corrected
           JSON only.`;
      59  }
      60  
      61 +export const TRUNCATED_NOTE =                                  
      62 +  "Your previous reply was cut off at the length limit. Keep ev
         +ery quote to one sentence.";                                   
      63 +                                                               
      64 +// No assistant turn here: a cut-off reply is up to maxOutputTo
         +kens of junk, and sending it back would                        
      65 +// push ollama into a bigger num_ctx and a model reload for not
         +hing the model can use.                                        
      66 +export function buildTruncatedRetryConversation(userMessage: st
         +ring): LlmMessage[] {                                          
      67 +  return [                                                     
      68 +    { role: "user", content: userMessage },                    
      69 +    { role: "user", content: TRUNCATED_NOTE },                 
      70 +  ];                                                           
      71 +}                                                              
      72 +                                                               
      73  // The model sees its own bad reply and the problems with it, i
          nstead of starting from scratch.
      74  export function buildRepairConversation(
      75    userMessage: string,

● Update(services\worker\src\llm\prompts\extract.v1.test.ts)
  ⎿  Added 2 lines
       2  import {
       3    PROMPT_VERSION,
       4    SCHEMA_NAME,
       5 +  TRUNCATED_NOTE,                                              
       6    buildRepairConversation,
       7    buildRepairMessage,
       8    buildSystemPrompt,
       9 +  buildTruncatedRetryConversation,                             
      10    buildUserMessage,
      11  } from "./extract.v1.js";
      12  

● Update(services\worker\src\llm\prompts\extract.v1.test.ts)
  ⎿  Added 14 lines
      121      ]);
      122    });
      123  });
      124 +                                                              
      125 +describe("buildTruncatedRetryConversation", () => {           
      126 +  it("resends the document with the length note and no assista
          +nt turn", () => {                                             
      127 +    const doc = buildUserMessage({ filename: "a.pdf", text: "x
          +", chunkIndex: 0, chunkCount: 1 });                           
      128 +                                                              
      129 +    expect(TRUNCATED_NOTE).toBe(                              
      130 +      "Your previous reply was cut off at the length limit. Ke
          +ep every quote to one sentence.",                             
      131 +    );                                                        
      132 +    expect(buildTruncatedRetryConversation(doc)).toEqual([    
      133 +      { role: "user", content: doc },                         
      134 +      { role: "user", content: TRUNCATED_NOTE },              
      135 +    ]);                                                       
      136 +  });                                                         
      137 +});                                                           

● Tests for extract.ts first.

● Write(services\worker\src\extraction\extract.test.ts)
  ⎿  Wrote 181 lines to services\worker\src\extraction\extract.test.ts
       1 import { ErrorCode, llmExtractionJsonSchema } from "@nexus/share
         d";
       2 import { describe, expect, it } from "vitest";
       3 import { LlmError } from "../llm/errors.js";
       4 import { MOCK_EXTRACTION, MockProvider } from "../llm/mock.js";
       6   MAX_OUTPUT_TOKENS,
       7   SCHEMA_NAME,
       8   buildRepairConversation,
       9   buildRepairMessage,
      10   buildSystemPrompt,
     … +202 lines (ctrl+o to expand)

● Simplifying the repair assertion to compute the expected zod summary directly.

● Update(services\worker\src\extraction\extract.test.ts)
  ⎿  Added 8 lines, removed 8 lines
       95      expect(result.repaired).toBe(true);
       96      expect(result.data).toEqual(MOCK_EXTRACTION);
       97      expect(result.usage.outputTokens).toBe(200);
       98 -    const [first, repair] = provider.calls;                   
       99 -    expect(result.usage.inputTokens).toBeGreaterThan(0);      
      100 -    expect(first?.messages).toHaveLength(1);                  
      101 -    const errors = repair?.messages[2]?.content ?? "";        
      102 -    expect(repair?.messages).toEqual(                         
      103 -      buildRepairConversation(doc, JSON.stringify(broken()), e
          -rrors.split("\n").slice(1, -1).join("\n")),                   
      104 -    );                                                        
       98 +    const first = provider.calls[0];                          
       99 +    const second = provider.calls[1];                         
      100 +    expect(result.usage.inputTokens).toBeGreaterThan(first?.me
          +ssages[0]?.content.length ?? 0);                              
      101 +    const parsed = LlmExtractionSchema.safeParse(broken());   
      102 +    const errors = parsed.success ? "" : z.prettifyError(parse
          +d.error);                                                     
      103      expect(errors).toContain("vendor_name.quote");
      106 -    expect(errors).toContain("vendor_name.confidence");       
      104 +    expect(second?.messages).toEqual(                         
      105 +      buildRepairConversation(doc, JSON.stringify(broken()), e
          +rrors),                                                       
      106 +    );                                                        
      107    });
      108  
      109    it("cuts the error list for the repair call to 2000 chars", 
           async () => {

● Update(services\worker\src\extraction\extract.test.ts)
  ⎿  Added 2 lines, removed 1 line
      1 -import { ErrorCode, llmExtractionJsonSchema } from "@nexus/share
        -d";                                                             
      1 +import { ErrorCode, LlmExtractionSchema, llmExtractionJsonSchema
        + } from "@nexus/shared";                                        
      2  import { describe, expect, it } from "vitest";
      3 +import { z } from "zod";                                        
      4  import { LlmError } from "../llm/errors.js";
      5  import { MOCK_EXTRACTION, MockProvider } from "../llm/mock.js";
      6  import {

● Update(services\worker\src\extraction\extract.test.ts)
  ⎿  Added 5 lines, removed 4 lines
       95  
       96      expect(result.repaired).toBe(true);
       97      expect(result.data).toEqual(MOCK_EXTRACTION);
       98 -    expect(result.usage.outputTokens).toBe(200);              
       99 -    const first = provider.calls[0];                          
      100 -    const second = provider.calls[1];                         
      101 -    expect(result.usage.inputTokens).toBeGreaterThan(first?.me
          -ssages[0]?.content.length ?? 0);                              
       98 +    const [first, second] = provider.calls;                   
       99 +    expect(result.usage).toEqual({                            
      100 +      inputTokens: mockInputTokens(first) + mockInputTokens(se
          +cond),                                                        
      101 +      outputTokens: 200,                                      
      102 +    });                                                       
      103      const parsed = LlmExtractionSchema.safeParse(broken());
      104      const errors = parsed.success ? "" : z.prettifyError(parse
           d.error);
      105      expect(errors).toContain("vendor_name.quote");

● Update(services\worker\src\extraction\extract.test.ts)
  ⎿  Added 6 lines
      35    });
      36  }
      37  
      38 +// Same chars/4 estimate MockProvider reports.                 
      39 +function mockInputTokens(req: LlmRequest | undefined): number {
      40 +  if (!req) return 0;                                          
      41 +  return Math.ceil(req.messages.reduce((n, m) => n + m.content.
         +length, req.system.length) / 4);                               
      42 +}                                                              
      43 +                                                               
      44  const ok = () => MOCK_EXTRACTION;
      45  const broken = () => ({ ...MOCK_EXTRACTION, vendor_name: { valu
          e: null, quote: null } });
      46  

● Write(services\worker\src\extraction\extract.ts)
  ⎿  Wrote 149 lines to services\worker\src\extraction\extract.ts
       1 import {
       2   ErrorCode,
       3   LlmExtractionSchema,
       4   llmExtractionJsonSchema,
       5   type LlmExtraction,
       6 } from "@nexus/shared";
       7 import { z } from "zod";
       8 import { LlmError } from "../llm/errors.js";
       9 import {
      10   MAX_OUTPUT_TOKENS,
     … +164 lines (ctrl+o to expand)

● Bash(cd /e/contract-analysis-pipeline && sed -i 's/^export function
      lowercaseEnums/function lowercaseEnums/'
      services/worker/src/extraction/extract.ts && npx prettie…)
  ⎿   Test Files  19 passed (19)
           Tests  225 passed (225)
  ⎿  Updated services\worker\src\extraction\extract.test.ts (+17 -5)
       90        quote: "Master Agreement",
       91        confidence: "high",
       92      });
       93 -    expect(result.data.vendor_name).toEqual({ value: "Acme", q
          -uote: "Acme Ltd", confidence: "medium" });                    
       94 -    expect(result.data.risk_clauses[0]).toMatchObject({ catego
          -ry: "auto_renewal", severity: "high" });                      
       93 +    expect(result.data.vendor_name).toEqual({                 
       94 +      value: "Acme",                                          
       95 +      quote: "Acme Ltd",                                      
       96 +      confidence: "medium",                                   
       97 +    });                                                       
       98 +    expect(result.data.risk_clauses[0]).toMatchObject({       
       99 +      category: "auto_renewal",                               
      100 +      severity: "high",                                       
      101 +    });                                                       
      102    });
      103  
      104    it("repairs a schema failure once with its own reply and the
            zod errors, summing usage", async () => {
     ...
      161  
      162    it("retries a truncated reply without sending the cut-off te
           xt back", async () => {
      163      const provider = scripted(() => {
      157 -      throw new LlmError("bad_output", "output stopped at num_
          -predict", '{"vendor_name": {"quote": "aaaa', {                
      158 -        truncated: true,                                      
      159 -      });                                                     
      164 +      throw new LlmError(                                     
      165 +        "bad_output",                                         
      166 +        "output stopped at num_predict",                      
      167 +        '{"vendor_name": {"quote": "aaaa',                    
      168 +        {                                                     
      169 +          truncated: true,                                    
      170 +        },                                                    
      171 +      );                                                      
      172      }, ok);
      173  
      174      const result = await extractChunk(provider, chunk, opts);
  ⎿  Updated services\worker\src\extraction\extract.ts (+1 -1)
      55  
      56  // Models capitalize enum values ("High", "Contract") often eno
          ugh that a whole repair call for it
      57  // would be most of our repairs. Only enum positions are touche
          d, free text keeps its case.
      58 -export function lowercaseEnums(json: unknown): unknown {       
      58 +function lowercaseEnums(json: unknown): unknown {              
      59    if (json === null || typeof json !== "object" || Array.isArra
          y(json)) return json;
      60    const out: Record<string, unknown> = {};
      61    for (const [key, value] of Object.entries(json)) {
  Ran 2 shell commands (ctrl+o to expand)

● extractChunk is done, with one repair and the truncation case. Typecheck and
  lint are clean, and npm test passed: 34 files, 350 tests. Everything ran
  against MockProvider only.

  Changed:
  1. extraction/extract.ts: extractChunk(provider, chunk, { filename, 
     chunkCount, timeoutMs }) returns { chunkIndex, data, usage, repaired, 
     latencyMs }.
     - It lowercases confidence, severity, category and document_type.value
       before safeParse.
     - On a failure it makes one repair with buildRepairConversation, passing
       the z.prettifyError output cut to 2000 chars, or "Reply was not valid 
       JSON" for bad_output. A second failure throws
       PermanentError(EXTRACTION_INVALID) with the error summary.
     - Only bad_output triggers a repair. Timeouts and other LLM errors are
       rethrown for bullmq to retry.
  2. llm/errors.ts: LlmError didn't report truncation, so I added truncated: 
     boolean, passed through the options argument.
     - ollama sets it on done_reason === "length", openai on
       incomplete_details.reason === "max_output_tokens", anthropic on
       stop_reason === "max_tokens".
  3. llm/prompts/extract.v1.ts: added TRUNCATED_NOTE and
     buildTruncatedRetryConversation(doc), which returns [user(doc), user(note)]
     with no assistant turn. The existing v1 wording is unchanged.
  4. Tests:
     - extract.test.ts covers all five cases you listed. It also covers enum
       lowercasing, the 2000-char cut, bad_output twice, and timeouts not being
       repaired.
     - The provider tests now assert truncated.

  Choices you should check:
  1. Truncated empty reply. I also set truncated when the reply is empty because
     reasoning or thinking used up the token limit (openai and anthropic). That
     is still the "hit the limit" case, and it means the retry sends no empty
     assistant turn.
  2. Two user messages in a row. The truncation retry sends two consecutive user
     messages. All three APIs accept that; Anthropic merges them into one turn.

  Gaps (not fixed):
  1. Usage from failed calls is lost. When a call throws bad_output, its tokens
     aren't counted, because LlmError carries no usage. The sum only covers
     calls that returned. Fixing it means adding usage? to LlmError. Want that?
  2. Empty reply from Anthropic. A non-truncated empty reply (anthropic with no
     text block) would go back as an empty assistant turn. Anthropic rejects
     empty text content, so the repair would fail as invalid_request and the job
     would be marked INTERNAL instead of EXTRACTION_INVALID. This is rare, but
     tell me how you want it handled.

  Next: answer gap 1 (add usage to LlmError or not), then send the normalize
  step.

✻ Baked for 4m 11s · done Saturday 11:26 PM

❯ both choices fine.                                                            
                                                                                
  gap 1: yes, add usage? to LlmError and fill it wherever the provider has it   
  when it throws bad_output. extractChunk sums usage from failed calls too.     
  failed calls still cost tokens (and money on anthropic), and the evals        
  compare tokens per provider, so leaving them out makes a provider that needs  
  repairs look cheaper than it is.                                              
                                                                                
  gap 2: any empty previous reply, truncated or not, never goes back as an      
  assistant turn. same path as truncation: the original request again plus a    
  note. for the non-truncated empty case the note is "Your previous reply was   
  empty. Reply with the JSON only." test for it.                                
                                                                                
  then normalize.ts normalizeExtraction(data) -> { data, warnings }, this is    
  where loose turns into strict:                                                
                                                                                
  strings trimmed, empty -> null. quote "" or the literal string "null" -> null 
  (models do both)                                                              
  dates must be ^\d{4}-\d{2}-\d{2}$ and survive parseISO + format round trip,   
  else null + warning like effective_date: dropped "1st March 2026" (not        
  YYYY-MM-DD)                                                                   
  months int 0..1200, days 0..3650, 12.0 is fine as 12                          
  currency uppercased + 3 letters, amount finite >= 0                           
  value null -> quote null, confidence low (models fill a quote on null fields, 
  seen with qwen)                                                               
  strip one pair of wrapping {} from string values (qwen returned "{12 months   
  before the claim}")                                                           
  risk with empty quote (or "null") -> dropped with warning                     
                                                                                
  nothing bad gets saved quietly, it gets dropped and the warning says what the 
  model actually sent.                                                          
                                                                                
  the output is the strict field shape before grounding fills quote_verified /  
  quote_page. if shared doesn't have a type for that in-between shape, tell me  
  what you used instead of inventing a second copy of the schema.               
                                                                                
  tests: "1st March 2026" dropped, eur -> EUR, EURO dropped, 12.0 -> 12, -5     
  dropped, quote "null" -> null, null value with a filled quote -> quote null + 
  low, "{USD 50,000}" -> "USD 50,000", risk with quote "null" dropped with a    
  warning. mock only, typecheck, lint, test.                                    

  Ran 1 shell command (ctrl+o to expand)

● Shared has no type for the in-between shape. I'll derive it in the worker as a
  type-only Omit over ExtractionResult, so there's no second zod schema.
  Starting with usage on LlmError.

  Read 3 files, ran 1 shell command (ctrl+o to expand)

● Update(services\worker\src\llm\errors.ts)
  ⎿  Added 3 lines
       7    // The reply stopped at the output token limit. The repair st
          ep must not send that reply back: it is
       8    // up to maxOutputTokens of junk that would also force ollama
           into a bigger num_ctx and a reload.
       9    truncated?: boolean;
      10 +  // Tokens of a call that came back but couldn't be used. It s
         +till cost tokens (and money), and the                          
      11 +  // evals compare tokens per provider, so a provider that need
         +s repairs must not look cheaper.                               
      12 +  usage?: LlmUsage;                                            
      13  }
      14  
      15  // Providers translate their sdk/http failures into this one sh
          ape so classifyError doesn't need to

● Update(services\worker\src\llm\errors.ts)
  ⎿  Added 1 line
      16  // know about anthropic, openai or ollama error classes.
      17  export class LlmError extends Error {
      18    readonly truncated: boolean;
      19 +  readonly usage: LlmUsage | undefined;                        
      20  
      21    constructor(
      22      readonly kind: LlmErrorKind,

● Update(services\worker\src\llm\errors.ts)
  ⎿  Added 1 line
      28      super(message, opts);
      29      this.name = "LlmError";
      30      this.truncated = opts?.truncated ?? false;
      31 +    this.usage = opts?.usage;                                  
      32    }
      33  
      34    get retryable(): boolean {

● Update(services\worker\src\llm\errors.ts)
  ⎿  Added 2 lines
      1 +import type { LlmUsage } from "./types.js";                     
      2 +                                                                
      3  export type LlmErrorKind =
      4    "timeout" | "rate_limited" | "unavailable" | "auth" | "invalid
         _request" | "bad_output";
      5  

● Update(services\worker\src\llm\ollama.ts)
  ⎿  Added 3 lines, removed 1 line
      188        }
      189  
      190        const { message, done_reason, prompt_eval_count, eval_co
           unt } = parsed.data;
      191 +      const usage = { inputTokens: prompt_eval_count ?? 0, out
          +putTokens: eval_count ?? 0 };                                 
      192        const content = parseJson(message.content);
      193        if (!content.ok) {
      194          const truncated = done_reason === "length";
     ...
      198          throw new LlmError("bad_output", reason, message.conte
           nt, {
      199            cause: content.error,
      200            truncated,
      201 +          usage,                                              
      202          });
      203        }
      204  
      205        return {
      206          json: content.value,
      207          rawText: message.content,
      206 -        usage: { inputTokens: prompt_eval_count ?? 0, outputTo
          -kens: eval_count ?? 0 },                                      
      208 +        usage,                                                
      209          model: parsed.data.model ?? model,
      210          latencyMs,
      211        };

● Update(services\worker\src\llm\openai.ts)
  ⎿  Added 16 lines, removed 8 lines
      116        const res = await send(req);
      117        const latencyMs = Math.round(performance.now() - started
           );
      118  
      119 +      const usage = {                                         
      120 +        inputTokens: res.usage?.input_tokens ?? 0,            
      121 +        outputTokens: res.usage?.output_tokens ?? 0,          
      122 +      };                                                      
      123 +                                                              
      124        const refusal = refusalOf(res);
      125        if (refusal !== undefined) {
      121 -        throw new LlmError("bad_output", "model refused", refu
          -sal);                                                         
      126 +        throw new LlmError("bad_output", "model refused", refu
          +sal, { usage });                                              
      127        }
      128  
      129        const rawText = res.output_text;
      130        const reason = res.incomplete_details?.reason;
      131        if (reason === "content_filter") {
      127 -        throw new LlmError("bad_output", "output stopped by th
          -e content filter", rawText);                                  
      132 +        throw new LlmError("bad_output", "output stopped by th
          +e content filter", rawText, {                                 
      133 +          usage,                                              
      134 +        });                                                   
      135        }
      136        // Reasoning tokens count against the limit too, so a cu
           t-off reply can have no text at all.
      137        const truncated = reason === "max_output_tokens";
      138        if (rawText === "") {
      132 -        throw new LlmError("bad_output", "reply has no output 
          -text", rawText, { truncated });                               
      139 +        throw new LlmError("bad_output", "reply has no output 
          +text", rawText, { truncated, usage });                        
      140        }
      141  
      142        const parsed = parseJson(rawText);
     ...
      144          const message = truncated
      145            ? `output stopped at max_output_tokens (${req.maxOut
           putTokens}) before the json was complete`
      146            : "model output is not valid json";
      140 -        throw new LlmError("bad_output", message, rawText, { c
          -ause: parsed.error, truncated });                             
      147 +        throw new LlmError("bad_output", message, rawText, {  
      148 +          cause: parsed.error,                                
      149 +          truncated,                                          
      150 +          usage,                                              
      151 +        });                                                   
      152        }
      153  
      154        return {
      155          json: parsed.value,
      156          rawText,
      146 -        usage: {                                              
      147 -          inputTokens: res.usage?.input_tokens ?? 0,          
      148 -          outputTokens: res.usage?.output_tokens ?? 0,        
      149 -        },                                                    
      157 +        usage,                                                
      158          model: res.model,
      159          latencyMs,
      160        };

● Update(services\worker\src\llm\anthropic.ts)
  ⎿  Added 12 lines, removed 4 lines
      124          .map((block) => (block.type === "text" ? block.text : 
           ""))
      125          .join("");
      126  
      127 +      const usage = { inputTokens: res.usage.input_tokens, out
          +putTokens: res.usage.output_tokens };                         
      128 +                                                              
      129        if (res.stop_reason === "refusal") {
      130          // Even parseable text isn't the extraction when the m
           odel refused.
      131          const category = res.stop_details?.category ?? "unspec
           ified";
      130 -        throw new LlmError("bad_output", `model refused (categ
          -ory: ${category})`, rawText);                                 
      132 +        throw new LlmError("bad_output", `model refused (categ
          +ory: ${category})`, rawText, {                                
      133 +          usage,                                              
      134 +        });                                                   
      135        }
      136        // Thinking tokens count against max_tokens too, so a cu
           t-off reply can have no text block.
      137        const truncated = res.stop_reason === "max_tokens";
      138        if (rawText === "") {
      135 -        throw new LlmError("bad_output", "reply has no text bl
          -ock", rawText, { truncated });                                
      139 +        throw new LlmError("bad_output", "reply has no text bl
          +ock", rawText, { truncated, usage });                         
      140        }
      141  
      142        // rawText stays as the model wrote it, fence included, 
           so the repair call shows its real reply.
     ...
      145          const reason = truncated
      146            ? `output stopped at max_tokens (${req.maxOutputToke
           ns}) before the json was complete`
      147            : "model output is not valid json";
      144 -        throw new LlmError("bad_output", reason, rawText, { ca
          -use: parsed.error, truncated });                              
      148 +        throw new LlmError("bad_output", reason, rawText, {   
      149 +          cause: parsed.error,                                
      150 +          truncated,                                          
      151 +          usage,                                              
      152 +        });                                                   
      153        }
      154  
      155        return {
      156          json: parsed.value,
      157          rawText,
      150 -        usage: { inputTokens: res.usage.input_tokens, outputTo
          -kens: res.usage.output_tokens },                              
      158 +        usage,                                                
      159          model: res.model,
      160          latencyMs,
      161        };

● Adding provider test assertions for usage. Checking what the test helpers
  return by default.

  Ran 1 shell command (ctrl+o to expand)

● Bash(sed -i 's/^\(\s*\)expect(err.truncated).toBe(false);/&\n\1expect(err.usag
      e).toEqual({ inputTokens: 1200, outputTokens: 80 });/' ollama.test.ts &&
      sed -i 's/^\(\…)
  ⎿  anthropic.test.ts:196:    expect(err.usage).toEqual({ inputTokens: 900
     , outputTokens: 40 });
     anthropic.test.ts:230:    expect(err.usage).toEqual({ inputTokens: 900
     … +8 lines (ctrl+o to expand)
  ⎿  Updated services\worker\src\llm\anthropic.test.ts (+2 -0)
      193      expect(err.rawText).toBe('{"term": "12 mon');
      194      expect(err.cause).toBeInstanceOf(SyntaxError);
      195      expect(err.truncated).toBe(false);
      196 +    expect(err.usage).toEqual({ inputTokens: 900, outputTokens
          +: 40 });                                                      
      197    });
      198  
      199    it("says so when the output hit max_tokens", async () => {
     ...
      227      expect(err.kind).toBe("bad_output");
      228      expect(err.rawText).toBe("");
      229      expect(err.truncated).toBe(false);
      230 +    expect(err.usage).toEqual({ inputTokens: 900, outputTokens
          +: 40 });                                                      
      231    });
      232  
      233    it.each<[string, () => Error, LlmErrorKind]>([
  ⎿  Updated services\worker\src\llm\ollama.test.ts (+2 -0)
      347      expect(err.rawText).toBe('{"term": "12 mon');
      348      expect(err.cause).toBeInstanceOf(SyntaxError);
      349      expect(err.truncated).toBe(false);
      350 +    expect(err.usage).toEqual({ inputTokens: 1200, outputToken
          +s: 80 });                                                     
      351    });
      352  
      353    it("says so when the output hit num_predict, since that is t
           he usual reason for cut-off json", async () => {
     ...
      369  
      370      expect(err.kind).toBe("bad_output");
      371      expect(err.rawText).toBe('{"nope":true}');
      372 +    expect(err.usage).toBeUndefined();                        
      373    });
      374  });
  ⎿  Updated services\worker\src\llm\openai.test.ts (+2 -0)
      162      expect(err.rawText).toBe('{"term": "12 mon');
      163      expect(err.cause).toBeInstanceOf(SyntaxError);
      164      expect(err.truncated).toBe(false);
      165 +    expect(err.usage).toEqual({ inputTokens: 900, outputTokens
          +: 40 });                                                      
      166    });
      167  
      168    it("says so when the output hit max_output_tokens", async ()
            => {
     ...
      191      expect(err.kind).toBe("bad_output");
      192      expect(err.rawText).toBe("");
      193      expect(err.truncated).toBe(false);
      194 +    expect(err.usage).toEqual({ inputTokens: 900, outputTokens
          +: 40 });                                                      
      195    });
      196  
      197    it("marks an empty output as truncated when reasoning used u
           p max_output_tokens", async () => {

● Now generalizing the no-assistant-turn retry in extract.v1.ts so it covers the
  empty reply case too.

  Read 1 file (ctrl+o to expand)

● Update(services\worker\src\llm\prompts\extract.v1.ts)
  ⎿  Added 7 lines, removed 4 lines
      61  export const TRUNCATED_NOTE =
      62    "Your previous reply was cut off at the length limit. Keep ev
          ery quote to one sentence.";
      63  
      64 -// No assistant turn here: a cut-off reply is up to maxOutputTo
         -kens of junk, and sending it back would                        
      65 -// push ollama into a bigger num_ctx and a model reload for not
         -hing the model can use.                                        
      66 -export function buildTruncatedRetryConversation(userMessage: st
         -ring): LlmMessage[] {                                          
      64 +export const EMPTY_REPLY_NOTE = "Your previous reply was empty.
         + Reply with the JSON only.";                                   
      65 +                                                               
      66 +// No assistant turn here. A cut-off reply is up to maxOutputTo
         +kens of junk, and sending it back would                        
      67 +// push ollama into a bigger num_ctx and a model reload for not
         +hing the model can use. An empty reply                         
      68 +// can't go back either: anthropic rejects an assistant turn wi
         +th empty text.                                                 
      69 +export function buildRetryConversation(userMessage: string, not
         +e: string): LlmMessage[] {                                     
      70    return [
      71      { role: "user", content: userMessage },
      69 -    { role: "user", content: TRUNCATED_NOTE },                 
      72 +    { role: "user", content: note },                           
      73    ];
      74  }
      75  

  Read 1 file (ctrl+o to expand)

● Update(services\worker\src\llm\prompts\extract.v1.test.ts)
  ⎿  Added 9 lines, removed 5 lines
      122    });
      123  });
      124  
      125 -describe("buildTruncatedRetryConversation", () => {           
      126 -  it("resends the document with the length note and no assista
          -nt turn", () => {                                             
      127 -    const doc = buildUserMessage({ filename: "a.pdf", text: "x
          -", chunkIndex: 0, chunkCount: 1 });                           
      128 -                                                              
      125 +describe("buildRetryConversation", () => {                    
      126 +  it("pins the wording of both notes", () => {                
      127      expect(TRUNCATED_NOTE).toBe(
      128        "Your previous reply was cut off at the length limit. Ke
           ep every quote to one sentence.",
      129      );
      132 -    expect(buildTruncatedRetryConversation(doc)).toEqual([    
      130 +    expect(EMPTY_REPLY_NOTE).toBe("Your previous reply was emp
          +ty. Reply with the JSON only.");                              
      131 +  });                                                         
      132 +                                                              
      133 +  it("resends the document with the note and no assistant turn
          +", () => {                                                    
      134 +    const doc = buildUserMessage({ filename: "a.pdf", text: "x
          +", chunkIndex: 0, chunkCount: 1 });                           
      135 +                                                              
      136 +    expect(buildRetryConversation(doc, TRUNCATED_NOTE)).toEqua
          +l([                                                           
      137        { role: "user", content: doc },
      138        { role: "user", content: TRUNCATED_NOTE },
      139      ]);

● Update(services\worker\src\llm\prompts\extract.v1.test.ts)
  ⎿  Added 2 lines, removed 1 line
       1  import { describe, expect, it } from "vitest";
       2  import {
       3    PROMPT_VERSION,
       4 +  EMPTY_REPLY_NOTE,                                            
       5    SCHEMA_NAME,
       6    TRUNCATED_NOTE,
       7    buildRepairConversation,
       8    buildRepairMessage,
       9 +  buildRetryConversation,                                      
      10    buildSystemPrompt,
       9 -  buildTruncatedRetryConversation,                             
      11    buildUserMessage,
      12  } from "./extract.v1.js";
      13  

  Read 1 file (ctrl+o to expand)

● Update(services\worker\src\extraction\extract.ts)
  ⎿  Added 8 lines, removed 6 lines
       96      // Timeouts, rate limits and the rest are bullmq's to retr
           y, not something a repair can fix.
       97      if (!(err instanceof LlmError) || err.kind !== "bad_output
           ") throw err;
       98      const rawText = err.rawText ?? "";
       99 -    // The provider threw before returning, so a failed call's
          - tokens are not known here.                                   
       99 +    // A cut-off or empty reply never goes back as the assista
          +nt turn, see buildRetryConversation.                          
      100 +    const note = err.truncated ? TRUNCATED_NOTE : rawText.trim
          +() === "" ? EMPTY_REPLY_NOTE : null;                          
      101      return {
      102        ok: false,
      102 -      usage: ZERO,                                            
      103 -      errors: err.truncated ? err.message : `${NOT_JSON}: ${er
          -r.message}`,                                                  
      104 -      retry: err.truncated                                    
      105 -        ? buildTruncatedRetryConversation                     
      106 -        : (doc) => buildRepairConversation(doc, rawText, NOT_J
          -SON),                                                         
      103 +      usage: err.usage ?? ZERO,                               
      104 +      errors: note === null ? `${NOT_JSON}: ${err.message}` : 
          +err.message,                                                  
      105 +      retry:                                                  
      106 +        note === null                                         
      107 +          ? (doc) => buildRepairConversation(doc, rawText, NOT
          +_JSON)                                                        
      108 +          : (doc) => buildRetryConversation(doc, note),       
      109      };
      110    }
      111  

● Update(services\worker\src\extraction\extract.ts)
  ⎿  Added 3 lines, removed 1 line
       7  import { z } from "zod";
       8  import { LlmError } from "../llm/errors.js";
       9  import {
      10 +  EMPTY_REPLY_NOTE,                                            
      11    MAX_OUTPUT_TOKENS,
      12    SCHEMA_NAME,
      13 +  TRUNCATED_NOTE,                                              
      14    buildRepairConversation,
      15 +  buildRetryConversation,                                      
      16    buildSystemPrompt,
      14 -  buildTruncatedRetryConversation,                             
      17    buildUserMessage,
      18  } from "../llm/prompts/extract.v1.js";
      19  import type { LlmMessage, LlmProvider, LlmResponse, LlmUsage } 
          from "../llm/types.js";
  Searched for 1 pattern, read 1 file (ctrl+o to expand)

● Usage on LlmError and the empty-reply retry are wired in. Updating the extract
  tests now, then I'll write normalize.

● Update(services\worker\src\extraction\extract.test.ts)
  ⎿  Added 28 lines, removed 4 lines
      165          "bad_output",
      166          "output stopped at num_predict",
      167          '{"vendor_name": {"quote": "aaaa',
      168 -        {                                                     
      169 -          truncated: true,                                    
      170 -        },                                                    
      168 +        { truncated: true },                                  
      169        );
      170      }, ok);
      171  
      172      const result = await extractChunk(provider, chunk, opts);
      173  
      174      expect(result.repaired).toBe(true);
      177 -    expect(provider.calls[1]?.messages).toEqual(buildTruncated
          -RetryConversation(doc));                                      
      175 +    expect(provider.calls[1]?.messages).toEqual(buildRetryConv
          +ersation(doc, TRUNCATED_NOTE));                               
      176    });
      177  
      178 +  it("retries an empty reply with the empty note instead of an
          + empty assistant turn", async () => {                         
      179 +    const provider = scripted(() => {                         
      180 +      throw new LlmError("bad_output", "reply has no text bloc
          +k", "  ");                                                    
      181 +    }, ok);                                                   
      182 +                                                              
      183 +    const result = await extractChunk(provider, chunk, opts); 
      184 +                                                              
      185 +    expect(result.repaired).toBe(true);                       
      186 +    expect(provider.calls[1]?.messages).toEqual(buildRetryConv
          +ersation(doc, EMPTY_REPLY_NOTE));                             
      187 +  });                                                         
      188 +                                                              
      189 +  it("counts the tokens of a failed call in the usage", async 
          +() => {                                                       
      190 +    const provider = scripted(() => {                         
      191 +      throw new LlmError("bad_output", "model output is not va
          +lid json", "{", {                                             
      192 +        usage: { inputTokens: 700, outputTokens: 4096 },      
      193 +      });                                                     
      194 +    }, ok);                                                   
      195 +                                                              
      196 +    const result = await extractChunk(provider, chunk, opts); 
      197 +                                                              
      198 +    expect(result.usage).toEqual({                            
      199 +      inputTokens: 700 + mockInputTokens(provider.calls[1]),  
      200 +      outputTokens: 4096 + 100,                               
      201 +    });                                                       
      202 +  });                                                         
      203 +                                                              
      204    it("fails with EXTRACTION_INVALID when the repair call retur
           ns bad_output too", async () => {
      205      const badOutput = () => {
      206        throw new LlmError("bad_output", "model output is not va
           lid json", "{");

● Update(services\worker\src\extraction\extract.test.ts)
  ⎿  Added 3 lines, removed 1 line
       4  import { LlmError } from "../llm/errors.js";
       5  import { MOCK_EXTRACTION, MockProvider } from "../llm/mock.js";
       6  import {
       7 +  EMPTY_REPLY_NOTE,                                            
       8    MAX_OUTPUT_TOKENS,
       9    SCHEMA_NAME,
      10 +  TRUNCATED_NOTE,                                              
      11    buildRepairConversation,
      12    buildRepairMessage,
      13 +  buildRetryConversation,                                      
      14    buildSystemPrompt,
      12 -  buildTruncatedRetryConversation,                             
      15    buildUserMessage,
      16  } from "../llm/prompts/extract.v1.js";
      17  import type { LlmRequest } from "../llm/types.js";

  Ran 1 shell command (ctrl+o to expand)

● Normalize next. Checking how date-fns parseISO/format handle bad input before
  relying on them.

  Ran 1 shell command (ctrl+o to expand)

● date-fns behaves as expected: parseISO gives Invalid Date for 2026-02-30, and
  format throws on it, so I check isValid first. Writing the normalize tests.

● Write(services\worker\src\extraction\normalize.test.ts)
  ⎿  Wrote 179 lines to services\worker\src\extraction\normalize.test.ts
       1 import type { LlmExtraction } from "@nexus/shared";
       2 import { describe, expect, it } from "vitest";
       3 import { MOCK_EXTRACTION } from "../llm/mock.js";
       4 import { normalizeExtraction } from "./normalize.js";
       5 
         on {
       7   return { ...MOCK_EXTRACTION, ...fields };
       8 }
       9 
      10 const risk = {
     … +208 lines (ctrl+o to expand)

● Write(services\worker\src\extraction\normalize.ts)
  ⎿  Wrote 158 lines to services\worker\src\extraction\normalize.ts
       1 import type {
       2   Confidence,
       3   ExtractedFieldName,
       5   LlmExtraction,
       6 } from "@nexus/shared";
       7 import { format, isValid, parseISO } from "date-fns";
       8 
         / quote_page. Derived from
      10 // ExtractionResult instead of a second schema, so the two can't
          drift apart.
     … +180 lines (ctrl+o to expand)

● Update(services\worker\src\extraction\normalize.ts)
  ⎿  Added 1 line, removed 1 line
      109        }
      110      }
      111      // Models fill a quote on fields they couldn't find (seen 
           with qwen). Without a value that quote
      112 -    // supports nothing, and grounding would mark a not-found 
          -field as verified.                                            
      112 +    // supports nothing, so it must not count toward grounding
          +.                                                             
      113      if (value === null) return { value: null, quote: null, con
           fidence: "low" };
      114      return { value, quote: cleanQuote(loose.quote), confidence
           : loose.confidence };
      115    }

  Ran 1 shell command (ctrl+o to expand)

● Adding one more test: every normalized field must pass the strict stored
  schema once the verification flags are added.

● Update(services\worker\src\extraction\normalize.test.ts)
  ⎿  Added 24 lines
      169      ]);
      170    });
      171  
      172 +  it("produces fields the strict stored schema accepts once gr
          +ounding adds its flags", () => {                              
      173 +    const { data } = normalizeExtraction(                     
      174 +      withFields({                                            
      175 +        effective_date: { value: "2026-03-01", quote: "1 March
          + 2026", confidence: "high" },                                 
      176 +        initial_term_months: { value: 12.0, quote: "12 months"
          +, confidence: "high" },                                       
      177 +        total_contract_value: {                               
      178 +          value: { amount: 5000, currency: "usd" },           
      179 +          quote: "USD 5,000",                                 
      180 +          confidence: "medium",                               
      181 +        },                                                    
      182 +        risk_clauses: [{ ...risk }],                          
      183 +      }),                                                     
      184 +    );                                                        
      185 +    const flags = { quote_verified: false, quote_page: null };
      186 +    const shape = ExtractionResultSchema.shape;               
      187 +                                                              
      188 +    for (const name of ExtractedFieldName.options) {          
      189 +      expect(shape[name].safeParse({ ...data[name], ...flags }
          +).success, name).toBe(true);                                  
      190 +    }                                                         
      191 +    expect(shape.risk_clauses.safeParse(data.risk_clauses.map(
          +(r) => ({ ...r, ...flags }))).success).toBe(                  
      192 +      true,                                                   
      193 +    );                                                        
      194 +  });                                                         
      195 +                                                              
      196    it("passes the mock extraction through with nothing dropped"
           , () => {
      197      const { data, warnings } = normalizeExtraction(MOCK_EXTRAC
           TION);
      198  

● Update(services\worker\src\extraction\normalize.test.ts)
  ⎿  Added 1 line, removed 1 line
      1 -import type { LlmExtraction } from "@nexus/shared";             
      1 +import { ExtractedFieldName, ExtractionResultSchema, type LlmExt
        +raction } from "@nexus/shared";                                 
      2  import { describe, expect, it } from "vitest";
      3  import { MOCK_EXTRACTION } from "../llm/mock.js";
      4  import { normalizeExtraction } from "./normalize.js";

● Bash(npx prettier --write services/worker/src/extraction >/dev/null && npm run
      typecheck 2>&1 | grep -E "error TS" | head -20; echo "typecheck exit
      ${PIPESTATUS[0]}"…)
  ⎿  typecheck exit 0

     > lint
     … +4 lines (ctrl+o to expand)
  ⎿  Updated services\worker\src\extraction\normalize.test.ts (+3 -3)
      188      for (const name of ExtractedFieldName.options) {
      189        expect(shape[name].safeParse({ ...data[name], ...flags }
           ).success, name).toBe(true);
      190      }
      191 -    expect(shape.risk_clauses.safeParse(data.risk_clauses.map(
          -(r) => ({ ...r, ...flags }))).success).toBe(                  
      192 -      true,                                                   
      193 -    );                                                        
      191 +    expect(                                                   
      192 +      shape.risk_clauses.safeParse(data.risk_clauses.map((r) =
          +> ({ ...r, ...flags }))).success,                             
      193 +    ).toBe(true);                                             
      194    });
      195  
      196    it("passes the mock extraction through with nothing dropped"
           , () => {
  ⎿  (timeout 5m)

● Both gaps are fixed and normalizeExtraction is in. Typecheck and lint are
  clean, and npm test passed: 35 files, 365 tests. Everything ran against mocks
  only.

  Gap 1, usage from failed calls:
  1. LlmError now has usage?: LlmUsage.
     - All three providers fill it on every bad_output throw where they have the
       response, including refusals and content-filter stops.
     - The one exception is ollama when the reply isn't a chat completion at
       all: there are no counts to read, so usage stays undefined.
  2. extractChunk adds a failed call's err.usage into the total. There's a test
     where a failed call's 700 in / 4096 out tokens are counted.

  Gap 2, empty replies:
  1. extract.v1.ts: buildTruncatedRetryConversation became
     buildRetryConversation(doc, note), plus EMPTY_REPLY_NOTE = "Your previous
     reply was empty. Reply with the JSON only." Nothing else in v1 changed.
  2. A truncated reply gets TRUNCATED_NOTE. A non-truncated reply that is empty
     or whitespace gets EMPTY_REPLY_NOTE. Neither one goes back as an assistant
     turn. There's a test for the empty case.

  extraction/normalize.ts: normalizeExtraction(data) returns { data, warnings }
  and follows every rule you listed. All the tests you asked for are there. I
  added tests for:
  - 2026-02-30 (dropped as not a real date)
  - 12.5 months (dropped)
  - every normalized field passing ExtractionResultSchema's field schemas once
    quote_verified and quote_page are added

  The in-between type: shared has no type for it, so I used a type-only
  derivation instead of a second schema:
  type Unverified<T> = Omit<T, "quote_verified" | "quote_page">;
  type NormalizedExtraction =
    { [K in ExtractedFieldName]: Unverified<ExtractionResult[K]> }
    & { risk_clauses: Unverified<ExtractionResult["risk_clauses"][number]>[];
  summary: string };
  It lives in normalize.ts. If the strict schema changes, this type follows it.

  Choices you should check:
  1. Wording of the count warning. Out of range and not whole share one reason:
     renewal_term_months: dropped -5 (not a whole number in 0..1200).
  2. Brace stripping. It only applies to string values (including dates), not to
     quotes.
  3. Quote cleanup. A quote of "NULL" or "Null" also becomes null. I compare
     case-insensitively.
  4. Risk text. A risk clause's title and explanation are trimmed but stay
     strings, because the strict schema requires strings there.

  Not handled: a string value (not a quote) of "null", for example vendor_name: 
  "null", is kept as the text "null". Your rules only covered quotes. Do you
  want values handled the same way?

  Next: answer the "null" value question, then send the ground step.

✻ Brewed for 4m 19s · done Saturday 11:40 PM

❯ choices 1-4 fine, the type derivation too.                                    
                                                                                
  "null" values: yes. a whole string value (not a quote) that is "null",        
  "none", "n/a", "not stated" or "not specified", any case, becomes null, and   
  its quote goes to null + confidence low like any other null. no warning, it's 
  just "not found". test it.                                                    
                                                                                
  then grounding.ts. this is my main defense against made up values and         
  injected ones, every quote gets checked against the real text.                
                                                                                
  buildGroundingIndex(fullText), verifyQuote(index, quote) -> { verified,       
  method exact|fuzzy|null, page, score }, groundExtraction(index, data) -> {    
  data, score }                                                                 
                                                                                
  normalize both sides: NFKC, lowercase, curly quotes to straight, all the dash 
  variants + minus sign to "-", strip [[page N]], collapse whitespace, trim.    
  build it page by page and keep the start offset of each page.                 
                                                                                
  - ... or … in a quote -> split into segments, all segments >= 8 chars have to 
  match, in order. shorter segments are ignored (the 3b ended a cut quote with  
  "...3."), at least one segment has to be >= 8. this also covers ollama        
  quotes cut at the 300 char cap                                                
  - pdf quotes come back with \n from the line wrapping (seen with sonnet),     
  whitespace collapse on both sides handles it                                  
  - exact: indexOf on the normalized text -> score 1. if that misses, try again 
  with all whitespace removed on both sides (qwen wrote "(the Customer).1.      
  Services" where the pdf has a line break). keep an offset map so the page is  
  still right                                                                   
  - quotes under 12 chars ("USD 50,000") can only verify by exact match, never  
  fuzzy                                                                         
  - fuzzy: tokenize on \W+, anchor on the 2 rarest quote tokens (by doc         
  frequency), window of quote length lined up with the anchor, score = multiset 
  overlap / quote tokens, >= 0.9 passes                                         
  - page = last page start <= match offset, null for docx                       
  - groundExtraction sets quote_verified + quote_page everywhere, unverified -> 
  confidence low, score = verified / total quotes or null                       
                                                                                
  tests: curly vs straight, extra spaces and newlines, missing space at a line  
  break, quote crossing a page marker, ellipsis with a short trailing segment,  
  short exact quote passes, short quote with one char off fails, fuzzy 1 word   
  off passes / 3 off fails, invented quote fails, right page on page 3, docx -> 
  null page. mock only, typecheck, lint, test.                                  

● First the "null" value words in normalize, then grounding.

  Read 1 file (ctrl+o to expand)

● Update(services\worker\src\extraction\normalize.ts)
  ⎿  Added 5 lines, removed 1 line
      29  const MAX_MONTHS = 1200;
      30  const MAX_DAYS = 3650;
      31  
      32 +// Models write "not found" as text instead of null. That is a 
         +missing value, not a bad one, so it                            
      33 +// becomes null without a warning.                             
      34 +const NOT_FOUND_WORDS = new Set(["null", "none", "n/a", "not st
         +ated", "not specified"]);                                      
      35 +                                                               
      36  // Trimmed, and blank becomes null. One pair of wrapping braces
           goes because qwen sometimes returns
      37  // values like "{12 months before the claim}", copying the brac
          es from the schema's object syntax.
      38  function cleanText(value: string): string | null {
      39    let text = value.trim();
      40    if (text.startsWith("{") && text.endsWith("}")) text = text.s
          lice(1, -1).trim();
      37 -  return text === "" ? null : text;                            
      41 +  return text === "" || NOT_FOUND_WORDS.has(text.toLowerCase())
         + ? null : text;                                                
      42  }
      43  
      44  // Models write both "" and the string "null" for a missing quo
          te.

  Read 1 file (ctrl+o to expand)

● Update(services\worker\src\extraction\normalize.test.ts)
  ⎿  Added 24 lines
      151      expect(data.governing_law.value).toBe("{New York}");
      152    });
      153  
      154 +  it.each(["null", "NONE", "n/a", "Not Stated", " not specifie
          +d ", "{N/A}"])(                                               
      155 +    "treats a value of %j as not found: null, quote null, low,
          + no warning",                                                 
      156 +    (word) => {                                               
      157 +      const { data, warnings } = normalizeExtraction(         
      158 +        withFields({                                          
      159 +          governing_law: { value: word, quote: "Governing law:
          + not stated", confidence: "high" },                           
      160 +          effective_date: { value: word, quote: "x", confidenc
          +e: "medium" },                                                
      161 +        }),                                                   
      162 +      );                                                      
      163 +                                                              
      164 +      expect(data.governing_law).toEqual({ value: null, quote:
          + null, confidence: "low" });                                  
      165 +      expect(data.effective_date).toEqual({ value: null, quote
          +: null, confidence: "low" });                                 
      166 +      expect(warnings).toEqual([]);                           
      167 +    },                                                        
      168 +  );                                                          
      169 +                                                              
      170 +  it("keeps a value that only contains a not-found word", () =
          +> {                                                           
      171 +    const { data } = normalizeExtraction(                     
      172 +      withFields({ liability_cap: { value: "None of the above"
          +, quote: "x", confidence: "high" } }),                        
      173 +    );                                                        
      174 +                                                              
      175 +    expect(data.liability_cap.value).toBe("None of the above")
          +;                                                             
      176 +  });                                                         
      177 +                                                              
      178    it("drops a risk clause whose quote is 'null' or empty and k
           eeps the rest trimmed", () => {
      179      const { data, warnings } = normalizeExtraction(
      180        withFields({

● Now grounding. Tests first.

● Write(services\worker\src\extraction\grounding.test.ts)
  ⎿  Wrote 162 lines to services\worker\src\extraction\grounding.test.ts
      1 import { describe, expect, it } from "vitest";
      3 import { buildGroundingIndex, groundExtraction, verifyQuote } fro
        m "./grounding.js";
      5 
      6 const PDF = [
        between Acme Ltd (the “Vendor”) and Nexus Corp\n(the Customer).\n
        1. Services\nThe Vendor shall provide hosting services. All fees 
      8   "[[page 2]]\npayable monthly in advance. The Customer shall pay
         each invoice within thirty (30) days of receipt\nof a correct in
      9   "[[page 3]]\n7. Liability\nThe total liability of th
     … +193 lines (ctrl+o to expand)

● Write(services\worker\src\extraction\grounding.ts)  ⎿  Wrote 268 lines to services\worker\src\extraction\grounding.ts
       1 import type { Confidence, ExtractionResult } from "@nexus/shared
         ";
       3 
       4 // The main defense against made up and injected values: a value
          only counts as verified when its
       6 
       7 export type GroundedExtraction = Pick<
       8   ExtractionResult,
         ionResult : never
      10 >;
     … +305 lines (ctrl+o to expand)

● Update(services\worker\src\extraction\grounding.ts)
  ⎿  Added 2 lines, removed 4 lines
       4  // The main defense against made up and injected values: a valu
          e only counts as verified when its
       5  // quote is found in the real document text.
       6  
       7 -export type GroundedExtraction = Pick<                         
       8 -  ExtractionResult,                                            
       9 -  NormalizedExtraction extends infer N ? keyof N & keyof Extrac
         -tionResult : never                                             
      10 ->;                                                             
       7 +// The normalized fields with quote_verified / quote_page fille
         +d, taken from the stored type.                                 
       8 +export type GroundedExtraction = Pick<ExtractionResult, keyof N
         +ormalizedExtraction>;                                          
       9  
      10  export interface QuoteCheck {
      11    verified: boolean;

● Update(services\worker\src\extraction\grounding.ts)
  ⎿  Added 1 line, removed 1 line
      192  }
      193  
      194  export function verifyQuote(index: GroundingIndex, quote: stri
           ng): QuoteCheck {
      195 -  // A quote cut with "..." (by the model, or at ollama's 300 
          -char cap) must match piece by piece.                          
      195 +  // A quote the model shortened with "..." must match piece b
          +y piece, in order.                                            
      196    const segments = normalizeForMatch(quote)
      197      .split(ELLIPSIS)
      198      .map((s) => s.trim())

● Bash(npx prettier --write services/worker/src/extraction >/dev/null && npx
      vitest run services/worker/src/extraction 2>&1 | grep -E "Test Files|Tests
      |FAIL|×|Expecte…)
  ⎿   Test Files  5 passed (5)
           Tests  56 passed (56)
  ⎿  Updated services\worker\src\extraction\grounding.test.ts (+14 -3)
      88  
      89    it("fails an invented quote", () => {
      90      expect(
      91 -      verifyQuote(index, "Nexus Corp shall pay a termination fe
         -e of USD 1,000,000 on any early exit."),                       
      91 +      verifyQuote(                                             
      92 +        index,                                                 
      93 +        "Nexus Corp shall pay a termination fee of USD 1,000,00
         +0 on any early exit.",                                         
      94 +      ),                                                       
      95      ).toMatchObject({ verified: false, method: null, page: null
           });
      96    });
      97  
     ...
      119      const { data: normalized } = normalizeExtraction({
      120        ...MOCK_EXTRACTION,
      121        vendor_name: { value: "Acme Ltd", quote: "Acme Ltd", con
           fidence: "high" },
      119 -      liability_cap: { value: "USD 50,000", quote: "shall not 
          -exceed USD 50,000", confidence: "high" },                     
      122 +      liability_cap: {                                        
      123 +        value: "USD 50,000",                                  
      124 +        quote: "shall not exceed USD 50,000",                 
      125 +        confidence: "high",                                   
      126 +      },                                                      
      127        payment_terms: { value: "net 15", quote: "within fifteen
            (15) days", confidence: "high" },
      128        risk_clauses: [
      129          { ...risk, quote: "shall not exceed USD 50,000 in the 
           aggregate" },
     ...
      140        quote_verified: true,
      141        quote_page: 1,
      142      });
      136 -    expect(data.liability_cap).toMatchObject({ quote_verified:
          - true, quote_page: 3, confidence: "high" });                  
      143 +    expect(data.liability_cap).toMatchObject({                
      144 +      quote_verified: true,                                   
      145 +      quote_page: 3,                                          
      146 +      confidence: "high",                                     
      147 +    });                                                       
      148      expect(data.payment_terms).toMatchObject({
      149        quote_verified: false,
      150        quote_page: null,
  ⎿  Updated services\worker\src\extraction\grounding.ts (+11 -2)
      164  
      165  // Anchors on the quote's rarest tokens, so only a few candida
           te windows get scored instead of every
      166  // position in the document. Each window is as long as the quo
           te and lined up with the anchor.
      167 -function fuzzyMatch(index: GroundingIndex, segment: string, fr
          -om: number): Match | { score: number } {                      
      167 +function fuzzyMatch(                                          
      168 +  index: GroundingIndex,                                      
      169 +  segment: string,                                            
      170 +  from: number,                                               
      171 +): Match | { score: number } {                                
      172    const quote = tokenize(segment).map((t) => t.value);
      173    if (quote.length === 0) return { score: 0 };
      174    const anchors = [...new Set(quote)]
     ...
      192    const head = index.tokens[best.first];
      193    const tail = index.tokens[best.last];
      194    if (best.score < FUZZY_PASS || !head || !tail) return { scor
           e: best.score };
      191 -  return { start: head.start, end: tail.start + tail.value.len
          -gth, method: "fuzzy", score: best.score };                    
      195 +  return {                                                    
      196 +    start: head.start,                                        
      197 +    end: tail.start + tail.value.length,                      
      198 +    method: "fuzzy",                                          
      199 +    score: best.score,                                        
      200 +  };                                                          
      201  }
      202  
      203  export function verifyQuote(index: GroundingIndex, quote: stri
           ng): QuoteCheck {

  Ran 1 shell command (ctrl+o to expand)

● The "null" value words and grounding are in. Typecheck and lint are clean, and
  npm test passed: 36 files, 385 tests. Everything ran against mocks only.

  normalize.ts:
  - A whole string value of null, none, n/a, not stated or not specified, in any
    case, becomes null. Its quote goes to null and confidence to low, with no
    warning.
  - This also covers dates and values like {N/A}, since brace stripping runs
    first.
  - Tests cover all five words. Another test checks that "None of the above" is
    kept.

  grounding.ts: buildGroundingIndex, verifyQuote and groundExtraction follow
  your spec. All the tests you asked for are there. I added tests for segments
  out of order, an ellipsis quote with no segment of 8+ chars, and a null score
  when there are no quotes.

  Behaviour your spec didn't pin down:
  1. Score on failure. A quote that fails still returns its best fuzzy score
     instead of 0, so a near miss can be seen in logs. A short quote that misses
     gets score 0, because fuzzy matching never runs for it.
  2. Values without a quote. A field with a value but a null quote counts as
     unverified and drops to confidence low. It is not counted in score, which
     only counts quotes that exist.
  3. Unverified values are kept. When a quote doesn't verify, the value stays in
     place with confidence low, so a reviewer still sees it. Grounding never
     sets a value to null.
  4. Risk clauses. Risk clauses get quote_verified and quote_page, but they have
     no confidence field to lower.
  5. Output type. GroundedExtraction = Pick<ExtractionResult, keyof 
     NormalizedExtraction>, taken from the stored type like before.

  One concern: in JS, \W+ only treats ASCII letters as word characters. A German
  or French contract would split "Kündigung" into k and ndigung. Both sides
  split the same way, so matching still works, but fuzzy scores on non-English
  text would rest on token fragments. /[^\p{L}\p{N}]+/u would fix it. I kept \W+
  as you specified. Want it switched?

  Next: answer the \W+ question, then send the merge step.

✻ Worked for 3m 0s · done Saturday 11:49 PM

❯ yes switch to /[^\p{L}\p{N}]+/u, and use that same tokenizer everywhere we    
  tokenize (merge dedupe below too).                                            
                                                                                
  choices 1, 3, 4, 5 fine. change 2: a field with a value but no quote counts   
  as an unverified quote in the score, not left out. otherwise a model that     
  skips quotes looks better grounded than one that quotes slightly wrong. score 
  = verified / (non-null fields + risk clauses), null if that's 0. update the   
  test.                                                                         
                                                                                
  then merge.ts mergeExtractions(chunks) -> { data, conflicts }. merging in     
  code not with another llm call, deterministic and I can explain why each      
  value won.                                                                    
                                                                                
  1 chunk -> as is                                                              
  scalars: non-null candidates sorted by verified, then confidence, then chunk  
  index. take the first. another verified one with a different value (strings   
  case/space insensitive, numbers exact, money amount + currency) -> conflict   
  with all distinct verified values. chunks only report their own part, so      
  nulls from other chunks never count against a value                           
  document_type: majority vote, tie -> earliest                                 
  risks: concat, dedupe same category + quote token jaccard >= 0.6, keep higher 
  severity then verified then earlier. the overlap block between chunks means   
  the same clause often comes back twice, that's the main thing this dedupe is  
  for                                                                           
                                                                                
  summarize.ts: 1 chunk -> its own summary. more -> summary.v1 call with the    
  merged data without quotes, 512 max out, any error -> first chunk's summary + 
  warning "summary: fell back to first chunk". the extraction already           
  succeeded at that point, a failed summary shouldn't fail the document.        
                                                                                
  tests: verified beats unverified, high beats medium, two verified different   
  amounts -> conflict, same value from two chunks -> no conflict, overlap       
  duplicate risk deduped, dedupe keeps higher severity, summary error ->        
  fallback + warning. mock only, typecheck, lint, test.                         

● Switching grounding to the Unicode tokenizer and fixing the score first.
  Checking how the worker passes its logger around, since summarize will swallow
  errors.

  Ran 2 shell commands (ctrl+o to expand)

● Summary gets its own MAX_OUTPUT_TOKENS = 512 in summary.v1.ts. factory.ts will
  use it for the summary template; the extraction budget still decides the
  floor. Now grounding edits.

  Read 1 file, ran 1 shell command (ctrl+o to expand)

● Update(services\worker\src\extraction\grounding.ts)
  ⎿  Added 5 lines, removed 1 line
      234    index: GroundingIndex,
      235    data: NormalizedExtraction,
      236  ): { data: GroundedExtraction; score: number | null } {
      237 +  // Every found value and every risk clause counts, quoted or
          + not. Leaving out values without a quote                      
      238 +  // would make a model that skips quotes look better grounded
          + than one that quotes slightly wrong.                         
      239    let total = 0;
      240    let verified = 0;
      241  
      242    function check(quote: string | null): { quote_verified: bool
           ean; quote_page: number | null } {
      241 -    if (quote === null) return { quote_verified: false, quote_
          -page: null };                                                 
      243      total++;
      244 +    if (quote === null) return { quote_verified: false, quote_
          +page: null };                                                 
      245      const result = verifyQuote(index, quote);
      246      if (result.verified) verified++;
      247      return { quote_verified: result.verified, quote_page: resu
           lt.page };
     ...
      250    // A value whose quote isn't in the document may be made up 
           or injected, so it keeps the value for
      251    // the reviewer but drops to low confidence.
      252    function ground<F extends UngroundedField>(field: F) {
      253 +    // A not-found field has nothing to verify and stays out o
          +f the score.                                                  
      254 +    if (field.value === null) return { ...field, quote_verifie
          +d: false, quote_page: null };                                 
      255      const flags = check(field.quote);
      256      const confidence: Confidence = flags.quote_verified ? fiel
           d.confidence : "low";
      257      return { ...field, confidence, ...flags };

● Update(services\worker\src\extraction\grounding.ts)
  ⎿  Added 4 lines, removed 2 lines
      72    return pages;
      73  }
      74  
      75 -function tokenize(text: string): Token[] {                     
      76 -  return [...text.matchAll(/\w+/g)].map((m) => ({ value: m[0], 
         -start: m.index }));                                            
      75 +// Splits on anything that isn't a letter or digit in any scrip
         +t. \w would cut "Kündigung" into "k"                           
      76 +// and "ndigung". Merge uses this too, so both compare tokens t
         +he same way.                                                   
      77 +export function tokenize(text: string): Token[] {              
      78 +  return [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ va
         +lue: m[0], start: m.index }));                                 
      79  }
      80  
      81  export function buildGroundingIndex(fullText: string): Groundin
          gIndex {

  Searched for 1 pattern, read 1 file (ctrl+o to expand)

● Update(services\worker\src\extraction\grounding.test.ts)
  ⎿  Added 1 line
      125          confidence: "high",
      126        },
      127        payment_terms: { value: "net 15", quote: "within fifteen
            (15) days", confidence: "high" },
      128 +      governing_law: { value: "New York", quote: "", confidenc
          +e: "high" },                                                  
      129        risk_clauses: [
      130          { ...risk, quote: "shall not exceed USD 50,000 in the 
           aggregate" },
      131          { ...risk, quote: "Vendor may raise prices at any time
           ." },

● Update(services\worker\src\extraction\grounding.test.ts)
  ⎿  Added 26 lines, removed 4 lines
      162        [true, 3],
      163        [false, null],
      164      ]);
      165 -    // 5 quotes, 3 verified. Null quotes don't count.         
      166 -    expect(score).toBe(3 / 5);                                
      165 +    expect(data.governing_law).toMatchObject({                
      166 +      value: "New York",                                      
      167 +      quote: null,                                            
      168 +      quote_verified: false,                                  
      169 +      confidence: "low",                                      
      170 +    });                                                       
      171 +    // 5 found values (vendor, cap, payment, governing law, an
          +d the mock's document_type "other"                            
      172 +    // without a quote) + 2 risks = 7. Verified: vendor, cap, 
          +first risk. Not-found fields don't count.                     
      173 +    expect(score).toBe(3 / 7);                                
      174    });
      175  
      169 -  it("gives a null score when there are no quotes at all", () 
          -=> {                                                          
      170 -    const { data: normalized } = normalizeExtraction(MOCK_EXTR
          -ACTION);                                                      
      176 +  it("gives a null score when nothing was found and there are 
          +no risks", () => {                                            
      177 +    const { data: normalized } = normalizeExtraction({        
      178 +      ...MOCK_EXTRACTION,                                     
      179 +      document_type: { value: null, quote: "", confidence: "lo
          +w" },                                                         
      180 +    });                                                       
      181  
      182      expect(groundExtraction(index, normalized).score).toBeNull
           ();
      183    });
      184  });
      185 +                                                              
      186 +describe("tokenize", () => {                                  
      187 +  it("keeps letters and digits of any script together", () => 
          +{                                                             
      188 +    expect(tokenize("die kündigungsfrist: 3 monate, § 5").map(
          +(t) => t.value)).toEqual([                                    
      189 +      "die",                                                  
      190 +      "kündigungsfrist",                                      
      191 +      "3",                                                    
      192 +      "monate",                                               
      193 +      "5",                                                    
      194 +    ]);                                                       
      195 +  });                                                         
      196 +});                                                           

● Update(services\worker\src\extraction\grounding.test.ts)
  ⎿  Added 1 line, removed 1 line
      1  import { describe, expect, it } from "vitest";
      2  import { MOCK_EXTRACTION } from "../llm/mock.js";
      3 -import { buildGroundingIndex, groundExtraction, verifyQuote } fr
        -om "./grounding.js";                                            
      3 +import { buildGroundingIndex, groundExtraction, tokenize, verify
        +Quote } from "./grounding.js";                                  
      4  import { normalizeExtraction } from "./normalize.js";
      5  
      6  const PDF = [

  Ran 1 shell command (ctrl+o to expand)

● Grounding is updated. Now merge, tests first.

● Bash(cd /e/contract-analysis-pipeline/services/worker/src/extraction && sed -i
      's/^interface Token {/export interface Token {/' grounding.ts && grep -n
      "export inter…)
  ⎿  18:export interface Token {
  ⎿  Updated services\worker\src\extraction\grounding.ts (+1 -1)
      15    score: number;
      16  }
      17  
      18 -interface Token {                                              
      18 +export interface Token {                                       
      19    value: string;
      20    start: number;
      21  }

● Write(services\worker\src\extraction\merge.test.ts)
  ⎿  Wrote 231 lines to services\worker\src\extraction\merge.test.ts
       1 import { describe, expect, it } from "vitest";
       2 import type { GroundedExtraction } from "./grounding.js";
       3 import { mergeExtractions, type ChunkResult } from "./merge.js";
       4 
       5 const notFound = {
       6   value: null,
       7   quote: null,
       8   confidence: "low",
       9   quote_verified: false,
      10   quote_page: null,
     … +261 lines (ctrl+o to expand)

● Write(services\worker\src\extraction\merge.ts)
  ⎿  Wrote 180 lines to services\worker\src\extraction\merge.ts
      1 import type {
      2   Confidence,
      3   ExtractedFieldName,
      4   ExtractionResult,
      5   Severity,
      6   StrictMoney,
      7 } from "@nexus/shared";
      8 import type { z } from "zod";
      9 import { normalizeForMatch, tokenize, type GroundedExtraction } f
        rom "./grounding.js";
     … +203 lines (ctrl+o to expand)

● Removing the awkward fallbackField helper: the first chunk is always there, so
  I pass it in directly.

● Bash(node - <<'EOF'
      const fs = require("fs");…)
  ⎿        Tests  11 passed (11)
  ⎿  Updated services\worker\src\extraction\merge.test.ts (+11 -2)
      192  
      193    it("keeps the higher severity duplicate, then the verified o
           ne, at the first one's position", () => {
      194      const quote = "Vendor may increase fees annually by any am
           ount.";
      195 -    const priceRisk = { ...renewal, category: "unilateral_pric
          -e_increase", title: "Price" } as const;                       
      195 +    const priceRisk = {                                       
      196 +      ...renewal,                                             
      197 +      category: "unilateral_price_increase",                  
      198 +      title: "Price",                                         
      199 +    } as const;                                               
      200      const { data } = mergeExtractions([
      201        chunk(0, {
      202          risk_clauses: [
     ...
      207        chunk(1, {
      208          risk_clauses: [
      209            { ...priceRisk, severity: "high", quote, quote_verif
           ied: false, quote_page: null },
      206 -          { ...renewal, severity: "low", quote: "renews automa
          -tically for 12 months", quote_page: 3 },                      
      210 +          {                                                   
      211 +            ...renewal,                                       
      212 +            severity: "low",                                  
      213 +            quote: "renews automatically for 12 months",      
      214 +            quote_page: 3,                                    
      215 +          },                                                  
      216          ],
      217        }),
      218      ]);
  ⎿  Updated services\worker\src\extraction\merge.ts (+15 -20)
      68  // vote against a value.
      69  function mergeScalar<K extends ScalarField>(
      70    chunks: readonly ChunkResult[],
      71 +  first: GroundedExtraction,                                   
      72    name: K,
      73    conflicts: Conflict[],
      74  ): GroundedExtraction[K] {
      75    const sorted = candidates(chunks, name).sort(byStrength);
      76    const winner = sorted[0];
      76 -  if (!winner) return chunks[0]?.data[name] ?? fallbackField(ch
         -unks, name);                                                   
      77 +  if (!winner) return first[name];                             
      78  
      79    // Only verified values can disagree: an unverified one may b
          e made up, and it already lost.
      80    const distinct = new Map<string, Conflict["values"][number]>(
          );
     ...
       89    return winner.field;
       90  }
       91  
       91 -function fallbackField<K extends ExtractedFieldName>(         
       92 -  chunks: readonly ChunkResult[],                             
       93 -  name: K,                                                    
       94 -): never {                                                    
       95 -  throw new Error(`mergeExtractions got no chunks for ${name} 
          -(${String(chunks.length)})`);                                 
       96 -}                                                             
       97 -                                                              
       92  // A vote, since each chunk sees part of the same document: th
           ree chunks saying "contract" beat one
       93  // saying "sow". On a tie the value seen first wins.
      100 -function mergeDocumentType(chunks: readonly ChunkResult[]): Gr
          -oundedExtraction["document_type"] {                           
       94 +function mergeDocumentType(                                   
       95 +  chunks: readonly ChunkResult[],                             
       96 +  first: GroundedExtraction,                                  
       97 +): GroundedExtraction["document_type"] {                      
       98    const found = candidates(chunks, "document_type");
       99    const votes = new Map<string, { count: number; first: number
            }>();
      100    for (const c of found) {
     ...
      103      if (entry) entry.count++;
      104      else votes.set(key, { count: 1, first: c.chunkIndex });
      105    }
      109 -  const [winner] = [...votes].sort(                           
      110 -    ([, a], [, b]) => b.count - a.count || a.first - b.first, 
      111 -  );                                                          
     … 31 more lines (ctrl+o to expand)

● Merge passes. Now summarize. Checking how tests build a logger.

  Listed 1 directory, ran 1 shell command (ctrl+o to expand)
● Adding the summary budget to summary.v1.ts and factory.ts, then summarize.ts.

  Read 2 files (ctrl+o to expand)

● Update(services\worker\src\llm\prompts\summary.v1.ts)
  ⎿  Added 3 lines
       6  
       7  export const SCHEMA_NAME = "contract_summary";
       8  
       9 +// About 80 words of json is ~150 tokens, the rest is headroom.
      10 +export const MAX_OUTPUT_TOKENS = 512;                          
      11 +                                                               
      12  export const LlmSummarySchema = z.object({
      13    summary: z.string().describe("Plain summary of the contract, 
          about 80 words"),
      14  });

● Update(services\worker\src\llm\factory.ts)
  ⎿  Added 2 lines, removed 2 lines
      14    return key;
      15  }
      16  
      17 -// Every kind of call the worker makes to ollama, so they all s
         -hare one num_ctx. The summary has no                           
      18 -// output budget of its own yet; the extraction budget is the l
         -arger one either way.                                          
      17 +// Every kind of call the worker makes to ollama, so they all s
         +hare one num_ctx. The extraction                               
      18 +// budget is the larger one, so it decides the floor.          
      19  export function ollamaContextFloor(maxInputChars: number): numb
          er {
      20    return contextFloor(maxInputChars, [
      21      {

● Update(services\worker\src\llm\factory.ts)
  ⎿  Added 1 line, removed 1 line
      26      {
      27        system: summary.buildSystemPrompt(),
      28        schema: summary.summaryJsonSchema(),
      29 -      maxOutputTokens: extract.MAX_OUTPUT_TOKENS,              
      29 +      maxOutputTokens: summary.MAX_OUTPUT_TOKENS,              
      30      },
      31    ]);
      32  }

● Write(services\worker\src\extraction\summarize.ts)
  ⎿  Wrote 61 lines to services\worker\src\extraction\summarize.ts
       1 import type { Logger } from "@nexus/shared/node";
       2 import { LlmError } from "../llm/errors.js";
       3 import {
       4   LlmSummarySchema,
       5   MAX_OUTPUT_TOKENS,
       6   SCHEMA_NAME,
       7   buildSystemPrompt,
       8   buildUserMessage,
       9   summaryJsonSchema,
      10 } from "../llm/prompts/summary.v1.js";
     … +62 lines (ctrl+o to expand)

● Write(services\worker\src\extraction\summarize.test.ts)
  ⎿  Wrote 131 lines to services\worker\src\extraction\summarize.test.ts
       1 import { createLogger } from "@nexus/shared/node";
       2 import { describe, expect, it } from "vitest";
       3 import { LlmError } from "../llm/errors.js";
       4 import { MockProvider } from "../llm/mock.js";
       5 import {
       6   MAX_OUTPUT_TOKENS,
       7   SCHEMA_NAME,
       8   buildSystemPrompt,
       9   buildUserMessage,
      10   summaryJsonSchema,
     … +140 lines (ctrl+o to expand)

● Bash(npx prettier --write services/worker/src >/dev/null && npm run typecheck
      2>&1 | grep -E "error TS" | head -20; echo "typecheck exit
      ${PIPESTATUS[0]}"; npm run l…)
  ⎿  typecheck exit 0

     > lint
     … +4 lines (ctrl+o to expand)
  ⎿  Updated services\worker\src\extraction\summarize.ts (+4 -1)
      49      const parsed = LlmSummarySchema.safeParse(res.json);
      50      const summary = parsed.success ? parsed.data.summary.trim()
           : "";
      51      if (summary !== "") return { summary, usage: res.usage, war
          nings: [] };
      52 -    logger.warn({ rawText: res.rawText.slice(0, 500) }, "summar
         -y reply unusable, using first chunk");                         
      52 +    logger.warn(                                               
      53 +      { rawText: res.rawText.slice(0, 500) },                  
      54 +      "summary reply unusable, using first chunk",             
      55 +    );                                                         
      56      return { summary: first, usage: res.usage, warnings: [SUMMA
          RY_FALLBACK_WARNING] };
      57    } catch (err) {
      58      // The extraction already succeeded; a failed summary shoul
          dn't fail the document, and it isn't
  ⎿  (timeout 5m)

● The tokenizer switch, the score fix, merge and summarize are all in. Typecheck
  and lint are clean, and npm test passed: 38 files, 402 tests. Everything ran
  against mocks only.

  Tokenizer and score (grounding.ts):
  1. tokenize now uses /[\p{L}\p{N}]+/u (keeping letter/digit runs, which is the
     same as splitting on your /[^\p{L}\p{N}]+/u). It's exported, and merge's
     dedupe uses the same function. A test checks that "kündigungsfrist" stays
     one token.
  2. The score is now verified / (non-null fields + risk clauses), or null when
     that total is 0. A value with no quote counts as unverified. I updated the
     test to 3/7, adding a value without a quote to it.

  merge.ts: mergeExtractions(chunks) returns { data, conflicts } and follows
  your spec. All the tests you asked for are there. I added tests for:
  - a full tie going to the earlier chunk
  - nulls from other chunks not counting
  - the document_type vote and its tie-break
  - two risks of the same category with different quotes both being kept

  summarize.ts: summarizeExtraction(provider, merged, chunkSummaries, { 
  timeoutMs, logger }) returns { summary, usage, warnings }.
  - One chunk returns its own summary without a call.
  - More chunks make one summary.v1 call with 512 max output tokens.
  - Any error returns the first chunk's summary plus "summary: fell back to 
    first chunk". It logs a warn, and the logger carries documentId from run.ts.

  Choices your spec didn't settle:
  1. Conflict order. The values are listed in the same order used to pick the
     winner, so the winner comes first. Each distinct value appears once, from
     its strongest chunk.
  2. Which chunk's field object wins. For a scalar, the strongest candidate's
     whole object wins (value, quote, page). For document_type, once the vote
     picks a value, the strongest chunk with that value supplies the object.
  3. Duplicate risks. A replaced duplicate keeps the first one's position, so
     risks stay in document order. "Earlier" wins any full tie.
  4. Merged summary. The merged summary is set to "". summarize fills it, and
     summary.v1's input then doesn't show the model a part summary.
  5. Summary fallbacks. A reply that's valid JSON but fails the schema, or a
     blank summary, also falls back with the warning. The fallback still counts
     tokens, including LlmError.usage from a failed call.
  6. Summary budget. I added MAX_OUTPUT_TOKENS = 512 to summary.v1.ts.
     factory.ts now uses it for the summary template; it had been using the
     extraction budget. The ollama floor doesn't change, because the extraction
     budget is bigger, and the factory test still passes.

  Next: send the derive step.

✻ Baked for 3m 54s · done 12:01 AM

❯ all six fine.                                                                 
                                                                                
  deriveDates goes in packages/shared/src/derive.ts, browser safe, pure, add    
  date-fns ^4.4 to shared. reason: the derived dates go stale every day (days   
  left, alerts, auto renew rolling the term forward), so the api recomputes the 
  whole derived block on every read from the stored facts + its clock, and the  
  worker uses the same function when it stores the result. one function, no     
  drift.                                                                        
                                                                                
  deriveDates(fields, risks, groundingScore, threshold, today) -> Derived. utc  
  dates only.                                                                   
                                                                                
  rules:                                                                        
  expiration = stated if there, else effective + initial_term_months - 1 day    
  (computed), else null.                                                        
  models compute the expiration themselves even though rule 3 says not to (the  
  7b did, and got it right). so when it's stated AND computable and the two     
  differ -> warning alert expiration_mismatch "Stated expiration {x} differs    
  from effective date + term ({y}). Check the contract." keep the stated one.   
  it's an alert and not a merge conflict because derive is recomputed on read   
  and conflicts are stored once.                                                
  current_term_end starts at expiration. if auto renewal, while it's before     
  today: addMonths(end + 1 day, renewal_term_months ?? initial_term_months) - 1 
  day. max 100 loops. no renewal length known -> stop + alert                   
  next_renewal_date = term end + 1 day if auto renewal                          
  notice_deadline = term end - notice days                                      
  days_until_notice_deadline = differenceInCalendarDays(deadline, today)        
                                                                                
  alerts in this order:                                                         
  deadline passed + auto renew -> critical "Notice deadline {d} has passed.     
  Contract renews on {next}."                                                   
  0-30 days -> critical "Notice deadline in {n} days ({d}). Contract            
  auto-renews for {m} months if no notice is given."                            
  31-90 -> warning, same text                                                   
  not auto renew and expired -> info "Contract expired on {d}."                 
  any high risk -> warning "{count} high-severity risk clause(s)."              
  grounding under threshold -> warning "Only {pct}% of quotes were found in the 
  document. Verify values manually."                                            
  auto renew but no notice days -> warning no_notice_period "Contract           
  auto-renews but no notice period was found, so there is no notice deadline."  
  (the 7b missed "at least 60 days before the renewal date" once, without       
  notice days there's no deadline, and the deadline is the point of the         
  dashboard)                                                                    
                                                                                
  every alert gets a stable code next to severity + message so review and the   
  ui never parse the text. if the shared Derived schema has no code field yet,  
  add it and tell me.                                                           
                                                                                
  tests with today = 2026-10-09:                                                
  - stated expiration used                                                      
  - 2026-03-01 + 12 -> 2027-02-28                                               
  - 2024-02-29 + 12 -> 2025-02-27 (date-fns clamps to feb 28 then minus a day,  
  I'll just document that as the convention)                                    
  - auto renew 2025-01-01..2025-12-31 rolls to 2026-12-31, 60 days notice ->    
  2026-11-01, 23 days, critical                                                 
  - no auto renew + expired -> info                                             
  - missing stuff -> nulls, no crash                                            
  - stated 2028-03-31 with 2026-04-01 + 24 months -> no mismatch, stated        
  2028-06-30 -> expiration_mismatch                                             
  - auto renew + null notice days -> no_notice_period, deadline null            
                                                                                
  then switch the api: the dto mapper and csv export call deriveDates with the  
  injected clock and replace the stored derived block (and the summary fields   
  that come from it) instead of only recomputing days_until_notice_deadline.    
  one api test with the clock moved forward a year showing the auto renew term  
  rolled and the alerts changed.                                                
                                                                                
  mock only, typecheck, lint, test.                                             

  Searched for 2 patterns, ran 1 shell command (ctrl+o to expand)

● I'll add an AlertCode enum and code field to the shared Derived alerts,
  implement deriveDates, and have the API recompute the derived block on read.
  First, I'm checking the API route dependencies and where the web app reads
  alerts.

  Searched for 1 pattern, ran 1 shell command (ctrl+o to expand)

● Reading done. Starting the shared changes: installing date-fns and adding the
  alert code field.

● Bash(npm install date-fns@^4.4 -w @nexus/shared 2>&1 | grep -v allow-scripts |
      tail -2; grep date-fns packages/shared/package.json; sed -n 100,125p
      packages/shared/s…)
  ⎿  found 0 vulnerabilities
         "date-fns": "^4.4.0",
       initial_term_months: verified(fullLlm.initial_term_months),
     … +25 lines (ctrl+o to expand)
  ⎿  Updated package-lock.json (+1 -0)
      5088        "version": "0.0.0",
      5089        "dependencies": {
      5090          "better-sqlite3": "^13.0.3",
      5091 +        "date-fns": "^4.4.0",                                
      5092          "pino": "^10.4.0",
      5093          "zod": "^4.6.5"
      5094        },
  ⎿  Updated packages\shared\package.json (+1 -0)
      15    },
      16    "dependencies": {
      17      "better-sqlite3": "^13.0.3",
      18 +    "date-fns": "^4.4.0",                                      
      19      "pino": "^10.4.0",
      20      "zod": "^4.6.5"
      21    },

● Bash(node - <<'EOF'
      const fs = require("fs");…)
  ⎿  165-export type ExpirationSource = z.infer<typeof ExpirationSource>;
     166-
     167:const Derived = z.strictObject({
     … +17 lines (ctrl+o to expand)
  ⎿  Updated packages\shared\src\schemas\extraction.test.ts (+1 -1)
      111      next_renewal_date: "2028-03-01",
      112      notice_deadline: "2027-12-01",
      113      days_until_notice_deadline: 417,
      114 -    alerts: [{ level: "info", message: "Notice deadline is mor
          -e than 90 days away." }],                                     
      114 +    alerts: [{ level: "warning", code: "high_risk", message: "
          +1 high-severity risk clause(s)." }],                          
      115    },
      116    conflicts: [
      117      {
  ⎿  Updated packages\shared\src\schemas\extraction.ts (+17 -1)
      147  export const AlertLevel = z.enum(["info", "warning", "critical
           "]);
      148  export type AlertLevel = z.infer<typeof AlertLevel>;
      149  
      150 +// Review and the ui branch on the code, never on the message 
          +text.                                                         
      151 +export const AlertCode = z.enum([                             
      152 +  "notice_deadline_passed",                                   
      153 +  "notice_deadline_soon",                                     
      154 +  "notice_deadline_upcoming",                                 
      155 +  "expired",                                                  
      156 +  "high_risk",                                                
      157 +  "low_grounding",                                            
      158 +  "no_notice_period",                                         
      159 +  "expiration_mismatch",                                      
      160 +  "renewal_term_unknown",                                     
      161 +]);                                                           
      162 +export type AlertCode = z.infer<typeof AlertCode>;            
      163 +                                                              
      164  export const ExpirationSource = z.enum(["stated", "computed"])
           ;
      165  export type ExpirationSource = z.infer<typeof ExpirationSource
           >;
      166  
     ...
      172    notice_deadline: IsoDate.nullable(),
      173    // Negative once the deadline has passed.
      174    days_until_notice_deadline: z.int().nullable(),
      161 -  alerts: z.array(z.strictObject({ level: AlertLevel, message:
          - z.string() })),                                              
      175 +  alerts: z.array(z.strictObject({ level: AlertLevel, code: Al
          +ertCode, message: z.string() })),                             
      176  });
      177 +export type Derived = z.infer<typeof Derived>;                
      178 +export type Alert = Derived["alerts"][number];                
      179  
      180  export const ExtractedFieldName = LlmExtractionSchema.keyof().
           exclude(["risk_clauses", "summary"]);
      181  export type ExtractedFieldName = z.infer<typeof ExtractedField
           Name>;

● Schema updated. Now the deriveDates tests in shared.

● Write(packages\shared\src\derive.test.ts)
  ⎿  Wrote 241 lines to packages\shared\src\derive.test.ts
       1 import { describe, expect, it } from "vitest";
       2 import { deriveDates, type DeriveFields } from "./derive.js";
       3 
       4 const TODAY = "2026-10-09";
       5 const THRESHOLD = 0.8;
       6 
       7 function facts(values: {
       8   effective_date?: string | null;
       9   expiration_date?: string | null;
      10   initial_term_months?: number | null;
     … +268 lines (ctrl+o to expand)

● Bash(sed -i 's/expect(d.current_term_end).toBe("2026-12-30");/expect(d.current
      _term_end).toBe("2026-12-31");/' packages/shared/src/derive.test.ts &&
      grep -n '2026-12…)
  ⎿  85:    expect(d.current_term_end).toBe("2026-12-31");
  ⎿  Updated packages\shared\src\derive.test.ts (+1 -1)
      82        facts({ expiration_date: "2025-06-30", initial_term_month
          s: 6, auto_renewal: true }),
      83      );
      84  
      85 -    expect(d.current_term_end).toBe("2026-12-30");             
      85 +    expect(d.current_term_end).toBe("2026-12-31");             
      86    });
      87  
      88    it("warns 31 to 90 days ahead and goes critical once the dead
          line has passed", () => {

● Write(packages\shared\src\derive.ts)
  ⎿  Wrote 151 lines to packages\shared\src\derive.ts
       1 import { addDays, addMonths, differenceInCalendarDays, format, p
       2 import type { Alert, Derived, ExtractionResult, Severity } from 
       3 
       4 // The model extracts facts, this does the date math. Pure and b
       5 // every read with its own clock, because days left, alerts and 
       6 // daily, and the worker runs it once when storing. One function
       7 //
       8 // Dates are calendar dates (YYYY-MM-DD) with no time zone. date
       9 // local midnight and formats it back the same way, so the arith
      10 //
     … +174 lines (ctrl+o to expand)

● Bash(echo 'export * from "./derive.js";' >> packages/shared/src/index.ts &&
      npx prettier --write packages/shared/src >/dev/null && npx vitest run
      packages/shared/src…)
  ⎿        Tests  27 passed (27)
     TZ=America/Los_Angeles
           Tests  13 passed (13)
     … +4 lines (ctrl+o to expand)
  ⎿  Updated packages\shared\src\derive.test.ts (+10 -2)
      150  
      151    it("alerts on a stated expiration that differs from effectiv
           e + term, keeping the stated one", () => {
      152      const same = derive(
      153 -      facts({ expiration_date: "2028-03-31", effective_date: "
          -2026-04-01", initial_term_months: 24 }),                      
      153 +      facts({                                                 
      154 +        expiration_date: "2028-03-31",                        
      155 +        effective_date: "2026-04-01",                         
      156 +        initial_term_months: 24,                              
      157 +      }),                                                     
      158      );
      159      const differs = derive(
      156 -      facts({ expiration_date: "2028-06-30", effective_date: "
          -2026-04-01", initial_term_months: 24 }),                      
      160 +      facts({                                                 
      161 +        expiration_date: "2028-06-30",                        
      162 +        effective_date: "2026-04-01",                         
      163 +        initial_term_months: 24,                              
      164 +      }),                                                     
      165      );
      166  
      167      expect(same.alerts).toEqual([]);
  ⎿  Updated packages\shared\src\derive.ts (+5 -1)
      112      }
      113    }
      114    if (!autoRenews && end !== null && currentTermEnd !== null &
           & end < now) {
      115 -    alerts.push({ level: "info", code: "expired", message: `Co
          -ntract expired on ${currentTermEnd}.` });                     
      115 +    alerts.push({                                             
      116 +      level: "info",                                          
      117 +      code: "expired",                                        
      118 +      message: `Contract expired on ${currentTermEnd}.`,      
      119 +    });                                                       
      120    }
      121    const highRisks = risks.filter((r) => r.severity === "high")
           .length;
      122    if (highRisks > 0) {
  ⎿  Updated packages\shared\src\index.ts (+1 -0)
      2  export * from "./formats.js";
      3  export * from "./schemas/extraction.js";
      4  export * from "./schemas/api.js";
      5 +export * from "./derive.js";                                    

● Checking that TZ actually takes effect in Node on Windows, so the three runs
  above count.

  Ran 1 shell command (ctrl+o to expand)

● Git Bash isn't passing TZ through, so those three runs proved nothing.
  Retrying from PowerShell.

  Ran 1 shell command (ctrl+o to expand)
● deriveDates passes in UTC-8 and UTC+14 too, so the date math doesn't depend on
  the server's time zone. Now the API side. Checking current tests and callers
  of the dto helpers.

  Searched for 1 pattern, ran 1 shell command (ctrl+o to expand)

● Updating dto.ts to recompute the whole derived block on read.

● Bash(node - <<'EOF'
      const fs = require("fs");…)
  ⎿  72:        .header("content-disposition", `attachment; filename="contr
     acts-${today}.csv"`)
     85:    return toDetail(row, extraction, listEvents(db, id), request.lo
     … +3 lines (ctrl+o to expand)
  ⎿  Updated services\api\src\routes\documents.ts (+8 -5)
      11    type DocumentRow,
      12  } from "@nexus/shared/node";
      13  import { batchLimitError, HttpError } from "../errors.js";
      14 -import { parseStoredResult, toDetail, todayUtc, toSummary } fro
         -m "../services/dto.js";                                        
      14 +import { readContext, readStoredResult, toDetail, toSummary } f
         +rom "../services/dto.js";                                      
      15  import { toCsv } from "../services/csv.js";
      16  import { enqueueOrDefer } from "../services/enqueue.js";
      17  import { EXPORT_COLUMNS, exportCells } from "../services/export
          .js";
      18  import { storeUpload, type UploadDeps } from "../services/uploa
          d.js";
      19 +import type { Config } from "@nexus/shared/node";              
      20  
      21  const UTF8_BOM = "\uFEFF";
      22  
     ...
      24  const IdParams = z.object({ id: z.uuid() });
      25  
      26  export interface DocumentRouteDeps extends UploadDeps {
      27 +  config: UploadDeps["config"] & Pick<Config, "GROUNDING_REVIEW
         +_THRESHOLD">;                                                  
      28    clock: () => Date;
      29  }
      30  
      31  export const documentRoutes: FastifyPluginCallback<DocumentRout
          eDeps> = (app, deps, done) => {
      32    const { db, clock } = deps;
      33 +  const context = () => readContext(clock(), deps.config.GROUND
         +ING_REVIEW_THRESHOLD);                                         
      34  
      35    app.post("/documents", async (request, reply) => {
      36      const body: UploadResponse = { accepted: [], rejected: [] }
          ;
     ...
      54  
      55    app.get("/documents", (request) => {
      56      const { limit } = ListQuery.parse(request.query);
      54 -    const today = todayUtc(clock());                           
      57 +    const ctx = context();                                     
      58      return listDocuments(db, { limit }).map((row) =>
      56 -      toSummary(row, parseStoredResult(row.result_json, row.id,
         - request.log), today),                                         
      59 +      toSummary(row, readStoredResult(row.result_json, row.id, 
         +request.log, ctx)),                                            
      60      );
      61    });
      62  
      63    // Registered before /documents/:id, so export.csv is never r
          ead as an id.
      64    app.get("/documents/export.csv", (request, reply) => {
      62 -    const today = todayUtc(clock());                           
     … 7 more lines (ctrl+o to expand)
  ⎿  Updated services\api\src\services\dto.ts (+40 -27)
      1  import type { FastifyBaseLogger } from "fastify";
      2  import { z } from "zod";
      3  import {
      4 +  deriveDates,                                                  
      5    ExtractionResultSchema,
      6    type DocumentDetail,
      7    type DocumentEvent,
     ...
      12  import type { DocumentRow, EventRow, ExtractionRow } from "@nex
          us/shared/node";
      13  
      14  const SEVERITY_RANK: Record<Severity, number> = { low: 1, mediu
          m: 2, high: 3 };
      14 -const DAY_MS = 24 * 60 * 60 * 1000;                            
      15 +                                                               
      16 +// What a read needs to recompute the derived block: today's da
         +te from the injected clock (UTC) and                           
      17 +// the grounding threshold behind the low_grounding alert.     
      18 +export interface ReadContext {                                 
      19 +  today: string;                                               
      20 +  groundingThreshold: number;                                  
      21 +}                                                              
      22 +                                                               
      23 +export function readContext(now: Date, groundingThreshold: numb
         +er): ReadContext {                                             
      24 +  return { today: now.toISOString().slice(0, 10), groundingThre
         +shold };                                                       
      25 +}                                                              
      26  
      27  // json read from the db is a boundary too. A broken row logs a
          nd loses its extraction fields
      28  // instead of failing the whole list.
     ...
      58    return max;
      59  }
      60  
      50 -// The stored value was computed on the day of extraction and g
         -oes stale, so it is recomputed per read.                       
      51 -// Both dates are calendar dates, compared in UTC.             
      52 -export function daysUntil(deadline: string | null, today: strin
         -g): number | null {                                            
      53 -  if (deadline === null) return null;                          
      54 -  return Math.round((Date.parse(deadline) - Date.parse(today)) 
         -/ DAY_MS);                                                     
      61 +// The stored derived block was right on the day of extraction.
         + Days left, alerts and a rolled auto                           
      62 +// renewal term go stale daily, so every read replaces it with 
         +one computed from the stored facts,                            
      63 +// using the same deriveDates the worker stored it with.       
      64 +export function withFreshDerived(result: ExtractionResult, ctx:
         + ReadContext): ExtractionResult {                              
      65 +  const derived = deriveDates(                                 
      66 +    result,                                                    
      67 +    result.risk_clauses,                                       
     … 63 more lines (ctrl+o to expand)
  ⎿  Updated services\api\src\services\export.ts (+4 -8)
      1  import type { ExtractionResult, Severity } from "@nexus/shared";
      2  import type { ExportRow } from "@nexus/shared/node";
      3  import type { Cell } from "./csv.js";
      4 -import { daysUntil } from "./dto.js";                           
      4  
      5  export const EXPORT_COLUMNS = [
      6    "id",
     ...
      34    return result.risk_clauses.filter((clause) => clause.severity
           === severity).length;
      35  }
      36  
      38 -// result is null when the stored json was broken: the document
         - columns still go out, the rest stays empty.                   
      39 -export function exportCells(                                   
      40 -  row: ExportRow,                                              
      41 -  result: ExtractionResult | null,                             
      42 -  today: string,                                               
      43 -): Cell[] {                                                    
      37 +// result is null when the stored json was broken: the document
         + columns still go out, the rest stays                          
      38 +// empty. It is expected to have gone through withFreshDerived,
         + so the date columns are today's.                              
      39 +export function exportCells(row: ExportRow, result: ExtractionR
         +esult | null): Cell[] {                                        
      40    const values: Record<ExportColumn, Cell> = {
      41      id: row.id,
      42      file: row.original_name,
     ...
      49      expiration_date: result?.derived.expiration_date ?? null,
      50      expiration_source: result?.derived.expiration_source ?? nul
          l,
      51      notice_deadline: result?.derived.notice_deadline ?? null,
      56 -    days_until_notice_deadline: result ? daysUntil(result.deriv
         -ed.notice_deadline, today) : null,                             
      52 +    days_until_notice_deadline: result?.derived.days_until_noti
         +ce_deadline ?? null,                                           
      53      auto_renewal: result?.auto_renewal.value ?? null,
      54      total_value: result?.total_contract_value.value?.amount ?? 
          null,
      55      currency: result?.total_contract_value.value?.currency ?? n
          ull,

● Bash(sed -i 's/attachment; filename="contracts-${today}.csv"/attachment;
      filename="contracts-${ctx.today}.csv"/; s/return toDetail(row, extraction,
      listEvents(db, id…)
  ⎿  72:        .header("content-disposition", `attachment; filename="contr
     acts-${ctx.today}.csv"`)
     85:    return toDetail(row, extraction, listEvents(db, id), request.lo
     … +9 lines (ctrl+o to expand)
  ⎿  Updated services\api\src\routes\documents.ts (+3 -3)
      69      return (
      70        reply
      71          .header("content-type", "text/csv; charset=utf-8")
      72 -        .header("content-disposition", `attachment; filename="c
         -ontracts-${today}.csv"`)                                       
      72 +        .header("content-disposition", `attachment; filename="c
         +ontracts-${ctx.today}.csv"`)                                   
      73          // Excel reads a csv without a BOM in the local ANSI co
          depage and mangles non-ascii vendor names.
      74          .send(UTF8_BOM + toCsv(EXPORT_COLUMNS, rows))
      75      );
     ...
      82      const extraction = row.latest_extraction_id
      83        ? getExtraction(db, row.latest_extraction_id)
      84        : undefined;
      85 -    return toDetail(row, extraction, listEvents(db, id), reques
         -t.log, todayUtc(clock()));                                     
      85 +    return toDetail(row, extraction, listEvents(db, id), reques
         +t.log, context());                                             
      86    });
      87  
      88    app.post("/documents/:id/retry", async (request, reply) => {
     ...
      121      const updated = getDocument(db, id);
      122      if (!updated) throw new Error(`document ${id} vanished aft
           er retry`);
      123      // queued has no extraction worth showing yet; the old one
            comes back via the detail endpoint.
      124 -    return reply.status(202).send(toSummary(updated, null, tod
          -ayUtc(clock())));                                             
      124 +    return reply.status(202).send(toSummary(updated, null));  
      125    });
      126  
      127    done();

● Now the API fixture. Its facts have to produce the deadline the tests expect
  (today + 10) once derived is recomputed.

● Bash(node - <<'EOF'
      const fs = require("fs");…)
  ⎿       × sends completed documents only, as a dated utf-8 csv attachment
      109ms
          × neutralises formula injection and quotes per rfc 4180 29ms
     … +28 lines (ctrl+o to expand)
  ⎿  Updated services\api\src\routes\documents-export.test.ts (+2 -2)
      110        vendor: "Acme Ltd",
      111        customer: "Nexus Corp",
      112        document_type: "contract",
      113 -      effective_date: "2026-01-01",                           
      114 -      expiration_date: "2027-01-01",                          
      113 +      effective_date: "2025-07-12",                           
      114 +      expiration_date: "2026-07-11",                          
      115        expiration_source: "stated",
      116        notice_deadline: "2026-06-11",
      117        days_until_notice_deadline: "10",
  ⎿  Updated services\api\src\routes\documents-read.test.ts (+1 -1)
       98        needs_review: false,
       99        vendor_name: "Acme Ltd",
      100        total_contract_value: { amount: 120000, currency: "USD" 
           },
      101 -      expiration_date: "2027-01-01",                          
      101 +      expiration_date: "2026-07-11",                          
      102        notice_deadline: addDays(10),
      103        days_until_notice_deadline: 10,
      104        max_risk_severity: "high",
  ⎿  Updated services\api\src\test-support\fixtures.ts (+7 -6)
      51      payment_terms: field("net 30"),
      52      governing_law: field("England"),
      53      liability_cap: field(null),
      54 -    effective_date: field("2026-01-01"),                       
      55 -    expiration_date: field("2027-01-01"),                      
      54 +    // Term ends 2026-07-11, 30 days notice: the deadline is NO
         +W + 10 days.                                                   
      55 +    effective_date: field("2025-07-12"),                       
      56 +    expiration_date: field("2026-07-11"),                      
      57      initial_term_months: field(12),
      58      renewal_term_months: field(12),
      59      termination_notice_days: field(30),
     ...
      62      risk_clauses: [clause("medium"), clause("high"), clause("lo
          w")],
      63      summary: "A contract.",
      64      derived: {
      64 -      expiration_date: "2027-01-01",                           
      65 +      expiration_date: "2026-07-11",                           
      66        expiration_source: "stated",
      66 -      current_term_end: "2027-01-01",                          
      67 -      next_renewal_date: "2027-01-01",                         
      67 +      current_term_end: "2026-07-11",                          
      68 +      next_renewal_date: "2026-07-12",                         
      69        notice_deadline: addDays(10),
      69 -      // Deliberately stale, the api recomputes it.            
      70 +      // Deliberately stale, the api recomputes the whole block
         + on read.                                                      
      71        days_until_notice_deadline: 999,
      72        alerts: [],
      73      },

● The API resolves @nexus/shared from dist, which doesn't have deriveDates yet.
  Rebuilding with tsc -b, then rerunning.

  Ran 1 shell command (ctrl+o to expand)

● All 64 API tests pass. Now the new test with the clock moved forward a year.
  Checking how the read tests build the server.

  Searched for 1 pattern, ran 1 shell command (ctrl+o to expand)

● Bash(node - <<'EOF'
      const fs = require("fs");…)
  ⎿        Tests  8 passed (8)
  ⎿  Updated services\api\src\routes\documents-read.test.ts (+47 -2)
      64    transitionStatus(db, id(n), "completed", { from: "processing"
           });
      65  }
      66  
      67 -async function setup() {                                       
      67 +async function setup(now = NOW) {                              
      68    const lines: Record<string, unknown>[] = [];
      69    const stream = {
      70      write: (chunk: string) => lines.push(JSON.parse(chunk) as R
          ecord<string, unknown>),
     ...
      74      queue,
      75      config: loadConfig({}),
      76      logger: createLogger("api", "info", stream),
      77 -    clock: () => NOW,                                          
      77 +    clock: () => now,                                          
      78    });
      79    return { app, lines };
      80  }
     ...
      199      expect(detail.extraction?.result.derived.days_until_notice
           _deadline).toBe(10);
      200    });
      201  
      202 +  it("recomputes the derived block from the facts, so a year l
          +ater the term has rolled", async () => {                      
      203 +    addDoc(1);                                                
      204 +    complete(1, result());                                    
      205 +    const today = await setup();                              
      206 +    // A year and 24 days on: the 2026-07-11 term has renewed 
          +to 2027-07-11 and its deadline is gone.                       
      207 +    const later = await setup(new Date("2027-06-25T08:00:00Z")
          +);                                                            
      208 +                                                              
      209 +    const read = async (app: typeof today.app) => {           
      210 +      const res = await app.inject({ method: "GET", url: `/api
          +/documents/${id(1)}` });                                      
      211 +      return DocumentDetailSchema.parse(res.json());          
      212 +    };                                                        
      213 +    const now = await read(today.app);                        
      214 +    const nextYear = await read(later.app);                   
      215 +                                                              
      216 +    expect(now.extraction?.result.derived).toMatchObject({    
      217 +      current_term_end: "2026-07-11",                         
      218 +      next_renewal_date: "2026-07-12",                        
      219 +      notice_deadline: "2026-06-11",                          
      220 +      days_until_notice_deadline: 10,                         
      221 +    });                                                       
      222 +    expect(now.extraction?.result.derived.alerts.map((a) => a.
          +code)).toEqual([                                              
     … 27 more lines (ctrl+o to expand)

  Ran 1 shell command (ctrl+o to expand)

● Everything passes. Updating the project memory note about derived dates, since
  it described the old day-count-only recompute.

  Ran 1 shell command, wrote 1 memory (ctrl+o to expand)

● deriveDates is in shared, and the API now replaces the whole derived block on
  every read. Typecheck and lint are clean, and npm test passed: 39 files, 416
  tests. Everything ran against mocks only.

  Schema change you asked me to report:
  - The Derived alerts had no code field. They are now { level, code, message },
    where code is a new AlertCode enum in schemas/extraction.ts with nine
    codes. I also exported Derived and Alert types.
  - Stored rows written before this have alerts without code, so they fail the
    strict parse. The API then logs a warning and nulls their extraction fields.
    If there are local rows you care about, re-run them.

  Shared (derive.ts):
  1. deriveDates(fields, risks, groundingScore, threshold, today) takes today as
     a YYYY-MM-DD string. It needs only the .value of six fact fields, so both
     stored results and the worker's shapes fit.
  2. Date-only strings go through date-fns parse and format, so the math doesn't
     depend on the server's time zone. I ran the tests with TZ set to UTC-8 and
     UTC+14 through PowerShell; Git Bash doesn't pass TZ to node.
  3. The leap-day clamp is documented in the file header as the convention.
  4. All eight test cases you listed pass. I added tests for the 31 to 90 day
     warning, a passed deadline, falling back to the initial term for renewals,
     an unknown renewal length, high-risk and grounding alerts, and the fixed
     alert order.

  API:
  - dto.ts has readStoredResult (parse plus deriveDates) and withFreshDerived.
    List, detail and CSV all use them, and daysUntil / todayUtc are gone. The
    threshold comes from config.GROUNDING_REVIEW_THRESHOLD.
  - I changed the fixture's dates (effective 2025-07-12, expiration 2026-07-11),
    so that the deadline recomputed from the facts is still NOW + 10.
  - The new test moves the clock to 2027-06-25 rather than exactly one year.
    With a 12-month renewal, exactly a year later lands on the same point in the
    cycle, so the alerts wouldn't change. At 2027-06-25 the term has rolled to
    2027-07-11 and the alert goes from notice_deadline_soon to
    notice_deadline_passed.

  Choices your spec didn't settle:
  1. Unknown renewal length. If neither a renewal nor an initial term is known,
     rolling stops with a new code, renewal_term_unknown (warning): "Contract
     auto-renews but no renewal term was found, so the current term could not be
     rolled forward." A length of 0 counts as unknown.
  2. Order of the two extra alerts. expiration_mismatch and renewal_term_unknown
     go after your listed alerts, in that order.
  3. Deadline alerts only for auto renewal. The 0 to 30 and 31 to 90 day alerts
     only fire when the contract auto-renews, since their text says it does.
  4. Text when the length is unknown. If the renewal length isn't known, the
     alert ends "Contract auto-renews if no notice is given." instead of saying
     "{m} months".

  Open question: when the 100-roll limit is hit, rolling stops without an alert.
  The term end stays in the past, so it would show "deadline passed" for a
  contract that has really renewed many times since. That would take a monthly
  renewal starting before about 2018. Should it raise its own alert, or is the
  limit only a loop guard?

  Next: answer the 100-roll question, then send the review step.

✻ Worked for 6m 13s · done 12:19 AM

❯ choices 1-4 fine, schema change fine, I'll re-run any local docs.             
                                                                                
  100 rolls: drop the loop, it also has a real bug. repeating addMonths(end + 1 
  day, len) - 1 day drifts at month ends: a contract starting jan 31 with       
  monthly terms gets term ends feb 28 -> mar 28 -> apr 28, should be feb 28 ->  
  mar 30 -> apr 29. compute it instead:                                         
  - effective date + initial term known: term end k = addMonths(effective,      
  initial + k * len) - 1 day                                                    
  - otherwise anchor on expiration + 1 day: term end k = addMonths(anchor, k *  
  len) - 1 day                                                                  
  - len = renewal_term_months ?? initial_term_months, smallest k where term end 
  >= today. estimate k from differenceInMonths and step at most a couple of     
  times, no cap needed                                                          
    tests: the jan 31 monthly case, and a monthly contract starting 2010 rolls  
  straight to the right term.                                                   
                                                                                
  then review.ts decideNeedsReview({ data, conflicts, warnings, groundingScore, 
  threshold, alerts }) -> { needsReview, reasons }. flag if:                    
  - grounding < threshold                                                       
  - a key field has a value with an unverified quote (vendor_name,              
  effective_date, expiration_date, total_contract_value,                        
  termination_notice_days)                                                      
  - any conflicts                                                               
  - normalize dropped a key field                                               
  - derive returned an expiration_mismatch, no_notice_period or                 
  renewal_term_unknown alert (by code). no_notice_period matters most: the 7b   
  missed "at least 60 days before the renewal date" once, and without notice    
  days there's no deadline, which is the whole point of the dashboard           
    reasons go into warnings prefixed "review: " (ui uses that).                
                                                                                
  now replace the placeholder in pipeline/analyze.ts (no new file):             
  parsing -> parseDocument (already there)                                      
  extracting -> chunkText + mapLimit(extractChunk, LLM_CHUNK_CONCURRENCY),      
  forced to 1 for ollama. one local gpu: a second request just waits in         
  ollama's queue while its 5 min timeout keeps running, and parallel slots      
  multiply the kv cache. log it once at start if the config asked for more      
  validating -> normalize + ground each chunk, merge, summarize, derive,        
  review, then ExtractionResultSchema.parse. if that last parse fails it's our  
  bug -> PermanentError INTERNAL with the zod message                           
  return { parsed, result, needsReview, meta { provider, model, promptVersion,  
  chunkCount, tokens, durationMs } }. log one line per chunk.                   
                                                                                
  processJob on success: insertExtraction with all the meta, completed with     
  needs_review, info event "chunks={n} grounding={score} needs_review={bool}".  
                                                                                
  plus one test running analyzeDocument with a mock that returns real quotes on 
  a generated 2 chunk pdf: validates, pages filled, needs_review false. the     
  processJob test that expects needs_review true from the placeholder needs     
  updating. mock only, typecheck, lint, test.                                   

● Starting with the derive fix, then review, then the pipeline. Reading the
  current pipeline code first.

  Ran 3 shell commands (ctrl+o to expand)

● Fixing the derive roll-forward first: a computed term end instead of the loop.

  Read 1 file (ctrl+o to expand)

● Update(packages\shared\src\derive.ts)
  ⎿  Added 16 lines, removed 12 lines
      72    }
      73  
      74    let end = expiration === null ? null : toDate(expiration);
      75 -  if (end !== null && autoRenews) {                            
      76 -    for (let rolls = 0; end < now && rolls < MAX_ROLLS; rolls++
         -) {                                                            
      77 -      if (!renewalMonths) {                                    
      78 -        later.push({                                           
      79 -          level: "warning",                                    
      80 -          code: "renewal_term_unknown",                        
      81 -          message:                                             
      82 -            "Contract auto-renews but no renewal term was found
         -, so the current term could not be rolled forward.",           
      83 -        });                                                    
      84 -        break;                                                 
      85 -      }                                                        
      86 -      end = termEnd(addDays(end, 1), renewalMonths);           
      75 +  if (end !== null && autoRenews && end < now) {               
      76 +    if (renewalMonths) {                                       
      77 +      // Counted from the start of the contract when it is know
         +n, otherwise from the day after the                            
      78 +      // expiration. Both use the original day of month, so a J
         +an 31 start keeps ending on month ends.                        
      79 +      const base =                                             
      80 +        effective !== null && initial !== null                 
      81 +          ? { start: toDate(effective), offset: initial }      
      82 +          : { start: addDays(end, 1), offset: 0 };             
      83 +      end = currentTermEnd(base.start, base.offset, renewalMont
         +hs, now);                                                      
      84 +    } else {                                                   
      85 +      later.push({                                             
      86 +        level: "warning",                                      
      87 +        code: "renewal_term_unknown",                          
      88 +        message:                                               
      89 +          "Contract auto-renews but no renewal term was found, 
         +so the current term could not be rolled forward.",             
      90 +      });                                                      
      91      }
      92    }
      93  

● Update(packages\shared\src\derive.ts)
  ⎿  Removed 3 lines
      22  // Only the values are read, so stored results and the worker's
           in-between shapes both fit.
      23  export type DeriveFields = { [K in FactName]: { value: Extracti
          onResult[K]["value"] } };
      24  
      25 -// A monthly renewal from 2018 needs ~100 rolls to reach today.
         - Past that the data is more likely                             
      26 -// wrong than the contract that old.                           
      27 -const MAX_ROLLS = 100;                                         
      25  const URGENT_DAYS = 30;
      26  const SOON_DAYS = 90;
      27  

● Update(packages\shared\src\derive.ts)
  ⎿  Added 13 lines
      38    return addDays(addMonths(start, months), -1);
      39  }
      40  
      41 +// Term k ends at start + offset + k * len months - 1 day, alwa
         +ys counted from the same start.                                
      42 +// Stepping one term at a time from the previous end would drif
         +t at month ends: a Jan 31 monthly                              
      43 +// contract would go Feb 28, Mar 28, Apr 28 instead of Feb 28, 
         +Mar 30, Apr 29.                                                
      44 +// Returns the end of the first term that ends on or after toda
         +y. k is estimated from the month                               
      45 +// difference, which is off by at most one, so the loops below 
         +step once or twice.                                            
      46 +function currentTermEnd(start: Date, offset: number, len: numbe
         +r, today: Date): Date {                                        
      47 +  const end = (k: number) => termEnd(start, offset + k * len); 
      48 +  let k = Math.max(0, Math.floor((differenceInMonths(today, sta
         +rt) - offset) / len));                                         
      49 +  while (end(k) < today) k++;                                  
      50 +  while (k > 0 && end(k - 1) >= today) k--;                    
      51 +  return end(k);                                               
      52 +}                                                              
      53 +                                                               
      54  export function deriveDates(
      55    fields: DeriveFields,
      56    risks: readonly { severity: Severity }[],

● Update(packages\shared\src\derive.ts)
  ⎿  Added 8 lines, removed 1 line
       1 -import { addDays, addMonths, differenceInCalendarDays, format, 
         -parseISO } from "date-fns";                                    
       1 +import {                                                       
       2 +  addDays,                                                     
       3 +  addMonths,                                                   
       4 +  differenceInCalendarDays,                                    
       5 +  differenceInMonths,                                          
       6 +  format,                                                      
       7 +  parseISO,                                                    
       8 +} from "date-fns";                                             
       9  import type { Alert, Derived, ExtractionResult, Severity } from
           "./schemas/extraction.js";
      10  
      11  // The model extracts facts, this does the date math. Pure and 
          browser safe: the api reruns it on

● The helper name clashes with a local const currentTermEnd inside deriveDates.
  Renaming the helper.

● Bash(cd /e/contract-analysis-pipeline/packages/shared/src && sed -i
      's/function currentTermEnd(start/function firstTermEndingFrom(start/;
      s/end = currentTermEnd(base…)
  ⎿  53:function firstTermEndingFrom(start: Date, offset: number, len: numb
     er, today: Date): Date {
     100:      end = firstTermEndingFrom(base.start, base.offset, renewalMo
     … +6 lines (ctrl+o to expand)
  ⎿  Updated packages\shared\src\derive.ts (+2 -2)
      50  // contract would go Feb 28, Mar 28, Apr 28 instead of Feb 28, 
          Mar 30, Apr 29.
      51  // Returns the end of the first term that ends on or after toda
          y. k is estimated from the month
      52  // difference, which is off by at most one, so the loops below 
          step once or twice.
      53 -function currentTermEnd(start: Date, offset: number, len: numbe
         -r, today: Date): Date {                                        
      53 +function firstTermEndingFrom(start: Date, offset: number, len: 
         +number, today: Date): Date {                                   
      54    const end = (k: number) => termEnd(start, offset + k * len);
      55    let k = Math.max(0, Math.floor((differenceInMonths(today, sta
          rt) - offset) / len));
      56    while (end(k) < today) k++;
     ...
       97          effective !== null && initial !== null
       98            ? { start: toDate(effective), offset: initial }
       99            : { start: addDays(end, 1), offset: 0 };
      100 -      end = currentTermEnd(base.start, base.offset, renewalMon
          -ths, now);                                                    
      100 +      end = firstTermEndingFrom(base.start, base.offset, renew
          +alMonths, now);                                               
      101      } else {
      102        later.push({
      103          level: "warning",

  Read 1 file (ctrl+o to expand)

● Update(packages\shared\src\derive.test.ts)  ⎿  Added 45 lines
      246        "expiration_mismatch",
      247      ]);
      248    });
      249 +                                                              
      250 +  it("keeps a Jan 31 monthly contract on month ends instead of
          + drifting to the 28th", () => {                               
      251 +    const jan31 = facts({                                     
      252 +      effective_date: "2024-01-31",                           
      253 +      initial_term_months: 1,                                 
      254 +      renewal_term_months: 1,                                 
      255 +      auto_renewal: true,                                     
      256 +    });                                                       
      257 +    const termEndOn = (today: string) =>                      
      258 +      deriveDates(jan31, [], 1, THRESHOLD, today).current_term
          +_end;                                                         
      259 +                                                              
      260 +    expect(termEndOn("2024-02-10")).toBe("2024-02-28");       
      261 +    expect(termEndOn("2024-03-01")).toBe("2024-03-30");       
      262 +    expect(termEndOn("2024-03-31")).toBe("2024-04-29");       
      263 +    expect(termEndOn("2024-04-29")).toBe("2024-04-29");       
      264 +  });                                                         
      265 +                                                              
      266 +  it("rolls a monthly contract from 2010 straight to the curre
          +nt term", () => {                                             
      267 +    const d = derive(                                         
      268 +      facts({                                                 
      269 +        effective_date: "2010-01-15",                         
      270 +        initial_term_months: 12,                              
      271 +        renewal_term_months: 1,                               
      272 +        termination_notice_days: 3,                           
      273 +        auto_renewal: true,                                   
      274 +      }),                                                     
      275 +    );                                                        
      276 +                                                              
      277 +    expect(d).toMatchObject({                                 
      278 +      expiration_date: "2011-01-14",                          
      279 +      current_term_end: "2026-10-14",                         
      280 +      next_renewal_date: "2026-10-15",                        
      281 +      notice_deadline: "2026-10-11",                          
      282 +      days_until_notice_deadline: 2,                          
      283 +    });                                                       
      284 +  });                                                         
      285 +                                                              
      286 +  it("anchors on the day after the expiration when the start i
          +s unknown", () => {                                           
      287 +    const d = derive(                                         
      288 +      facts({ expiration_date: "2023-03-31", renewal_term_mont
          +hs: 3, auto_renewal: true }),                                 
      289 +    );                                                        
      290 +                                                              
      291 +    // Terms start Apr 1, Jul 1, Oct 1, Jan 1: the one coverin
          +g 2026-10-09 ends Dec 31.                                     
      292 +    expect(d.current_term_end).toBe("2026-12-31");            
      293 +  });                                                         
      294  });

  Ran 1 shell command (ctrl+o to expand)

● Derive fix done; the old loop would have given 2024-03-28 there. Now
  review.ts, tests first.

● Write(services\worker\src\extraction\review.test.ts)
  ⎿  Wrote 140 lines to services\worker\src\extraction\review.test.ts
       1 import type { Alert } from "@nexus/shared";
       2 import { describe, expect, it } from "vitest";
       3 import type { GroundedExtraction } from "./grounding.js";
       4 import { decideNeedsReview, type ReviewInput } from "./review.js
         ";
       6 const notFound = {
       7   value: null,
       8   quote: null,
       9   confidence: "low",
      10   quote_verified: false,
     … +153 lines (ctrl+o to expand)

● Write(services\worker\src\extraction\review.ts)
  ⎿  Wrote 69 lines to services\worker\src\extraction\review.ts
       1 import type { Alert, AlertCode } from "@nexus/shared";
       2 import type { GroundedExtraction } from "./grounding.js";
       3 import type { Conflict } from "./merge.js";
       4 
       5 export interface ReviewInput {
       6   data: GroundedExtraction;
       7   conflicts: readonly Conflict[];
       8   warnings: readonly string[];
       9   groundingScore: number | null;
      10   threshold: number;
     … +73 lines (ctrl+o to expand)

● Bash(npx prettier --write services/worker/src/extraction >/dev/null && npx
      vitest run services/worker/src/extraction/review.test.ts 2>&1 | grep -E
      "Tests |FAIL|×|Exp…)
  ⎿        Tests  7 passed (7)
  ⎿  Updated services\worker\src\extraction\review.test.ts (+5 -1)
      64          data: {
      65            ...data,
      66            vendor_name: { ...data.vendor_name, quote_verified: f
          alse, quote_page: null },
      67 -          termination_notice_days: { ...data.termination_notice
         -_days, quote: null, quote_verified: false },                   
      67 +          termination_notice_days: {                           
      68 +            ...data.termination_notice_days,                   
      69 +            quote: null,                                       
      70 +            quote_verified: false,                             
      71 +          },                                                   
      72            // Not a key field, so it doesn't count.
      73            customer_name: { ...data.customer_name, quote_verifie
          d: false },
      74          },

● Review is done. Before wiring analyze.ts, checking the event stage values and
  whether transitionStatus can share a transaction with insertExtraction.

  Searched for 1 pattern (ctrl+o to expand)

● I'll keep transitionStatus's single UPDATE combined with the insert in one
  transaction, then extract the grounding score into a groundingScore(data)
  function so merged results are scored like chunks.

  Ran 1 shell command (ctrl+o to expand)

● Bash(node - <<'EOF'
      const fs = require("fs");…)
  ⎿  import { ExtractedFieldName, type Confidence, type ExtractionResult }
     from "@nexus/shared";
     import type { NormalizedExtraction } from "./normalize.js";
     … +2 lines (ctrl+o to expand)
  ⎿  Updated services\worker\src\extraction\grounding.ts (+16 -9)
      1 -import type { Confidence, ExtractionResult } from "@nexus/shared
        -";                                                              
      1 +import { ExtractedFieldName, type Confidence, type ExtractionRes
        +ult } from "@nexus/shared";                                     
      2  import type { NormalizedExtraction } from "./normalize.js";
      3  
      4  // The main defense against made up and injected values: a value
          only counts as verified when its
     ...
      232    confidence: Confidence;
      233  }
      234  
      235 +const FIELD_NAMES = ExtractedFieldName.options;               
      236 +                                                              
      237 +// Every found value and every risk clause counts, quoted or n
          +ot. Leaving out values without a quote                        
      238 +// would make a model that skips quotes look better grounded t
          +han one that quotes slightly wrong.                           
      239 +// Computed from the flags, so the merged result is scored the
          + same way as a single chunk.                                  
      240 +export function groundingScore(data: GroundedExtraction): numb
          +er | null {                                                   
      241 +  const items = [                                             
      242 +    ...FIELD_NAMES.map((name) => data[name]).filter((f) => f.v
          +alue !== null),                                               
      243 +    ...data.risk_clauses,                                     
      244 +  ];                                                          
      245 +  if (items.length === 0) return null;                        
      246 +  return items.filter((i) => i.quote_verified).length / items.
          +length;                                                       
      247 +}                                                             
      248 +                                                              
      249  export function groundExtraction(
      250    index: GroundingIndex,
      251    data: NormalizedExtraction,
      252  ): { data: GroundedExtraction; score: number | null } {
      239 -  // Every found value and every risk clause counts, quoted or
          - not. Leaving out values without a quote                      
      240 -  // would make a model that skips quotes look better grounded
          - than one that quotes slightly wrong.                         
      241 -  let total = 0;                                              
      242 -  let verified = 0;                                           
      243 -                                                              
      253    function check(quote: string | null): { quote_verified: bool
           ean; quote_page: number | null } {
      245 -    total++;                                                  
      254      if (quote === null) return { quote_verified: false, quote_
           page: null };
      255      const result = verifyQuote(index, quote);
      248 -    if (result.verified) verified++;                          
      256      return { quote_verified: result.verified, quote_page: resu
           lt.page };
      257    }
      258  
     ...
      284      summary: data.summary,
     … 5 more lines (ctrl+o to expand)

● Now analyze.ts, replacing the placeholder.

● Write(services\worker\src\pipeline\analyze.ts)
  ⎿  Added 153 lines, removed 4 lines
       1  import { resolve } from "node:path";
       2 -import type { Stage } from "@nexus/shared";                    
       2 +import {                                                       
       3 +  deriveDates,                                                 
       4 +  ErrorCode,                                                   
       5 +  ExtractionResultSchema,                                      
       6 +  type ExtractionResult,                                       
       7 +  type Stage,                                                  
       8 +} from "@nexus/shared";                                        
       9 +import { z } from "zod";                                       
      10  import type { WorkerDeps } from "../deps.js";
      11 +import { chunkText } from "../extraction/chunk.js";            
      12 +import { extractChunk, type ChunkExtraction } from "../extracti
         +on/extract.js";                                                
      13 +import { buildGroundingIndex, groundExtraction, groundingScore 
         +} from "../extraction/grounding.js";                           
      14 +import { mapLimit } from "../extraction/limit.js";             
      15 +import { mergeExtractions } from "../extraction/merge.js";     
      16 +import { normalizeExtraction } from "../extraction/normalize.js
         +";                                                             
      17 +import { decideNeedsReview } from "../extraction/review.js";   
      18 +import { summarizeExtraction } from "../extraction/summarize.js
         +";                                                             
      19 +import { PROMPT_VERSION } from "../llm/prompts/extract.v1.js"; 
      20 +import type { LlmUsage } from "../llm/types.js";               
      21  import { parseDocument, type ParsedDocument } from "../parse/in
          dex.js";
      22 +import { PermanentError } from "./errors.js";                  
      23  
      24  export interface AnalyzeInput {
      25    // As stored on the document row: relative to UPLOAD_DIR.
     ...
       38    onStage?: StageRunner;
       39  }
       40  
       41 +export interface AnalysisMeta {                               
       42 +  provider: string;                                           
       43 +  model: string;                                              
       44 +  promptVersion: string;                                      
       45 +  chunkCount: number;                                         
       46 +  // Every call, including failed repairs and the summary.    
       47 +  tokens: LlmUsage;                                           
       48 +  durationMs: number;                                         
       49 +}                                                             
       50 +                                                              
       51  export interface AnalysisResult {
       52    parsed: ParsedDocument;
       25 -  extraction: null;                                           
       53 +  result: ExtractionResult;                                   
       54    needsReview: boolean;
       55 +  meta: AnalysisMeta;                                         
       56  }
       57  
       58  const runDirectly: StageRunner = (_stage, fn) => fn();
       59  
       60 +function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {       
       61 +  return {                                                    
       62 +    inputTokens: a.inputTokens + b.inputTokens,               
       63 +    outputTokens: a.outputTokens + b.outputTokens,            
       64 +  };                                                          
       65 +}                                                             
       66 +                                                              
       67 +// One local gpu: a second ollama request just waits in ollama
          +'s queue while its timeout keeps                              
       68 +// running, and parallel slots multiply the kv cache. Hosted p
          +roviders can take the configured fan out.                     
       69 +function chunkConcurrency(deps: AnalyzeDeps): number {        
       70 +  const configured = deps.config.LLM_CHUNK_CONCURRENCY;       
       71 +  if (deps.provider.name !== "ollama") return configured;     
       72 +  if (configured > 1) {                                       
       73 +    deps.logger.info({ configured }, "ollama runs one chunk at
          + a time, ignoring LLM_CHUNK_CONCURRENCY");                    
       74 +  }                                                           
       75 +  return 1;                                                   
       76 +}                                                             
       77 +                                                              
       78 +async function extractAll(                                    
       79 +  parsed: ParsedDocument,                                     
       80 +  input: AnalyzeInput,                                        
       81 +  deps: AnalyzeDeps,                                          
       82 +): Promise<ChunkExtraction[]> {                               
       83 +  const { config, logger, provider } = deps;                  
       84 +  const chunks = chunkText(parsed.text, config.LLM_MAX_INPUT_C
          +HARS);                                                        
       85 +  const opts = {                                              
       86 +    filename: input.filename,                                 
       87 +    chunkCount: chunks.length,                                
       88 +    timeoutMs: config.LLM_TIMEOUT_MS,                         
       89 +  };                                                          
       90 +  return mapLimit(chunks, chunkConcurrency(deps), async (chunk
          +) => {                                                        
       91 +    const extraction = await extractChunk(provider, chunk, opt
          +s);                                                           
       92 +    logger.info(                                              
       93 +      {                                                       
       94 +        chunk: chunk.index + 1,                               
       95 +        of: chunks.length,                                    
       96 +        chars: chunk.text.length,                             
       97 +        repaired: extraction.repaired,                        
       98 +        latencyMs: extraction.latencyMs,                      
       99 +        ...extraction.usage,                                  
      100 +      },                                                      
      101 +      "chunk extracted",                                      
      102 +    );                                                        
      103 +    return extraction;                                        
      104 +  });                                                         
      105 +}                                                             
      106 +                                                              
      107 +async function validate(                                      
      108 +  parsed: ParsedDocument,                                     
      109 +  extractions: readonly ChunkExtraction[],                    
      110 +  deps: AnalyzeDeps,                                          
      111 +): Promise<{ result: ExtractionResult; needsReview: boolean; s
          +ummaryUsage: LlmUsage }> {                                    
      112 +  const { config, logger, provider } = deps;                  
      113 +  const threshold = config.GROUNDING_REVIEW_THRESHOLD;        
      114 +  const index = buildGroundingIndex(parsed.text);             
      115 +  const warnings: string[] = [];                              
      116 +                                                              
      117 +  const grounded = extractions.map((e) => {                   
      118 +    const normalized = normalizeExtraction(e.data);           
      119 +    warnings.push(...normalized.warnings);                    
      120 +    return { chunkIndex: e.chunkIndex, data: groundExtraction(
          +index, normalized.data).data };                               
      121 +  });                                                         
      122 +  const merged = mergeExtractions(grounded);                  
      123 +  const summary = await summarizeExtraction(                  
      124 +    provider,                                                 
      125 +    merged.data,                                              
      126 +    grounded.map((g) => g.data.summary),                      
      127 +    { timeoutMs: config.LLM_TIMEOUT_MS, logger },             
      128 +  );                                                          
      129 +  warnings.push(...summary.warnings);                         
      130 +                                                              
      131 +  const score = groundingScore(merged.data);                  
      132 +  const today = deps.clock().toISOString().slice(0, 10);      
      133 +  const derived = deriveDates(merged.data, merged.data.risk_cl
          +auses, score, threshold, today);                              
      134 +  const review = decideNeedsReview({                          
      135 +    data: merged.data,                                        
      136 +    conflicts: merged.conflicts,                              
      137 +    warnings,                                                 
      138 +    groundingScore: score,                                    
      139 +    threshold,                                                
      140 +    alerts: derived.alerts,                                   
      141 +  });                                                         
      142 +                                                              
      143 +  // Every step above builds the strict shape by construction,
          + so a failure here is our bug, not                            
      144 +  // the model's, and retrying won't fix it.                  
      145 +  const parsedResult = ExtractionResultSchema.safeParse({     
      146 +    ...merged.data,                                           
      147 +    summary: summary.summary,                                 
      148 +    derived,                                                  
      149 +    conflicts: merged.conflicts,                              
      150 +    // The same normalize warning can come from several chunks
          +.                                                             
      151 +    warnings: [...new Set([...warnings, ...review.reasons])], 
      152 +    grounding_score: score,                                   
      153 +  });                                                         
      154 +  if (!parsedResult.success) {                                
      155 +    throw new PermanentError(                                 
      156 +      ErrorCode.INTERNAL,                                     
      157 +      `extraction result failed the stored schema: ${z.prettif
          +yError(parsedResult.error)}`,                                 
      158 +    );                                                        
      159 +  }                                                           
      160 +  return { result: parsedResult.data, needsReview: review.need
          +sReview, summaryUsage: summary.usage };                       
      161 +}                                                             
      162 +                                                              
      163  export async function analyzeDocument(
      164    input: AnalyzeInput,
      165    deps: AnalyzeDeps,
      166    hooks: AnalyzeHooks = {},
      167  ): Promise<AnalysisResult> {
      168 +  const started = performance.now();                          
      169    const onStage = hooks.onStage ?? runDirectly;
      170    const path = resolve(deps.config.UPLOAD_DIR, input.path);
      171  
      172    const parsed = await onStage("parsing", () => parseDocument(
           path, input.mime, deps.logger));
      173 +  const extractions = await onStage("extracting", () => extrac
          +tAll(parsed, input, deps));                                   
      174 +  const { result, needsReview, summaryUsage } = await onStage(
          +"validating", () =>                                           
      175 +    validate(parsed, extractions, deps),                      
      176 +  );                                                          
      177  
       41 -  // Extraction is not built yet, and with nothing extracted t
          -here is nothing to trust unreviewed.                          
       42 -  return { parsed, extraction: null, needsReview: true };     
      178 +  const tokens = extractions.reduce((sum, e) => addUsage(sum, 
          +e.usage), summaryUsage);                                      
      179 +  return {                                                    
      180 +    parsed,                                                   
      181 +    result,                                                   
      182 +    needsReview,                                              
      183 +    meta: {                                                   
      184 +      provider: deps.provider.name,                           
      185 +      model: deps.provider.model,                             
      186 +      promptVersion: PROMPT_VERSION,                          
      187 +      chunkCount: extractions.length,                         
      188 +      tokens,                                                 
      189 +      durationMs: Math.round(performance.now() - started),    
      190 +    },                                                        
      191 +  };                                                          
      192  }
  ⎿  You've hit your weekly limit · resets Oct 13, 11am (Europe/Sofia)
     /upgrade or /usage-credits to finish what you’re working on.

✻ Brewed for 3m 13s · done 12:29 AM

❯ /login                                                                        
  ⎿  Login successful

❯ choices 1-4 fine, schema change fine, I'll re-run any local docs.             
                                                                                
  100 rolls: drop the loop, it also has a real bug. repeating addMonths(end + 1 
  day, len) - 1 day drifts at month ends: a contract starting jan 31 with       
  monthly terms gets term ends feb 28 -> mar 28 -> apr 28, should be feb 28 ->  
  mar 30 -> apr 29. compute it instead:                                         
  - effective date + initial term known: term end k = addMonths(effective,      
  initial + k * len) - 1 day                                                    
  - otherwise anchor on expiration + 1 day: term end k = addMonths(anchor, k *  
  len) - 1 day                                                                  
  - len = renewal_term_months ?? initial_term_months, smallest k where term end 
  >= today. estimate k from differenceInMonths and step at most a couple of     
  times, no cap needed                                                          
    tests: the jan 31 monthly case, and a monthly contract starting 2010 rolls  
  straight to the right term.                                                   
                                                                                
  then review.ts decideNeedsReview({ data, conflicts, warnings, groundingScore, 
  threshold, alerts }) -> { needsReview, reasons }. flag if:                    
  - grounding < threshold                                                       
  - a key field has a value with an unverified quote (vendor_name,              
  effective_date, expiration_date, total_contract_value,                        
  termination_notice_days)                                                      
  - any conflicts                                                               
  - normalize dropped a key field                                               
  - derive returned an expiration_mismatch, no_notice_period or                 
  renewal_term_unknown alert (by code). no_notice_period matters most: the 7b   
  missed "at least 60 days before the renewal date" once, and without notice    
  days there's no deadline, which is the whole point of the dashboard           
    reasons go into warnings prefixed "review: " (ui uses that).                
                                                                                
  now replace the placeholder in pipeline/analyze.ts (no new file):             
  parsing -> parseDocument (already there)                                      
  extracting -> chunkText + mapLimit(extractChunk, LLM_CHUNK_CONCURRENCY),      
  forced to 1 for ollama. one local gpu: a second request just waits in         
  ollama's queue while its 5 min timeout keeps running, and parallel slots      
  multiply the kv cache. log it once at start if the config asked for more      
  validating -> normalize + ground each chunk, merge, summarize, derive,        
  review, then ExtractionResultSchema.parse. if that last parse fails it's our  
  bug -> PermanentError INTERNAL with the zod message                           
  return { parsed, result, needsReview, meta { provider, model, promptVersion,  
  chunkCount, tokens, durationMs } }. log one line per chunk.                   
                                                                                
  processJob on success: insertExtraction with all the meta, completed with     
  needs_review, info event "chunks={n} grounding={score} needs_review={bool}".  
                                                                                
  plus one test running analyzeDocument with a mock that returns real quotes on 
  a generated 2 chunk pdf: validates, pages filled, needs_review false. the     
  processJob test that expects needs_review true from the placeholder needs     
  updating. mock only, typecheck, lint, test.                                   

● Same step as before the login, so I'm continuing where I was: the derive fix,
  review.ts and the new analyze.ts are written. Remaining: processJob, the
  tests, and the checks.

  Ran 1 shell command (ctrl+o to expand)

● Bash(cd /e/contract-analysis-pipeline/services/worker/src/pipeline && node -
      <<'EOF'
      const fs = require("fs");…)
  ⎿  Updated services\worker\src\pipeline\run.ts (+30 -13)
       4    ExtractJobPayload,
       5    getDocument,
       6    insertEvent,
       7 +  insertExtraction,                                            
       8    transitionStatus,
       9    type Logger,
      10  } from "@nexus/shared/node";
     ...
       65      throw handleFailure(job, ctx, log, err);
       66    }
       67  
       67 -  if (result.extraction === null) {                           
       68 +  const { needsReview, meta } = result;                       
       69 +  const groundingScore = result.result.grounding_score;       
       70 +  // One transaction: a completed document always has its extr
          +action, and a document that left                              
       71 +  // processing in the meantime (a retry bumped its run) doesn
          +'t get this run's result attached.                            
       72 +  const completed = deps.db.transaction(() => {               
       73 +    const moved = transitionStatus(deps.db, documentId, "compl
          +eted", {                                                      
       74 +      from: "processing",                                     
       75 +      needs_review: needsReview,                              
       76 +    });                                                       
       77 +    if (!moved) return false;                                 
       78 +    insertExtraction(deps.db, {                               
       79 +      document_id: documentId,                                
       80 +      run,                                                    
       81 +      provider: meta.provider,                                
       82 +      model: meta.model,                                      
       83 +      prompt_version: meta.promptVersion,                     
       84 +      result: result.result,                                  
       85 +      grounding_score: groundingScore,                        
       86 +      chunk_count: meta.chunkCount,                           
       87 +      input_tokens: meta.tokens.inputTokens,                  
       88 +      output_tokens: meta.tokens.outputTokens,                
       89 +      duration_ms: meta.durationMs,                           
       90 +    });                                                       
       91      insertEvent(deps.db, {
       92        document_id: documentId,
       93        run,
       71 -      stage: "extracting",                                    
       94 +      stage: "job",                                           
       95        outcome: "info",
     … 23 more lines (ctrl+o to expand)
  ⎿  (timeout 5m)

● processJob now stores the extraction and the completion event in one
  transaction. Now the tests: updating analyze.test.ts and adding the 2-chunk
  PDF case.

  Ran 1 shell command (ctrl+o to expand)

● Bash(cd /e/contract-analysis-pipeline/services/worker/src/pipeline && node -
      <<'EOF'
      const fs = require("fs");…)
  ⎿        Tests  5 passed (5)
  ⎿  Updated services\worker\src\pipeline\analyze.test.ts (+147 -5)
      2  import { tmpdir } from "node:os";
      3  import { join } from "node:path";
      4  import { afterAll, beforeAll, describe, expect, it } from "vites
         t";
      5 -import type { Stage } from "@nexus/shared";                     
      5 +import { ExtractionResultSchema, type LlmExtraction, type Stage 
        +} from "@nexus/shared";                                         
      6 +import { MOCK_EXTRACTION, MockProvider } from "../llm/mock.js"; 
      7  import { makeDeps } from "../test-support/fixtures.js";
      8  import { makePdf } from "../test-support/pdf.js";
      9  import { analyzeDocument, type StageRunner } from "./analyze.js"
         ;
     ...
      11  
      12  const PDF = "application/pdf";
      13  const LINE = "The supplier shall provide the services described
           in this agreement";
      14 +const FILLER =                                                 
      15 +  "The Vendor shall provide the hosting services described in S
         +chedule A with reasonable skill and care.";                    
      16 +                                                               
      17 +// Two pages, each just under the chunk budget used below, so e
         +ach page becomes its own chunk.                                
      18 +const PAGE_1 = [                                               
      19 +  "MASTER SERVICES AGREEMENT",                                 
      20 +  "This Master Services Agreement is made between Acme Hosting 
         +Ltd (the Vendor) and Nexus Corp (the Customer).",              
      21 +  "1. Term",                                                   
      22 +  "This Agreement takes effect on 2026-03-01 and continues for 
         +an initial term of twelve (12) months.",                       
      23 +  "2. Services",                                               
      24 +  ...Array.from({ length: 6 }, () => FILLER),                  
      25 +];                                                             
      26 +const PAGE_2 = [                                               
      27 +  "3. Fees",                                                   
      28 +  "The Customer shall pay total fees of USD 120,000 for the ini
         +tial term, payable within thirty (30) days of invoice.",       
      29 +  "4. Renewal",                                                
      30 +  "This Agreement renews automatically for successive terms of 
         +twelve (12) months unless either party gives at least sixty (60
         +) days written notice.",                                       
      31 +  "5. Price changes",                                          
      32 +  "The Vendor may increase the fees at any time on thirty (30) 
         +days notice.",                                                 
      33 +  ...Array.from({ length: 5 }, () => FILLER),                  
      34 +];                                                             
      35 +const CHUNK_BUDGET = "1200";                                   
      36 +                                                               
      37 +const high = <T>(value: T, quote: string) => ({ value, quote, c
         +onfidence: "high" as const });                                 
      38 +                                                               
      39 +const PART_1: LlmExtraction = {                                
      40 +  ...MOCK_EXTRACTION,                                          
      41 +  document_type: high("contract", "MASTER SERVICES AGREEMENT"),
     … 145 more lines (ctrl+o to expand)
  ⎿  Updated services\worker\src\pipeline\analyze.ts (+9 -2)
      70    const configured = deps.config.LLM_CHUNK_CONCURRENCY;
      71    if (deps.provider.name !== "ollama") return configured;
      72    if (configured > 1) {
      73 -    deps.logger.info({ configured }, "ollama runs one chunk at 
         -a time, ignoring LLM_CHUNK_CONCURRENCY");                      
      73 +    deps.logger.info(                                          
      74 +      { configured },                                          
      75 +      "ollama runs one chunk at a time, ignoring LLM_CHUNK_CONC
         +URRENCY",                                                      
      76 +    );                                                         
      77    }
      78    return 1;
      79  }
     ...
      160        `extraction result failed the stored schema: ${z.prettif
           yError(parsedResult.error)}`,
      161      );
      162    }
      160 -  return { result: parsedResult.data, needsReview: review.need
          -sReview, summaryUsage: summary.usage };                       
      163 +  return {                                                    
      164 +    result: parsedResult.data,                                
      165 +    needsReview: review.needsReview,                          
      166 +    summaryUsage: summary.usage,                              
      167 +  };                                                          
      168  }
      169  
      170  export async function analyzeDocument(

● All 5 pass, including the 2-chunk case. Now the processJob test.

● Bash(cd /e/contract-analysis-pipeline/services/worker/src/pipeline && node -
      <<'EOF'
      const fs = require("fs");…)
  ⎿  services/worker/src/pipeline/analyze.test.ts(168,31): error TS2339: Pr
     operty 'complete' does not exist on type 'never'.
     services/worker/src/pipeline/analyze.test.ts(169,14): error TS2339: Pr
     … +10 lines (ctrl+o to expand)
  ⎿  Updated services\worker\src\pipeline\run.test.ts (+29 -4)
       3  import { join } from "node:path";
       4  import { UnrecoverableError } from "bullmq";
       5  import { afterAll, beforeAll, describe, expect, it, vi } from "
          vitest";
       6 -import { ErrorCode } from "@nexus/shared";                     
       7 -import { getDocument, listEvents, transitionStatus } from "@nex
         -us/shared/node";                                               
       6 +import { ErrorCode, ExtractionResultSchema } from "@nexus/share
         +d";                                                            
       7 +import { getDocument, getExtraction, listEvents, transitionStat
         +us } from "@nexus/shared/node";                                
       8  import { docId, makeDeps as makeBaseDeps, seedDocument } from "
          ../test-support/fixtures.js";
       9  import { makePdf } from "../test-support/pdf.js";
      10  import type * as analyzeModule from "./analyze.js";
     ...
      78      expect(getDocument(deps.db, id)).toMatchObject({ status: "c
          ompleted", attempts: 0 });
      79    });
      80  
      81 -  it("parses a real 2 page pdf and completes it with needs_revi
         -ew", async () => {                                             
      81 +  it("analyzes a real 2 page pdf, stores the extraction and com
         +pletes it", async () => {                                      
      82      const { deps } = makeDeps();
      83      const id = seedDocument(deps);
      84  
     ...
       93      });
       94      expect(listEvents(deps.db, id)).toEqual([
       95        expect.objectContaining({ stage: "parsing", outcome: "ok
           " }),
       96 -      expect.objectContaining({ outcome: "info", message: "ext
          -raction not implemented yet" }),                              
       96 +      expect.objectContaining({ stage: "extracting", outcome: 
          +"ok" }),                                                      
       97 +      expect.objectContaining({ stage: "validating", outcome: 
          +"ok" }),                                                      
       98 +      // The default mock finds nothing it can quote, so groun
          +ding is 0 and a person should look.                           
       99 +      expect.objectContaining({                               
      100 +        stage: "job",                                         
      101 +        outcome: "info",                                      
      102 +        message: "chunks=1 grounding=0.00 needs_review=true", 
      103 +      }),                                                     
      104 +    ]);                                                       
      105 +    const extractionId = getDocument(deps.db, id)?.latest_extr
          +action_id ?? "";                                              
      106 +    const row = getExtraction(deps.db, extractionId);         
      107 +    expect(row).toMatchObject({                               
      108 +      document_id: id,                                        
      109 +      run: 1,                                                 
      110 +      provider: "mock",                                       
      111 +      model: "mock",                                          
      112 +      prompt_version: "extract.v1",                           
      113 +      grounding_score: 0,                                     
     … 11 more lines (ctrl+o to expand)
  ⎿  (timeout 5m)

● Tests pass, but typecheck fails in my ollama test: overriding the mock's name
  gives a never type. Building a plain LlmProvider object instead.

● Bash(cd /e/contract-analysis-pipeline/services/worker/src/pipeline && node -
      <<'EOF'
      const fs = require("fs");…)
  ⎿    it("runs ollama one chunk at a time and says so once when the config
      asked for more", async () => {
         const { deps, lines } = makeDeps({
     … +32 lines (ctrl+o to expand)
  ⎿  Updated services\worker\src\pipeline\analyze.test.ts (+11 -7)
       4  import { afterAll, beforeAll, describe, expect, it } from "vite
          st";
       5  import { ExtractionResultSchema, type LlmExtraction, type Stage
           } from "@nexus/shared";
       6  import { MOCK_EXTRACTION, MockProvider } from "../llm/mock.js";
       7 +import type { LlmProvider } from "../llm/types.js";            
       8  import { makeDeps } from "../test-support/fixtures.js";
       9  import { makePdf } from "../test-support/pdf.js";
      10  import { analyzeDocument, type StageRunner } from "./analyze.js
          ";
     ...
      158    });
      159  
      160    it("runs ollama one chunk at a time and says so once when th
           e config asked for more", async () => {
      160 -    const provider = Object.assign(quotingProvider(), { name: 
          -"ollama" as const });                                         
      161      const { deps, lines } = makeDeps({
      162        UPLOAD_DIR: dir,
      163        LLM_MAX_INPUT_CHARS: CHUNK_BUDGET,
      164        LLM_CHUNK_CONCURRENCY: "4",
      165      });
      166 +    const inner = quotingProvider();                          
      167      let running = 0;
      168      let peak = 0;
      168 -    const complete = provider.complete.bind(provider);        
      169 -    provider.complete = async (req) => {                      
      170 -      peak = Math.max(peak, ++running);                       
      171 -      await new Promise((r) => setTimeout(r, 5));             
      172 -      running--;                                              
      173 -      return complete(req);                                   
      169 +    const provider: LlmProvider = {                           
      170 +      name: "ollama",                                         
      171 +      model: "mock",                                          
      172 +      async complete(req) {                                   
      173 +        peak = Math.max(peak, ++running);                     
      174 +        await new Promise((r) => setTimeout(r, 5));           
      175 +        running--;                                            
      176 +        return inner.complete(req);                           
      177 +      },                                                      
      178      };
      179  
      180      await analyzeDocument(
  ⎿  (timeout 5m)
  ⎿  6 skills available

● The pipeline now runs end to end: parse, extract, validate, store. Typecheck
  and lint are clean, and npm test passed: 40 files, 428 tests. Everything ran
  against mocks only.

  Derive fix (packages/shared/src/derive.ts):
  - The loop and its cap are gone. The term end is computed as you specified,
    from the effective date plus initial term when both are known, otherwise
    from the day after expiration.
  - New tests cover the Jan 31 monthly case, the 2010 monthly contract (rolls to
    2026-10-14) and the anchor on expiration + 1 day.
  - The Jan 31 test uses a 2024 start. In a non-leap year the first term would
    end Feb 27, not Feb 28, by the same clamp-then-minus-a-day convention as
    your leap-day case.
  - The roll only runs when the expiration is before today, so a stated
    expiration that is still in the future stays the term end even with a
    mismatch alert.

  extraction/review.ts: decideNeedsReview implements your five rules and returns
  reasons already prefixed with "review: ". A dropped key field is detected
  from normalize's "<field>: dropped ..." warnings.

  pipeline/analyze.ts: the placeholder is replaced with the three stages.
  - Result shape: returns { parsed, result, needsReview, meta }.
  - Logging: one chunk extracted line per chunk.
  - Ollama: concurrency is forced to 1 with a single info line when the config
    asked for more.
  - Schema failure: a failed final parse throws PermanentError(INTERNAL) with
    the zod message.

  processJob: stores the extraction with all the meta, completes with
  needs_review, and writes the info event, e.g. chunks=1 grounding=0.00 
  needs_review=true.

  Tests:
  - 2-chunk PDF: the result validates, pages are 1 and 2, grounding is 1, and
    needsReview is false.
  - Ollama: an ollama-named provider runs one chunk at a time.
  - processJob: the test now checks the stored row and the four events.
    needs_review is still true there, because the default mock returns a
    document_type with no quote, so grounding is 0.

  Choices your spec didn't settle:
  1. Grounding score of the merged result. I added groundingScore(data) in
     grounding.ts, computed from the flags. groundExtraction uses it too, so a
     chunk and the merged result are scored by the same rule.
  2. One transaction on success. The status change, insertExtraction and the
     event are in one db transaction. If the document left processing in the
     meantime, nothing is written.
  3. Event stage. The completion event uses stage "job", like the retry event
     does.
  4. Warnings are deduplicated. The same normalize warning can come from several
     chunks, and they carry no chunk number.
  5. A dropped key field always flags review. This holds even when another chunk
     supplied a valid value for the same field.
  6. promptVersion. It is extract.v1 only; the summary prompt version isn't
     recorded.
  7. Summary tokens. The summary call runs inside the validating stage, and its
     tokens are included in meta.tokens.

  Next: review the diff, then send the next step.
✻ Cogitated for 4m 3s · done 12:45 AM

❯ live run findings:                                                            
                                                                                
  1. the reconciler delivered both queued docs as soon as redis came back       
  (stale 2, enqueued 2), nice.                                                  
  2. the worker started with concurrency 2 and both docs went to ollama at the  
  same time. same problem as chunks: one local gpu, so the second request waits 
  in ollama's queue while its 5 min timeout runs, or ollama runs both and the   
  kv cache doubles and spills more onto the cpu. force job concurrency to 1     
  when the provider is ollama, log it once at startup like the chunk one.       
  hosted providers keep the configured value.                                   
  3. choice 5 from the last step: a dropped key field should only flag review   
  when the final merged value for that field is null. if another chunk supplied 
  a valid value, the dropped one doesn't matter, and flagging it would mark     
  almost every long contract for review. test both cases.                       
                                                                                
  mock only, typecheck, lint, test.                                             

  Searched for 1 pattern, ran 1 shell command (ctrl+o to expand)

● Both concurrency limits will share one helper, so the ollama rule lives in one
  place. Writing it, then the review change.

● Bash(cat > llm/concurrency.ts <<'EOF'
      import type { Logger } from "@nexus/shared/node";…)
  ⎿  typecheck exit 0

     > lint
     … +4 lines (ctrl+o to expand)
  ⎿  Updated services\worker\src\extraction\review.test.ts (+11 -1)
      105      expect(result.reasons).toEqual(["review: chunks disagree o
           n total_contract_value"]);
      106    });
      107  
      108 -  it("flags a key field that normalize dropped, but not other 
          -dropped fields", () => {                                      
      108 +  it("flags a key field that normalize dropped and that stayed
          + empty, not other fields", () => {                            
      109      const result = decideNeedsReview(
      110        input({
      111 +        data: { ...data, effective_date: notFound },          
      112          warnings: [
      113            'effective_date: dropped "1st March 2026" (not YYYY-
           MM-DD)',
      114            'payment_terms: dropped "x" (whatever)',
     ...
      122      ]);
      123    });
      124  
      125 +  it("ignores a dropped key field when another chunk supplied 
          +a valid value", () => {                                       
      126 +    const result = decideNeedsReview(                         
      127 +      input({ warnings: ['effective_date: dropped "1st March 2
          +026" (not YYYY-MM-DD)'] }),                                   
      128 +    );                                                        
      129 +                                                              
      130 +    expect(data.effective_date.value).toBe("2026-01-01");     
      131 +    expect(result).toEqual({ needsReview: false, reasons: [] }
          +);                                                            
      132 +  });                                                         
      133 +                                                              
      134    it("flags the alerts that mean the dates can't be trusted, b
           y code", () => {
      135      const alert = (code: Alert["code"]): Alert => ({ level: "w
           arning", code, message: "m" });
      136      const result = decideNeedsReview(
  ⎿  Updated services\worker\src\extraction\review.ts (+3 -0)
      55    for (const conflict of input.conflicts) {
      56      reasons.push(`chunks disagree on ${conflict.field}`);
      57    }
      58 +  // Only when the field ended up empty. If another chunk suppl
         +ied a valid value the dropped one                              
      59 +  // doesn't matter, and flagging it would send almost every lo
         +ng contract to review.                                         
      60    for (const name of KEY_FIELDS) {
      61 +    if (input.data[name].value !== null) continue;             
      62      const prefix = `${name}: `;
      63      const dropped = input.warnings.find((w) => w.startsWith(`${
          prefix}dropped `));
      64      if (dropped) reasons.push(`${name} was dropped: ${dropped.s
          lice(prefix.length)}`);
  ⎿  Updated services\worker\src\index.ts (+9 -2)
       9    QUEUE_NAME,
      10  } from "@nexus/shared/node";
      11  import type { WorkerDeps } from "./deps.js";
      12 +import { concurrencyFor } from "./llm/concurrency.js";         
      13  import { createProvider } from "./llm/factory.js";
      14  import { processJob } from "./pipeline/run.js";
      15  
     ...
      27  
      28    const provider = createProvider(config);
      29    const deps: WorkerDeps = { db, config, logger, provider, cloc
          k: () => new Date() };
      30 +  const concurrency = concurrencyFor(                          
      31 +    provider,                                                  
      32 +    config.WORKER_CONCURRENCY,                                 
      33 +    "WORKER_CONCURRENCY",                                      
      34 +    logger,                                                    
      35 +  );                                                           
      36  
      37    const worker = new Worker(QUEUE_NAME, (job) => processJob(job
          , deps), {
      38      connection: { url: config.REDIS_URL, maxRetriesPerRequest: 
          null },
      32 -    concurrency: config.WORKER_CONCURRENCY,                    
      39 +    concurrency,                                               
      40      // Longer than the slowest llm call, so a long job can't lo
          ok stalled and run twice in parallel.
      41      lockDuration: config.LLM_TIMEOUT_MS + 60_000,
      42      // A job that crashes a worker twice is failed instead of t
          aking down the next one too.
     ...
      56    logger.info(
      57      {
      58        queue: QUEUE_NAME,
      52 -      concurrency: config.WORKER_CONCURRENCY,                  
      59 +      concurrency,                                             
      60        provider: provider.name,
      61        model: provider.model,
      62      },
  ⎿  Created services\worker\src\llm\concurrency.test.ts (+40 -0)
       1 +import { createLogger } from "@nexus/shared/node";             
       2 +import { describe, expect, it } from "vitest";                 
       3 +import { concurrencyFor } from "./concurrency.js";             
       4 +                                                               
       5 +function setup() {                                             
       6 +  const lines: Record<string, unknown>[] = [];                 
       7 +  const logger = createLogger("worker", "debug", {             
       8 +    write: (chunk: string) => lines.push(JSON.parse(chunk) as R
         +ecord<string, unknown>),                                       
       9 +  });                                                          
      10 +  return { logger, lines };                                    
      11 +}                                                              
      12 +                                                               
      13 +describe("concurrencyFor", () => {                             
      14 +  it("forces ollama to 1 and logs which setting was ignored", (
         +) => {                                                         
      15 +    const { logger, lines } = setup();                         
      16 +                                                               
      17 +    expect(concurrencyFor({ name: "ollama" }, 2, "WORKER_CONCUR
         +RENCY", logger)).toBe(1);                                      
      18 +    expect(lines).toEqual([                                    
      19 +      expect.objectContaining({                                
      20 +        configured: 2,                                         
      21 +        setting: "WORKER_CONCURRENCY",                         
      22 +        msg: "ollama runs one call at a time, ignoring WORKER_C
         +ONCURRENCY",                                                   
      23 +      }),                                                      
      24 +    ]);                                                        
      25 +  });                                                          
      26 +                                                               
      27 +  it("says nothing when ollama is already configured for 1", ()
         + => {                                                          
      28 +    const { logger, lines } = setup();                         
      29 +                                                               
      30 +    expect(concurrencyFor({ name: "ollama" }, 1, "WORKER_CONCUR
         +RENCY", logger)).toBe(1);                                      
      31 +    expect(lines).toEqual([]);                                 
      32 +  });                                                          
      33 +                                                               
      34 +  it.each(["anthropic", "openai", "mock"] as const)("keeps the 
         +configured value for %s", (name) => {                          
      35 +    const { logger, lines } = setup();                         
      36 +                                                               
      37 +    expect(concurrencyFor({ name }, 4, "LLM_CHUNK_CONCURRENCY",
         + logger)).toBe(4);                                             
      38 +    expect(lines).toEqual([]);                                 
      39 +  });                                                          
      40 +});                                                            
  ⎿  Created services\worker\src\llm\concurrency.ts (+19 -0)
       1 +import type { Logger } from "@nexus/shared/node";              
       2 +import type { LlmProvider } from "./types.js";                 
       3 +                                                               
       4 +// One local gpu: a second ollama request just waits in ollama'
         +s queue while its timeout keeps                                
       5 +// running, or ollama runs both and the kv cache doubles and sp
         +ills onto the cpu. So anything that                            
       6 +// fans out llm calls (jobs, chunks) runs one at a time on olla
         +ma. Hosted providers keep the                                  
       7 +// configured value.                                           
       8 +export function concurrencyFor(                                
       9 +  provider: Pick<LlmProvider, "name">,                         
      10 +  configured: number,                                          
      11 +  setting: string,                                             
      12 +  logger: Logger,                                              
      13 +): number {                                                    
      14 +  if (provider.name !== "ollama") return configured;           
      15 +  if (configured > 1) {                                        
      16 +    logger.info({ configured, setting }, `ollama runs one call 
         +at a time, ignoring ${setting}`);                              
      17 +  }                                                            
      18 +  return 1;                                                    
      19 +}                                                              
  ⎿  … 2 more files changed
  ⎿  (timeout 5m)

● Both fixes are in. Typecheck and lint are clean, and npm test passed: 41
  files, 434 tests. Everything ran against mocks only.

  Job concurrency on ollama:
  - New llm/concurrency.ts with concurrencyFor(provider, configured, setting, 
    logger). On ollama it returns 1 and logs once when the config asked for
    more, e.g. "ollama runs one call at a time, ignoring WORKER_CONCURRENCY".
    Hosted providers and the mock keep the configured value.
  - index.ts uses it for the bullmq concurrency at startup. The "worker started"
    line now logs the effective value.
  - analyze.ts uses the same helper for chunks, so the ollama rule exists in one
    place. The chunk message changed to the same wording, with
    LLM_CHUNK_CONCURRENCY.
  - The helper has its own tests. The startup wiring in index.ts is not tested,
    since that file is the process entry point.

  Dropped key field (review.ts): it now flags review only when the merged value
  for that field is null. Tests cover both cases: the field stayed empty
  (flagged) and another chunk supplied a value (not flagged).

  Next: restart the worker with ollama and check the startup log shows
  concurrency: 1.

✻ Crunched for 1m 47s · done 1:09 AM

❯ first full live run passed: both samples completed, every value and page      
  right, grounding 1.00, needs_review false, ~70-76s per doc on ollama.         
                                                                                
  one real bug from the logs: a job that was killed twice failed inside bullmq  
  with "job stalled more than allowable limit" (UnrecoverableError,             
  maxStalledCount 1). our processJob never runs in that case, so the document   
  row would stay "processing" forever, no error, no retry. the reconciler only  
  sweeps queued rows so it never gets fixed.                                    
                                                                                
  fix: in the worker's failed handler, when a job has failed for good (stalled  
  limit, or any final failure where the row is still processing for that run),  
  move the row to failed through transitionStatus with a clear error code and   
  message ("worker stopped while processing this document twice"), plus a       
  failed event. use an existing ErrorCode if one fits, otherwise add one and    
  tell me. it has to be a no-op when processJob already marked the row failed   
  or the run is stale, so check status + run in the same transaction like the   
  success path does.                                                            
                                                                                
  tests: stalled-limit failure on a processing row -> failed with the code +    
  event, failure for a stale run -> nothing changes, row already failed ->      
  nothing changes. mock only, typecheck, lint, test.                            

  Searched for 1 pattern, ran 4 shell commands (ctrl+o to expand)

● Reading bullmq 6.3's source to see how a stalled-limit failure reaches the
  failed handler, and how to tell a final failure from one that will be retried.

  Ran 1 shell command (ctrl+o to expand)

● BullMQ 6.3 confirms that a job exceeding the stall limit fails with an
  UnrecoverableError before our processor runs, and job.finishedOn only gets set
  on a final failure—so I'll use finishedOn as the "failed for good" signal.
  Next, I'll check where ErrorCode is mapped before adding a new code.

  Searched for 1 pattern, ran 1 shell command (ctrl+o to expand)

● No DB constraint and no exhaustive map, so adding a code is safe. Writing the
  tests, then the handler.

● Bash(node - <<'EOF'
      const fs = require("fs");…)
  ⎿  typecheck exit 0

     > lint
     … +11 lines (ctrl+o to expand)
  ⎿  Updated packages\shared\src\status.ts (+2 -0)
      23    EXTRACTION_INVALID: "EXTRACTION_INVALID",
      24    LLM_UNAVAILABLE: "LLM_UNAVAILABLE",
      25    LLM_AUTH: "LLM_AUTH",
      26 +  // The worker process died or hung while holding the job, mor
         +e often than bullmq allows.                                    
      27 +  WORKER_STOPPED: "WORKER_STOPPED",                            
      28    INTERNAL: "INTERNAL",
      29  } as const;
      30  export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCo
          de];
  ⎿  Updated services\worker\src\index.ts (+7 -1)
      11  import type { WorkerDeps } from "./deps.js";
      12  import { concurrencyFor } from "./llm/concurrency.js";
      13  import { createProvider } from "./llm/factory.js";
      14 -import { processJob } from "./pipeline/run.js";                
      14 +import { handleFinalFailure, processJob } from "./pipeline/run.
         +js";                                                           
      15  
      16  const config = loadConfig();
      17  const logger = createLogger("worker", config.LOG_LEVEL);
     ...
      48        { jobId: job?.id, documentId: documentIdOf(job?.data), at
          temptsMade: job?.attemptsMade, err },
      49        "job failed",
      50      );
      51 +    try {                                                      
      52 +      handleFinalFailure(job, err, deps);                      
      53 +    } catch (handlerErr) {                                     
      54 +      // A throw inside an event listener would surface as an u
         +ncaught exception.                                             
      55 +      logger.error({ jobId: job?.id, err: handlerErr }, "could 
         +not mark the document failed");                                
      56 +    }                                                          
      57    });
      58    // Without a listener bullmq prints connection errors to the 
          console.
      59    worker.on("error", (err) => {
  ⎿  Updated services\worker\src\pipeline\run.test.ts (+82 -1)
      10  import type * as analyzeModule from "./analyze.js";
      11  import { analyzeDocument } from "./analyze.js";
      12  import { PermanentError, TransientError } from "./errors.js";
      13 -import { processJob, type ExtractJob } from "./run.js";        
      13 +import { handleFinalFailure, processJob, type ExtractJob, type 
         +FailedJob } from "./run.js";                                   
      14  
      15  // Wraps the real analysis so the happy path parses real files,
           while failure tests can make it throw.
      16  vi.mock("./analyze.js", async (importOriginal) => {
     ...
      220      expect(getDocument(deps.db, id)?.status).toBe("failed");
      221    });
      222  });
      223 +                                                              
      224 +describe("handleFinalFailure", () => {                        
      225 +  const stalledError = new UnrecoverableError("job stalled mor
          +e than allowable limit");                                     
      226 +                                                              
      227 +  function failedJob(run: number, finishedOn: number | undefin
          +ed = Date.now()): FailedJob {                                 
      228 +    return { id: "job-1", data: { documentId: docId(1), run },
          + finishedOn };                                                
      229 +  }                                                           
      230 +                                                              
      231 +  function processingDoc() {                                  
      232 +    const made = makeDeps();                                  
      233 +    const id = seedDocument(made.deps);                       
      234 +    transitionStatus(made.deps.db, id, "processing", { from: "
          +queued", bumpAttempts: true });                               
      235 +    return { ...made, id };                                   
      236 +  }                                                           
      237 +                                                              
      238 +  it("fails a processing document whose job hit the stalled li
          +mit, with a code and an event", () => {                       
      239 +    const { deps, id } = processingDoc();                     
      240 +                                                              
      241 +    expect(handleFinalFailure(failedJob(1), stalledError, deps
          +)).toBe(true);                                                
      242 +                                                              
      243 +    expect(getDocument(deps.db, id)).toMatchObject({          
      244 +      status: "failed",                                       
      245 +      stage: null,                                            
      246 +      error_code: ErrorCode.WORKER_STOPPED,                   
      247 +      error_message: "worker stopped while processing this doc
          +ument twice",                                                 
      248 +    });                                                       
      249 +    expect(listEvents(deps.db, id)).toEqual([                 
      250 +      expect.objectContaining({                               
      251 +        stage: "job",                                         
     … 52 more lines (ctrl+o to expand)
  ⎿  Updated services\worker\src\pipeline\run.ts (+54 -0)
      1  import { UnrecoverableError, type Job } from "bullmq";
      2  import { z } from "zod";
      3 +import { ErrorCode } from "@nexus/shared";                      
      4  import {
      5    ExtractJobPayload,
      6    getDocument,
     ...
      17  // Only what processJob reads, so tests can pass a plain object
           instead of a redis backed Job.
      18  export type ExtractJob = Pick<Job, "id" | "data" | "attemptsMad
          e" | "opts">;
      19  
      20 +// What bullmq hands the worker's failed listener. finishedOn i
         +s only set once the job has failed                             
      21 +// for good; a failure that will be retried doesn't have it.   
      22 +export type FailedJob = Pick<Job, "id" | "data" | "finishedOn">
         +;                                                              
      23 +                                                               
      24 +const STALLED_REASON = "job stalled more than allowable limit";
      25 +                                                               
      26  // The worker writes status itself instead of the api listening
           to queue events: it knows the stage
      27  // and the error code, and the db stays the one source of truth
          .
      28  export async function processJob(job: ExtractJob, deps: WorkerD
          eps): Promise<void> {
     ...
      111    log.info({ needsReview, groundingScore, ...meta }, "document
            completed");
      112  }
      113  
      114 +// Covers the failures processJob never sees. When a worker di
          +es twice while holding a job, bullmq                          
      115 +// fails the job itself before calling the processor, so nothi
          +ng marks the row and it would stay                            
      116 +// "processing" forever: the reconciler only sweeps queued row
          +s.                                                            
      117 +// A no-op unless the row is still processing for this job's r
          +un, so it never overrides what                                
      118 +// processJob wrote and never touches a document that has been
          + retried since.                                               
      119 +// Returns true when it marked the document failed.           
      120 +export function handleFinalFailure(                           
      121 +  job: FailedJob | undefined,                                 
      122 +  err: Error,                                                 
      123 +  deps: Pick<WorkerDeps, "db" | "logger">,                    
      124 +): boolean {                                                  
      125 +  if (job?.finishedOn === undefined) return false;            
      126 +  const payload = ExtractJobPayload.safeParse(job.data);      
      127 +  if (!payload.success) return false;                         
      128 +  const { documentId, run } = payload.data;                   
      129 +                                                              
      130 +  const stalled = err.message.includes(STALLED_REASON);       
      131 +  const code = stalled ? ErrorCode.WORKER_STOPPED : ErrorCode.
          +INTERNAL;                                                     
      132 +  const message = stalled                                     
     … 31 more lines (ctrl+o to expand)
  ⎿  (timeout 5m)

● One failure, and it's a bug in my test: passing undefined to a parameter with
  a default gives the default, so that job looked final. Fixing the test helper.

● Bash(node - <<'EOF'
      const fs = require("fs");…)
  ⎿  services/worker/src/pipeline/run.test.ts(299,11): error TS2375: Type '
     { finishedOn: undefined; id?: string; data: any; }' is not assignable
     to type 'FailedJob' with 'exactOptionalPropertyTypes: true'. Consider
     … +8 lines (ctrl+o to expand)
  ⎿  Updated services\worker\src\pipeline\run.test.ts (+5 -3)
      224  describe("handleFinalFailure", () => {
      225    const stalledError = new UnrecoverableError("job stalled mor
           e than allowable limit");
      226  
      227 -  function failedJob(run: number, finishedOn: number | undefin
          -ed = Date.now()): FailedJob {                                 
      228 -    return { id: "job-1", data: { documentId: docId(1), run },
          - finishedOn };                                                
      227 +  function failedJob(run: number): FailedJob {                
      228 +    return { id: "job-1", data: { documentId: docId(1), run },
          + finishedOn: Date.now() };                                    
      229    }
      230  
      231    function processingDoc() {
     ...
      295    it("changes nothing for a failure bullmq will retry, or with
            no job", () => {
      296      const { deps, id } = processingDoc();
      297  
      298 -    expect(handleFinalFailure(failedJob(1, undefined), new Err
          -or("timeout"), deps)).toBe(false);                            
      298 +    // finishedOn is only set on a final failure.             
      299 +    const willRetry: FailedJob = { ...failedJob(1), finishedOn
          +: undefined };                                                
      300 +    expect(handleFinalFailure(willRetry, new Error("timeout"),
          + deps)).toBe(false);                                          
      301      expect(handleFinalFailure(undefined, stalledError, deps)).
           toBe(false);
      302  
      303      expect(getDocument(deps.db, id)).toMatchObject({ status: "
           processing", error_code: null });
  ⎿  (timeout 5m)

● Bash(node - <<'EOF'
      const fs = require("fs");…)
  ⎿  typecheck exit 0

     > lint
     … +4 lines (ctrl+o to expand)
  ⎿  Updated services\worker\src\pipeline\run.test.ts (+1 -1)
      296      const { deps, id } = processingDoc();
      297  
      298      // finishedOn is only set on a final failure.
      299 -    const willRetry: FailedJob = { ...failedJob(1), finishedOn
          -: undefined };                                                
      299 +    const willRetry: FailedJob = { id: "job-1", data: { docume
          +ntId: docId(1), run: 1 } };                                   
      300      expect(handleFinalFailure(willRetry, new Error("timeout"),
            deps)).toBe(false);
      301      expect(handleFinalFailure(undefined, stalledError, deps)).
           toBe(false);
      302  
  ⎿  (timeout 5m)

● The stuck-in-processing bug is fixed. Typecheck and lint are clean, and npm 
  test passed: 41 files, 439 tests. Everything ran against mocks only; the real
  stalled path through redis was not exercised.

  New error code: none of the existing codes fit, so I added WORKER_STOPPED to
  ErrorCode in packages/shared/src/status.ts. There is no db constraint on
  error_code, and nothing in the code maps the codes exhaustively.

  What changed:
  1. pipeline/run.ts has a new handleFinalFailure(job, err, deps).
     - One transaction: it reads the row, checks it is still processing for this
       job's run, moves it to failed through transitionStatus, and writes an
       error event on stage job.
     - Stalled limit: code WORKER_STOPPED, message "worker stopped while
       processing this document twice".
     - Any other final failure with the row still processing: code INTERNAL,
       message "job failed outside the pipeline: {error}".
  2. index.ts calls it from the worker's failed listener, inside a try/catch so
     a db error there can't become an uncaught exception.

  How it knows a failure is final: it only acts when job.finishedOn is set. I
  read bullmq 6.3.12's source for this:
  - finishedOn is only set when a job fails for good, not when it will be
    retried.
  - A job over the stall limit is failed with an UnrecoverableError before our
    processor is called, and that goes through the same failed event.

  This matters because a row stays processing between retry attempts, and
  marking it failed then would be wrong.

  Tests (5 new):
  - stalled limit on a processing row gives failed with the code and event
  - another final failure gives INTERNAL
  - a stale run changes nothing
  - a row already failed changes nothing
  - a failure that will be retried, or one with no job, changes nothing

  Next: kill the worker twice mid-job on a live run and check the document ends
  up failed with WORKER_STOPPED.

✻ Baked for 3m 41s · done 2:43 AM