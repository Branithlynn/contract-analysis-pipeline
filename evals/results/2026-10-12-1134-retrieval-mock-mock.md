# Retrieval eval: mock / mock

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
| msa-work-product | vendor owns work product nexus paid for | master-services-agreement.pdf p12 | miss | master-services-agreement.pdf p4 (0.450) | 4ms |
| msa-vendor-exit | can the vendor walk away from the agreement without a reason | master-services-agreement.pdf p11 | miss | hardware-supply.pdf p1 (0.706) | 1ms |
| msa-insurance | what insurance does the vendor have to carry | master-services-agreement.pdf p9 | miss | master-services-agreement.pdf p19 (0.530) | 1ms |
| saas-fee-increase | fee increase on renewal | saas-subscription.pdf p1 | 9 | master-services-agreement.pdf p13 (0.110) | 1ms |
| saas-renewal-notice | how much notice to stop the subscription from renewing | saas-subscription.pdf p1 | miss | hardware-supply.pdf p2 (0.469) | 1ms |
| saas-liability-cap | what is the most the software vendor can be made to pay i... | saas-subscription.pdf p2 | miss | master-services-agreement.pdf p17 (0.632) | 1ms |
| hardware-late-payment | late payment charge | hardware-supply.pdf p2 | 1 | hardware-supply.pdf p2 (0.184) | 2ms |
| hardware-exclusivity | are we allowed to buy the component from another supplier | hardware-supply.pdf p2 | 4 | consulting-sow.docx (0.534) | 1ms |
| hardware-warranty | how long are the products guaranteed against defects | hardware-supply.pdf p3 | miss | master-services-agreement.pdf p4 (0.495) | 1ms |
| sow-expenses | are travel costs billed on top of the consulting fee | consulting-sow.docx | 6 | master-services-agreement.pdf p2 (0.560) | 1ms |
| nda-governing-law | which law governs the confidentiality agreement | mutual-nda.docx | miss | master-services-agreement.pdf p13 (0.374) | 1ms |

A result counts when it is from the expected document and contains the expected quote.

## Totals

- recall@3: 1/11 (9%)
- recall@5: 2/11 (18%)
- MRR: 0.139
- query latency: p50 1ms, max 4ms (embedding the question plus the search)
- indexing: 24ms for 89 chunks

## Misses

- msa-work-product: expected master-services-agreement.pdf p12. Returned instead:
  1. master-services-agreement.pdf p4 (0.450): 7.6 Vendor shall tell Customer as soon as it learns that one of the Key Personnel inten...
  2. master-services-agreement.pdf p11 (0.448): 25.3 Vendor shall provide exit assistance for up to six months after the end date if Cu...
  3. master-services-agreement.pdf p5 (0.427): 8.5 Customer shall make sure that its own staff who work with Vendor are available for ...
- msa-vendor-exit: expected master-services-agreement.pdf p11. Returned instead:
  1. hardware-supply.pdf p1 (0.706): Hardware Supply Agreement Parties This Hardware Supply Agreement (the Agreement) is mad...
  2. saas-subscription.pdf p1 (0.665): Software as a Service Subscription Agreement Parties This Software as a Service Subscri...
  3. master-services-agreement.pdf p8 (0.653): 16.2 Vendor shall keep those records for six years after the end of the year to which t...
- msa-insurance: expected master-services-agreement.pdf p9. Returned instead:
  1. master-services-agreement.pdf p19 (0.530): The priority of an incident is set by Vendor when the incident is logged. Customer may ...
  2. master-services-agreement.pdf p16 (0.523): The Test Lead appointed by Vendor is the point of contact for this tower, attends the m...
  3. saas-subscription.pdf p1 (0.521): 4.2 The Fees are exclusive of value added tax and similar taxes, which Customer shall p...
- saas-fee-increase: found at rank 9, outside the top 5
- saas-renewal-notice: expected saas-subscription.pdf p1. Returned instead:
  1. hardware-supply.pdf p2 (0.469): 6.2 This clause applies to the Component only. Customer remains free to buy all other g...
  2. saas-subscription.pdf p3 (0.452): 12.2 The affected party shall notify the other party promptly and shall use reasonable ...
  3. hardware-supply.pdf p4 (0.436): to the extent that the delay or failure results from events beyond its reasonable contr...
- saas-liability-cap: expected saas-subscription.pdf p2. Returned instead:
  1. master-services-agreement.pdf p17 (0.632): Vendor shall document the problem register and the analysis for each closed problem, sh...
  2. master-services-agreement.pdf p16 (0.612): Vendor shall document the release calendar and the deployment checklists, shall keep th...
  3. master-services-agreement.pdf p16 (0.604): The Test Lead appointed by Vendor is the point of contact for this tower, attends the m...
- hardware-warranty: expected hardware-supply.pdf p3. Returned instead:
  1. master-services-agreement.pdf p4 (0.495): every new member of the team an induction that covers the business of Customer, the app...
  2. master-services-agreement.pdf p1 (0.450): Data means all data, records and content that Customer or the customers of Customer sup...
  3. master-services-agreement.pdf p1 (0.444): Master Services Agreement Parties This Master Services Agreement (the Agreement) is mad...
- sow-expenses: found at rank 6, outside the top 5
- nda-governing-law: expected mutual-nda.docx. Returned instead:
  1. master-services-agreement.pdf p13 (0.374): 36.2 Neither party has the authority to make commitments on behalf of the other or to b...
  2. master-services-agreement.pdf p20 (0.369): The target for each calendar month is 95%. Vendor shall state the result for this servi...
  3. hardware-supply.pdf p4 (0.369): 15. Severability If any provision of this Agreement is found to be invalid or unenforce...

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
