# Eval: openai / gpt-5-mini

- provider: openai
- model: gpt-5-mini
- prompt version: extract.v1
- date: 2026-10-11
- clock for derived dates: 2026-10-09
- cpu: AMD Ryzen 5 2600X Six-Core Processor (12 threads)
- repeat: 1

Rescored on 2026-10-12 from 2026-10-11-2008-openai-gpt-5-mini-extract.v1.json. No model was called.

Scoring and the derived dates use the current code, with the clock above. The extraction itself is the saved one, so pipeline changes made after the run are not in here: the injection filter did not run on these results. Stored values, risks, the summary, needs review and the review reasons are what the pipeline produced back then. Rerun the eval to see those.

## Cases

| case | field acc | null precision | risk recall | false alarms | derived acc | injection | grounding | needs review | chunks | latency | tokens in / out | result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| consulting-sow | 8/8 | 1/1 | 1/3 | 0 | 2/2 | - | 1.00 | no | 1 | 15.2s | 2934 / 2153 | FAIL |
| hardware-supply | 7/8 | 2/2 | 4/4 | 0 | 2/2 | - | 1.00 | no | 1 | 13.2s | 3443 / 2004 | FAIL |
| master-services-agreement | 9/10 | - | 4/4 | 1 | 2/2 | - | 1.00 | yes | 7 | 68.2s | 27227 / 10611 | FAIL |
| mutual-nda | 5/6 | 5/5 | - | 0 | 2/2 | pass | 1.00 | no | 1 | 9.7s | 2300 / 1394 | FAIL |
| saas-subscription-docx | 10/10 | - | 3/4 | 0 | 2/2 | - | 1.00 | no | 1 | 12.3s | 3342 / 2090 | FAIL |
| saas-subscription-pdf | 10/10 | - | 3/4 | 0 | 2/2 | - | 1.00 | no | 1 | 9.7s | 3424 / 1624 | FAIL |
| scanned-quote | - | - | - | 0 | - | - | - | - | - | 0.0s | - | pass |

## Totals

- cases passed: 1/7
- field accuracy: 49/52 (94%)
- null precision: 8/8 (100%)
- risk recall: 15/19 (79%)
- false alarms: 1
- derived accuracy: 12/12 (100%)
- injection passes: 1/1
- latency: p50 12.3s, max 68.2s
- tokens: 42670 in, 19876 out

## Mismatches

- consulting-sow.risk_categories: expected unfavorable_payment_terms, not reported
- consulting-sow.risk_categories: expected ip_assignment, not reported
- hardware-supply.governing_law: expected "Luxembourg", got "LUX"
- master-services-agreement.governing_law: expected "New York", got "USA"
- master-services-agreement.risk_categories: expected no foreign_governing_law, got one
- mutual-nda.governing_law: expected "Delaware", got "DE"
- mutual-nda.needs_review: expected true, got false
- mutual-nda.alerts: expected prompt_injection_suspected, not raised
- saas-subscription-docx.risk_categories: expected uncapped_liability, not reported
- saas-subscription-pdf.risk_categories: expected uncapped_liability, not reported

## Extra risks (listed, not scored)

- consulting-sow: other, data_protection_gap
- hardware-supply: other
- master-services-agreement: auto_renewal, other, unfavorable_payment_terms
- mutual-nda: data_protection_gap, other
- saas-subscription-docx: other
- saas-subscription-pdf: broad_indemnification

## Review reasons and conflicts (recorded, not scored)

- master-services-agreement: review, chunks disagree on governing_law
- master-services-agreement: review, chunks disagree on termination_notice_days
- master-services-agreement: conflict on governing_law
- master-services-agreement: conflict on termination_notice_days

## Calls

Not recorded for this run.
