# Retrieval eval: hybrid, mock / mock

- search mode: hybrid
- embed provider: mock
- embed model: mock
- dimensions: 64
- date: 2026-10-12
- cpu: AMD Ryzen 5 2600X Six-Core Processor (12 threads)
- corpus: 5 documents, 89 chunks (1 flagged as prompt injection and not searchable)
- questions: 11, top 10 results each

## Questions

| id | question | expected | rank | top result (score) | latency |
| --- | --- | --- | --- | --- | --- |
| msa-work-product | vendor owns work product nexus paid for | master-services-agreement.pdf p12 | 4 | master-services-agreement.pdf p5 (0.032) | 7ms |
| msa-vendor-exit | can the vendor walk away from the agreement without a reason | master-services-agreement.pdf p11 | miss | master-services-agreement.pdf p9-10 (0.030) | 4ms |
| msa-insurance | what insurance does the vendor have to carry | master-services-agreement.pdf p9 | miss | master-services-agreement.pdf p3 (0.031) | 4ms |
| saas-fee-increase | fee increase on renewal | saas-subscription.pdf p1 | 1 | saas-subscription.pdf p1-2 (0.031) | 3ms |
| saas-renewal-notice | how much notice to stop the subscription from renewing | saas-subscription.pdf p1 | 2 | master-services-agreement.pdf p10-11 (0.030) | 4ms |
| saas-liability-cap | what is the most the software vendor can be made to pay i... | saas-subscription.pdf p2 | miss | hardware-supply.pdf p2 (0.029) | 4ms |
| hardware-late-payment | late payment charge | hardware-supply.pdf p2 | 1 | hardware-supply.pdf p2 (0.033) | 1ms |
| hardware-exclusivity | are we allowed to buy the component from another supplier | hardware-supply.pdf p2 | 2 | hardware-supply.pdf p2-3 (0.032) | 2ms |
| hardware-warranty | how long are the products guaranteed against defects | hardware-supply.pdf p3 | miss | master-services-agreement.pdf p15 (0.031) | 2ms |
| sow-expenses | are travel costs billed on top of the consulting fee | consulting-sow.docx | 2 | master-services-agreement.pdf p7-8 (0.032) | 2ms |
| nda-governing-law | which law governs the confidentiality agreement | mutual-nda.docx | 5 | hardware-supply.pdf p4 (0.031) | 2ms |

A result counts when it is from the expected document and contains the expected quote.

## Totals

- recall@3: 5/11 (45%)
- recall@5: 7/11 (64%)
- MRR: 0.359
- query latency: p50 3ms, max 7ms (embedding the question plus the search)
- indexing: 22ms for 89 chunks

## Misses

- msa-vendor-exit: expected master-services-agreement.pdf p11. Returned instead:
  1. master-services-agreement.pdf p9-10 (0.030): 21.2 Vendor shall tell Customer in writing about any claim for which it seeks to be ind...
  2. master-services-agreement.pdf p3-4 (0.030): 6.3 Vendor shall carry out the background checks on Vendor Personnel that are lawful in...
  3. master-services-agreement.pdf p2-3 (0.029): 4.2 Vendor shall provide the Services from its own delivery centres and, where a Statem...
- msa-insurance: expected master-services-agreement.pdf p9. Returned instead:
  1. master-services-agreement.pdf p3 (0.031): 5.2 Vendor shall meet or exceed the service levels set out in Schedule C. Vendor shall ...
  2. master-services-agreement.pdf p3 (0.029): measure the satisfaction of the customers of Customer with the support desk by means of...
  3. master-services-agreement.pdf p3-4 (0.029): 6.3 Vendor shall carry out the background checks on Vendor Personnel that are lawful in...
- saas-liability-cap: expected saas-subscription.pdf p2. Returned instead:
  1. hardware-supply.pdf p2 (0.029): 4. Price 4.1 The total price for the Products to be supplied during the Term is USD 1,2...
  2. master-services-agreement.pdf p3-4 (0.028): 6.3 Vendor shall carry out the background checks on Vendor Personnel that are lawful in...
  3. hardware-supply.pdf p2-3 (0.028): 6.2 This clause applies to the Component only. Customer remains free to buy all other g...
- hardware-warranty: expected hardware-supply.pdf p3. Returned instead:
  1. master-services-agreement.pdf p15 (0.031): A.3 Platform Operations Vendor shall monitor and operate the production environments th...
  2. master-services-agreement.pdf p15-16 (0.029): and correcting defects, making minor enhancements that Customer requests through the ch...
  3. master-services-agreement.pdf p11 (0.029): 25.3 Vendor shall provide exit assistance for up to six months after the end date if Cu...

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
