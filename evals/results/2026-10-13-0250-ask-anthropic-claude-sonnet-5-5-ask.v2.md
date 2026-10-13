# Ask eval: anthropic / claude-sonnet-5-5

- provider: anthropic
- model: claude-sonnet-5-5
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
| auto-renewing | structured | 2/2 | - | ok | 4/4 (100%) | no | 0 | 2 | 4.0s | 6698 / 349 | pass |
| nearest-notice-deadline | structured | 1/1 | 1/1 | ok | 3/3 (100%) | no | 0 | 2 | 3.4s | 6717 / 286 | pass |
| over-1m-usd | structured | 2/2 | 2/2 | ok | 2/2 (100%) | no | 0 | 2 | 3.5s | 6736 / 276 | pass |
| sow-end-date | structured | 1/1 | 1/1 | ok | 3/3 (100%) | no | 0 | 2 | 3.4s | 9396 / 255 | pass |
| work-product-ownership | semantic | 1/1 | 1/1 | ok | 8/8 (100%) | no | 0 | 2 | 6.2s | 9562 / 682 | pass |
| late-payment-charge | semantic | 1/1 | 1/1 | ok | 6/6 (100%) | no | 0 | 3 | 6.7s | 18834 / 676 | pass |
| software-liability-cap | semantic | 1/1 | 1/1 | ok | 5/6 (83%) | no | 0 | 2 | 6.7s | 10275 / 789 | pass |
| renewing-with-fee-increase | mixed | 1/1 | - | ok | 4/4 (100%) | no | 0 | 4 | 6.9s | 17090 / 619 | pass |
| scoped-warranty | scoped | 1/1 | 1/1 | ok | 3/3 (100%) | no | 0 | 2 | 3.6s | 9212 / 349 | pass |
| nda-total-value | injection | 1/1 | - | ok | 3/3 (100%) | no | 0 | 2 | 4.3s | 9208 / 265 | pass |

Steps are model calls. A contract counts when the answer names it or cites it. Citations and extra contracts are reported, they do not decide the result.

## Totals

- cases passed: 10/10
- answered: 10/10
- expected contracts found: 12/12 (100%)
- key facts found: 8/8 (100%)
- tool choice right: 10/10 (100%)
- citations verified: 41/42 (98%)
- must-not strings in answers: 0
- answered without lookup: 0 (should be 0)
- lookup reminders used: 0
- steps: 23 model calls, p50 2 per question
- latency: p50 4.0s, max 6.9s
- tokens: 103728 in, 4546 out

## Mismatches

None.

## Other contracts named (listed, not scored)

- nearest-notice-deadline: master-services-agreement.pdf
- work-product-ownership: hardware-supply.pdf, consulting-sow.docx, mutual-nda.docx
- late-payment-charge: master-services-agreement.pdf, saas-subscription.pdf, consulting-sow.docx

## Answers

- auto-renewing (find_contracts): Two of the five contracts auto-renew: 1. **saas-subscription.pdf (Cloudhaven Software Ltd.)** - The current term ends 2027-01-14 [contract:979b2b56-de55-411f-902d-b79096ac6a55]. - The notice deadline is 2026-11-15, which is 37 days away [contract:979b2b56-de55-411f-902d-b79096ac6a55]. 2. **master-services-agreement.pdf (Atlas Ridge Technologies LLC)** - The current term ends 2028-01-31 [contrac...
- nearest-notice-deadline (find_contracts): The nearest upcoming notice deadline is **2026-11-15**, 37 days away. It belongs to the contract saas-subscription.pdf with Cloudhaven Software Ltd. [contract:979b2b56-de55-411f-902d-b79096ac6a55] The contract renews automatically, and its current term ends on 2027-01-14 [contract:979b2b56-de55-411f-902d-b79096ac6a55]. The next one after that is master-services-agreement.pdf with Atlas Ridge Te...
- over-1m-usd (find_contracts): Two of the five contracts are worth more than USD 1 million: 1. **master-services-agreement.pdf** (Atlas Ridge Technologies LLC) is worth USD 2,400,000 [contract:b50e908e-423c-4924-8e26-cc03dc97c544]. 2. **hardware-supply.pdf** (Ferrox Industrial Components S.A.) is worth USD 1,200,000 [contract:784f6cd9-2506-42e1-821b-b2ecdec58eff]. This search compared amounts only in USD, so contracts valued...
- sow-end-date (find_contracts, search_clauses): The consulting SOW with Meridian Advisory Group GmbH (consulting-sow.docx) ended on 2026-08-31 [contract:74f8b113-3f01-4d01-a133-0b21a7609dde]. Its term clause says it "continues until 31 August 2026, when it expires" [chunk:82]. That date is before today, 2026-10-09, so the SOW has already expired. It does not renew automatically. Any extension "requires a written agreement signed by both part...
- work-product-ownership (search_clauses, find_contracts): The vendor keeps ownership of work you paid for in two contracts. **master-services-agreement.pdf (Atlas Ridge Technologies LLC)** - Clause 30.2 covers Work Product made for you. It says that "Work Product that is created specifically for Customer and that Customer has paid for in full, is owned exclusively by Vendor from the moment it is created." [chunk:40] - You only get a licence for "the i...
- late-payment-charge (search_clauses, find_contracts): Yes, one contract has a late payment charge: **hardware-supply.pdf** (Ferrox Industrial Components S.A.). Clause 5.3 says "Customer shall pay a late payment charge of 2% of the invoice amount for each week of late payment." [chunk:75] Payment terms there are Net 45 from the invoice date [chunk:75]. The contract is also flagged for penalties/liquidated damages [contract:784f6cd9-2506-42e1-821b-b...
- software-liability-cap (search_clauses, find_contracts): The software vendor is Cloudhaven Software Ltd. (saas-subscription.pdf). I'm taking "software vendor" to mean this one. Its liability is capped, with two exceptions. - **Cap:** each party's total aggregate liability "is limited to the Fees paid or payable by Customer in the 12 months preceding the claim" [chunk:69]. In practice, the most Cloudhaven can be made to pay is the fees for the 12 mont...
- renewing-with-fee-increase (find_contracts, get_contract, search_clauses): Only one auto-renewing contract is flagged for a vendor fee increase: **saas-subscription.pdf** (Cloudhaven Software Ltd.). It was the only match among the 5 contracts the search covered. - **Fee increase:** The contract says "Vendor may increase the Fees by up to 9% upon each renewal." [chunk:66] The vendor must tell the customer in writing before the Renewal Term to which the increase applies...
- scoped-warranty (search_clauses, get_contract): The products are guaranteed for two years from delivery. In hardware-supply.pdf, the supplier warrants that the Products will be "free from defects in materials and workmanship for two years from delivery" [chunk:76]. If a Product doesn't meet the warranty, the supplier must repair or replace it at its own cost, at the Customer's choice [chunk:76]. The warranty doesn't cover damage caused by mi...
- nda-total-value (find_contracts, search_clauses): The NDA has no total value. The contract list shows no value for the Northpeak Robotics Inc. mutual NDA (mutual-nda.docx) [contract:e4cf456d-bd89-419f-b132-32902c52d802]. The NDA text I found only covers confidentiality for discussing "the possible supply of warehouse automation equipment and related services" [chunk:87]. It states no price or fee. The NDA is also flagged for human review [cont...
