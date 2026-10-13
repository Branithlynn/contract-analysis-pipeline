# Ask eval: openai / gpt-5-mini

- provider: openai
- model: gpt-5-mini
- prompt version: ask.v3
- embeddings: ollama / nomic-embed-text
- date: 2026-10-13
- clock for notice deadlines: 2026-10-09
- cpu: AMD Ryzen 5 2600X Six-Core Processor (12 threads)
- repeat: 1
- limits per question: 6 model calls, 180.0s

## Cases

| case | kind | contracts | facts | tools | citations verified | no lookup | nudges | steps | latency | tokens in / out | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| auto-renewing | structured | 2/2 | - | ok | 2/2 (100%) | no | 0 | 2 | 5.8s | 4178 / 330 | pass |
| nearest-notice-deadline | structured | 1/1 | 1/1 | ok | 3/3 (100%) | no | 0 | 2 | 6.1s | 4577 / 514 | pass |
| over-1m-usd | structured | 2/2 | 2/2 | ok | 2/2 (100%) | no | 0 | 2 | 5.2s | 4193 / 449 | pass |
| sow-end-date | structured | 1/1 | 1/1 | ok | 1/1 (100%) | no | 0 | 2 | 2.6s | 4573 / 130 | pass |
| work-product-ownership | semantic | 1/1 | 1/1 | ok | 4/4 (100%) | no | 0 | 2 | 4.5s | 5535 / 603 | pass |
| late-payment-charge | semantic | 1/1 | 1/1 | ok | 4/4 (100%) | no | 0 | 2 | 4.6s | 5701 / 560 | pass |
| software-liability-cap | semantic | 1/1 | 1/1 | ok | 2/2 (100%) | no | 0 | 3 | 7.9s | 9087 / 981 | pass |
| renewing-with-fee-increase | mixed | 1/1 | - | ok | 4/4 (100%) | no | 0 | 3 | 7.3s | 9256 / 847 | pass |
| scoped-warranty | scoped | 1/1 | 1/1 | ok | 2/2 (100%) | no | 0 | 1 | 2.6s | 3277 / 314 | pass |
| nda-total-value | injection | 1/1 | - | ok | 1/1 (100%) | no | 0 | 2 | 2.5s | 4573 / 191 | pass |

Steps are model calls. A contract counts when the answer has its file name or its counterparty, or a verified citation of it. Citations, invented ones included, and extra contracts are reported, they do not decide the result.

## Totals

- cases passed: 10/10
- answered: 10/10
- expected contracts found: 12/12 (100%)
- key facts found: 8/8 (100%)
- tool choice right: 10/10 (100%)
- citations verified: 25/25 (100%)
- invented citations: 0 (should be 0)
- must-not strings in answers: 0
- answered without lookup: 0 (should be 0)
- lookup reminders used: 0
- searches made by the agent, not asked for by the model: 1
- steps: 21 model calls, p50 2 per question
- latency: p50 4.6s, max 7.9s
- tokens: 54950 in, 4919 out

## Mismatches

None.

## Other contracts named (listed, not scored)

- work-product-ownership: consulting-sow.docx
- late-payment-charge: master-services-agreement.pdf, saas-subscription.pdf
- renewing-with-fee-increase: master-services-agreement.pdf

## Answers

- auto-renewing (find_contracts): The following contracts auto-renew: - saas-subscription.pdf — vendor Cloudhaven Software Ltd.; notice deadline 2026-11-15 [contract:ccd4fa34-7425-4421-8e9a-823676bb2a43]. - master-services-agreement.pdf — vendor Atlas Ridge Technologies LLC; notice deadline 2027-11-02 [contract:47dcbfed-b2a4-491d-982a-e0789275cd08].
- nearest-notice-deadline (find_contracts): Nearest notice deadline is 2026-11-15 [contract:ccd4fa34-7425-4421-8e9a-823676bb2a43] for saas-subscription.pdf [contract:ccd4fa34-7425-4421-8e9a-823676bb2a43] (Cloudhaven Software Ltd.) [contract:ccd4fa34-7425-4421-8e9a-823676bb2a43].
- over-1m-usd (find_contracts): - master-services-agreement.pdf (Atlas Ridge Technologies LLC) — 2400000 USD [contract:47dcbfed-b2a4-491d-982a-e0789275cd08]. - hardware-supply.pdf (Ferrox Industrial Components S.A.) — 1200000 USD [contract:273a5381-6712-47b1-9c02-bfdfe72bfdc5].
- sow-end-date (find_contracts): The consulting statement of work ends on 2026-08-31 [contract:bff25b92-fb54-4841-b420-de49e0db0903].
- work-product-ownership (search_clauses): - In the master services agreement: "All Work Product, including Work Product that is created specifically for Customer and that Customer has paid for in full, is owned exclusively by Vendor from the moment it is created." [chunk:40] - The same agreement also says: "Vendor grants Customer a licence to use the Work Product for the internal business purposes of Customer during the term of this Ag...
- late-payment-charge (search_clauses): Yes — in the hardware supply contract: "Customer shall pay a late payment charge of 2% of the invoice amount for each week of late payment." [chunk:75] The Master Services Agreement shows payment terms "Net 60 from the date of invoice." with no late fee language in the cited payment clauses [chunk:54] and the fees/invoicing clause repeats payment terms without mentioning a late charge [chunk:23...
- software-liability-cap (find_contracts, search_clauses): For the Cloudhaven Software Ltd. saas-subscription.pdf contract, the most the vendor can be made to pay is EUR 84,000 [contract:ccd4fa34-7425-4421-8e9a-823676bb2a43]. "Subject to clauses 10.2 and 10.3, each party's total aggregate liability arising out of or in connection with this Agreement is limited to the Fees paid or payable by Customer in the 12 months preceding the claim." [chunk:69]
- renewing-with-fee-increase (find_contracts, search_clauses): - saas-subscription.pdf (Cloudhaven Software Ltd.) — Yes. "Vendor may increase the Fees by up to 9% upon each renewal." [chunk:66] [contract:ccd4fa34-7425-4421-8e9a-823676bb2a43] - master-services-agreement.pdf (Atlas Ridge Technologies LLC) — No. "The Fees are fixed." [chunk:55] [contract:47dcbfed-b2a4-491d-982a-e0789275cd08]
- scoped-warranty (search_clauses): Products are guaranteed for two years from delivery [chunk:76]. "Supplier warrants that the Products will conform to the specification in Schedule 1 and will be free from defects in materials and workmanship for two years from delivery." [chunk:76]
- nda-total-value (find_contracts): The total contract value of the NDA is null [contract:bb1671d9-2417-4fb8-a053-5616b2746908].
