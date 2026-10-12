# Retrieval eval: openai / text-embedding-3-small

- embed provider: openai
- embed model: text-embedding-3-small
- dimensions: 1536
- date: 2026-10-12
- cpu: AMD Ryzen 5 2600X Six-Core Processor (12 threads)
- corpus: 5 documents, 89 chunks (1 flagged as prompt injection and not searchable)
- questions: 11, top 10 results each

## Questions

| id | question | expected | rank | top result (score) | latency |
| --- | --- | --- | --- | --- | --- |
| msa-work-product | vendor owns work product nexus paid for | master-services-agreement.pdf p12 | 1 | master-services-agreement.pdf p12 (0.461) | 189ms |
| msa-vendor-exit | can the vendor walk away from the agreement without a reason | master-services-agreement.pdf p11 | 2 | master-services-agreement.pdf p10 (0.549) | 200ms |
| msa-insurance | what insurance does the vendor have to carry | master-services-agreement.pdf p9 | 2 | master-services-agreement.pdf p9 (0.609) | 195ms |
| saas-fee-increase | fee increase on renewal | saas-subscription.pdf p1 | 1 | saas-subscription.pdf p1 (0.397) | 172ms |
| saas-renewal-notice | how much notice to stop the subscription from renewing | saas-subscription.pdf p1 | 1 | saas-subscription.pdf p1 (0.376) | 171ms |
| saas-liability-cap | what is the most the software vendor can be made to pay i... | saas-subscription.pdf p2 | 4 | master-services-agreement.pdf p12 (0.504) | 163ms |
| hardware-late-payment | late payment charge | hardware-supply.pdf p2 | miss | saas-subscription.pdf p2 (0.296) | 165ms |
| hardware-exclusivity | are we allowed to buy the component from another supplier | hardware-supply.pdf p2 | 1 | hardware-supply.pdf p2 (0.499) | 192ms |
| hardware-warranty | how long are the products guaranteed against defects | hardware-supply.pdf p3 | 1 | hardware-supply.pdf p2 (0.506) | 196ms |
| sow-expenses | are travel costs billed on top of the consulting fee | consulting-sow.docx | 1 | consulting-sow.docx (0.518) | 164ms |
| nda-governing-law | which law governs the confidentiality agreement | mutual-nda.docx | 5 | consulting-sow.docx (0.499) | 141ms |

A result counts when it is from the expected document and contains the expected quote.

## Totals

- recall@3: 8/11 (73%)
- recall@5: 10/11 (91%)
- MRR: 0.677
- query latency: p50 172ms, max 200ms (embedding the question plus the search)
- indexing: 4.6s for 89 chunks

## Misses

- hardware-late-payment: expected hardware-supply.pdf p2. Returned instead:
  1. saas-subscription.pdf p2 (0.296): Information to its employees, Affiliates and professional advisers who need to know it,...
  2. master-services-agreement.pdf p17 (0.295): Vendor shall document the problem register and the analysis for each closed problem, sh...
  3. hardware-supply.pdf p3 (0.278): 10. Liability 10.1 Each party's total aggregate liability arising out of or in connecti...

## Chunk coverage

Characters that are not whitespace. Covered is what at least one chunk holds, so 100% means chunking dropped nothing.

| document | pages | chunks | flagged | parsed chars | chunk chars | overlap | covered | coverage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| master-services-agreement.pdf | 22 | 64 | 0 | 51403 | 59336 | 7933 | 51403 | 100.0% |
| saas-subscription.pdf | 3 | 8 | 0 | 6557 | 7121 | 564 | 6557 | 100.0% |
| hardware-supply.pdf | 4 | 8 | 0 | 6678 | 7317 | 639 | 6678 | 100.0% |
| consulting-sow.docx | - | 6 | 0 | 4988 | 5415 | 427 | 4988 | 100.0% |
| mutual-nda.docx | - | 3 | 1 | 2265 | 2340 | 75 | 2265 | 100.0% |

No text is missing from the chunks.
