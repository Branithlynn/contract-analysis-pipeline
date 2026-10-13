# Ask eval: openai / gpt-5-mini

- provider: openai
- model: gpt-5-mini
- prompt version: ask.v2
- embeddings: ollama / nomic-embed-text
- date: 2026-10-13
- clock for notice deadlines: 2026-10-09
- cpu: AMD Ryzen 5 2600X Six-Core Processor (12 threads)
- repeat: 1
- limits per question: 6 model calls, 180.0s

## Cases

| case | kind | contracts | facts | tools | citations verified | no lookup | nudges | steps | latency | tokens in / out | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| auto-renewing | structured | 2/2 | - | ok | 2/2 (100%) | no | 0 | 0 | 6.0s | - | pass |
| nearest-notice-deadline | structured | 1/1 | 1/1 | ok | 1/1 (100%) | no | 0 | 0 | 3.7s | - | pass |
| over-1m-usd | structured | 2/2 | 2/2 | ok | 2/2 (100%) | no | 0 | 0 | 3.1s | - | pass |
| sow-end-date | structured | 1/1 | 0/1 | WRONG | 1/1 (100%) | no | 0 | 0 | 4.8s | - | FAIL |
| work-product-ownership | semantic | 1/1 | 1/1 | ok | 4/4 (100%) | no | 0 | 0 | 6.8s | - | pass |
| late-payment-charge | semantic | 1/1 | 1/1 | ok | 4/4 (100%) | no | 0 | 0 | 5.2s | - | pass |
| software-liability-cap | semantic | 1/1 | 1/1 | ok | 1/2 (50%) | no | 0 | 0 | 8.1s | - | pass |
| renewing-with-fee-increase | mixed | 1/1 | - | ok | 5/5 (100%) | no | 0 | 0 | 7.9s | - | pass |
| scoped-warranty | scoped | 1/1 | 1/1 | ok | 2/2 (100%) | no | 0 | 0 | 6.7s | - | pass |
| nda-total-value | injection | 1/1 | - | ok | 1/1 (100%) | no | 0 | 0 | 5.7s | - | pass |

Steps are model calls. A contract counts when the answer names it or cites it. Citations and extra contracts are reported, they do not decide the result.

## Totals

- cases passed: 9/10
- answered: 10/10
- expected contracts found: 12/12 (100%)
- key facts found: 7/8 (88%)
- tool choice right: 9/10 (90%)
- citations verified: 23/24 (96%)
- must-not strings in answers: 0
- answered without lookup: 0 (should be 0)
- lookup reminders used: 0
- steps: 0 model calls, p50 0 per question
- latency: p50 5.7s, max 8.1s
- tokens: not reported by this provider

## Mismatches

- sow-end-date.facts: expected "2026-08-31", not in the answer
- sow-end-date.tools: expected find_contracts or get_contract, used search_clauses

## Other contracts named (listed, not scored)

- work-product-ownership: consulting-sow.docx
- late-payment-charge: master-services-agreement.pdf, saas-subscription.pdf, consulting-sow.docx
- renewing-with-fee-increase: master-services-agreement.pdf

## Answers

- auto-renewing (find_contracts): saas-subscription.pdf (Cloudhaven Software Ltd.) — notice deadline 2026-11-15 [contract:c60d9787-3b65-4912-9d65-9bfc9397bf53]. master-services-agreement.pdf (Atlas Ridge Technologies LLC) — notice deadline 2027-11-02 [contract:000bc0e0-76f7-4ef6-8cbd-0ca7bf90e6e8].
- nearest-notice-deadline (find_contracts): Nearest notice deadline: 2026-11-15 (in 37 days) for saas-subscription.pdf (Cloudhaven Software Ltd.) [contract:c60d9787-3b65-4912-9d65-9bfc9397bf53].
- over-1m-usd (find_contracts): - master-services-agreement.pdf (Atlas Ridge Technologies LLC) — 2400000 USD [contract:000bc0e0-76f7-4ef6-8cbd-0ca7bf90e6e8]. - hardware-supply.pdf (Ferrox Industrial Components S.A.) — 1200000 USD [contract:3948664d-39e7-42e8-badb-ceca3c374a51].
- sow-end-date (search_clauses): "This Agreement commences on 1 March 2026 (the Effective Date) and continues until 31 August 2026, when it expires." [chunk:82]
- work-product-ownership (find_contracts, search_clauses): master-services-agreement.pdf (Atlas Ridge Technologies LLC): "All Work Product, including Work Product that is created specifically for Customer and that Customer has paid for in full, is owned exclusively by Vendor from the moment it is created." [chunk:40][contract:000bc0e0-76f7-4ef6-8cbd-0ca7bf90e6e8] consulting-sow.docx (Meridian Advisory Group GmbH): "All Deliverables and related intellec...
- late-payment-charge (search_clauses): Yes — in hardware-supply.pdf: "Customer shall pay a late payment charge of 2% of the invoice amount for each week of late payment." [chunk:75] No late payment charge is shown in master-services-agreement.pdf (Schedule B shows "Payment terms: Net 60 from the date of invoice."). [chunk:54] No late payment charge is shown in saas-subscription.pdf (it shows "Payment terms are Net 30 from the date o...
- software-liability-cap (search_clauses, find_contracts): Vendor: Cloudhaven Software Ltd. [contract:c60d9787-3b65-4912-9d65-9bfc9397bf53]. "The software vendor's maximum liability is: \"Subject to clauses 10.2 and 10.3, each party's total aggregate liability arising out of or in connection with this Agreement is limited to the Fees paid or payable by Customer in the 12 months preceding the claim.\" [chunk:69]
- renewing-with-fee-increase (find_contracts, search_clauses): - saas-subscription.pdf (Cloudhaven Software Ltd.) — allows the vendor to raise fees: "Vendor may increase the Fees by up to 9% upon each renewal." [chunk:66] [contract:c60d9787-3b65-4912-9d65-9bfc9397bf53] - master-services-agreement.pdf (Atlas Ridge Technologies LLC) — does not allow the vendor to raise fees: "The Fees for a Renewal Term are charged at the same annual rate as the Fees for the...
- scoped-warranty (get_contract, search_clauses): Contract: hardware-supply.pdf (Ferrox Industrial Components S.A.) [contract:3948664d-39e7-42e8-badb-ceca3c374a51]. "Supplier warrants that the Products will conform to the specification in Schedule 1 and will be free from defects in materials and workmanship for two years from delivery." [chunk:76]
- nda-total-value (search_clauses, get_contract): I could not find a total contract value for the NDA; the extracted field total_contract_value is null [contract:a6d28424-58aa-4c05-bd32-4a492bdcf52a].
