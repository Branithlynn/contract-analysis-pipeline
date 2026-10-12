# Retrieval eval: keyword, mock / mock

- search mode: keyword
- embed provider: mock
- embed model: mock
- dimensions: -
- date: 2026-10-12
- cpu: AMD Ryzen 5 2600X Six-Core Processor (12 threads)
- corpus: 5 documents, 89 chunks (1 flagged as prompt injection and not searchable)
- questions: 11, top 10 results each

## Questions

| id | question | expected | rank | top result (score) | latency |
| --- | --- | --- | --- | --- | --- |
| msa-work-product | vendor owns work product nexus paid for | master-services-agreement.pdf p12 | 1 | master-services-agreement.pdf p12 (6.342) | 5ms |
| msa-vendor-exit | can the vendor walk away from the agreement without a reason | master-services-agreement.pdf p11 | miss | master-services-agreement.pdf p3-4 (4.465) | 2ms |
| msa-insurance | what insurance does the vendor have to carry | master-services-agreement.pdf p9 | 3 | master-services-agreement.pdf p3 (7.471) | 2ms |
| saas-fee-increase | fee increase on renewal | saas-subscription.pdf p1 | 1 | saas-subscription.pdf p1-2 (10.085) | 1ms |
| saas-renewal-notice | how much notice to stop the subscription from renewing | saas-subscription.pdf p1 | 1 | saas-subscription.pdf p1 (9.292) | 1ms |
| saas-liability-cap | what is the most the software vendor can be made to pay i... | saas-subscription.pdf p2 | miss | hardware-supply.pdf p2 (5.593) | 2ms |
| hardware-late-payment | late payment charge | hardware-supply.pdf p2 | 1 | hardware-supply.pdf p2 (12.409) | 1ms |
| hardware-exclusivity | are we allowed to buy the component from another supplier | hardware-supply.pdf p2 | 1 | hardware-supply.pdf p2 (12.357) | 2ms |
| hardware-warranty | how long are the products guaranteed against defects | hardware-supply.pdf p3 | 5 | master-services-agreement.pdf p15-16 (6.539) | 1ms |
| sow-expenses | are travel costs billed on top of the consulting fee | consulting-sow.docx | 2 | master-services-agreement.pdf p7-8 (10.224) | 1ms |
| nda-governing-law | which law governs the confidentiality agreement | mutual-nda.docx | 2 | master-services-agreement.pdf p13-15 (4.483) | 1ms |

A result counts when it is from the expected document and contains the expected quote.

## Totals

- recall@3: 8/11 (73%)
- recall@5: 9/11 (82%)
- MRR: 0.594
- query latency: p50 1ms, max 5ms (embedding the question plus the search)
- indexing: 24ms for 89 chunks

## Misses

- msa-vendor-exit: expected master-services-agreement.pdf p11. Returned instead:
  1. master-services-agreement.pdf p3-4 (4.465): 6.3 Vendor shall carry out the background checks on Vendor Personnel that are lawful in...
  2. master-services-agreement.pdf p7-8 (4.458): 15. Expenses 15.1 The Fees include all of the costs that Vendor incurs in providing the...
  3. master-services-agreement.pdf p9-10 (4.333): 21.2 Vendor shall tell Customer in writing about any claim for which it seeks to be ind...
- saas-liability-cap: expected saas-subscription.pdf p2. Returned instead:
  1. hardware-supply.pdf p2 (5.593): 4. Price 4.1 The total price for the Products to be supplied during the Term is USD 1,2...
  2. master-services-agreement.pdf p8 (5.295): 18.2 Vendor warrants that the Services will be performed in a professional manner by pe...
  3. saas-subscription.pdf p1 (4.991): Software as a Service Subscription Agreement Parties This Software as a Service Subscri...

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
