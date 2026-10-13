# Ask eval: anthropic / claude-sonnet-5-5

- provider: anthropic
- model: claude-sonnet-5-5
- prompt version: ask.v3
- embeddings: ollama / nomic-embed-text
- date: 2026-10-13
- clock for notice deadlines: 2026-10-09
- cpu: AMD Ryzen 5 2600X Six-Core Processor (12 threads)
- repeat: 1
- limits per question: 6 model calls, 180.0s

Only 1 of 10 cases were asked (--cases scoped-warranty): scoped-warranty. The totals are not those of a full run.

## Cases

| case | kind | contracts | facts | tools | citations verified | no lookup | nudges | steps | latency | tokens in / out | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| scoped-warranty | scoped | 1/1 | 1/1 | ok | 3/3 (100%) | no | 0 | 1 | 2.3s | 5460 / 190 | pass |

Steps are model calls. A contract counts when the answer has its file name or its counterparty, or a verified citation of it. Citations, invented ones included, and extra contracts are reported, they do not decide the result.

## Totals

- cases passed: 1/1
- answered: 1/1
- expected contracts found: 1/1 (100%)
- key facts found: 1/1 (100%)
- tool choice right: 1/1 (100%)
- citations verified: 3/3 (100%)
- invented citations: 0 (should be 0)
- must-not strings in answers: 0
- answered without lookup: 0 (should be 0)
- lookup reminders used: 0
- searches made by the agent, not asked for by the model: 1
- steps: 1 model calls, p50 1 per question
- latency: p50 2.3s, max 2.3s
- tokens: 5460 in, 190 out

## Mismatches

None.

## Other contracts named (listed, not scored)

None.

## Answers

- scoped-warranty (search_clauses): The products are guaranteed for two years from delivery. Clause 8.1 of hardware-supply.pdf says the Supplier "warrants that the Products will conform to the specification in Schedule 1 and will be free from defects in materials and workmanship for two years from delivery" [chunk:76]. If a Product fails the warranty, the Supplier must repair or replace it at its own cost, and the Customer choose...
