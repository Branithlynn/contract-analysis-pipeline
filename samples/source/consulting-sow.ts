import {
  ASSIGNMENT,
  CONFIDENTIALITY,
  DEFINITIONS,
  ENTIRE_AGREEMENT,
  NOTICES,
  SEVERABILITY,
  clause,
} from "./boilerplate.js";
import type { SampleDoc } from "./types.js";

export const consultingSow: SampleDoc = {
  name: "consulting-sow",
  title: "Statement of Work for Consulting Services",
  formats: ["docx"],
  sections: [
    {
      heading: "Parties",
      paragraphs: [
        "This Statement of Work (the Agreement) is made between Meridian Advisory Group GmbH, a company incorporated in Germany (the Consultant), and Nexus Corp, a Delaware corporation (the Customer).",
        "The Customer wishes to review its indirect procurement processes and the Consultant has agreed to carry out that review on the terms set out below.",
      ],
    },
    clause(1, "Definitions", [
      "Services means the procurement process review and the related advisory work described in clause 2.",
      "Deliverables means the reports, analyses, models and other materials that Consultant prepares for Customer in the course of the Services.",
      ...DEFINITIONS,
    ]),
    clause(2, "Services and Deliverables", [
      "Consultant shall review the indirect procurement processes of Customer, interview the stakeholders named by Customer, and prepare an assessment of the current state together with a set of recommendations.",
      "The Deliverables are an interim findings report, a final report with recommendations, and a savings model in spreadsheet form.",
      "Customer shall review each Deliverable within ten Business Days of receiving it and shall either accept it in writing or explain in reasonable detail why it does not meet the description in this clause. Consultant shall correct any shortcoming without additional charge.",
    ]),
    clause(3, "Term", [
      "This Agreement commences on 1 March 2026 (the Effective Date) and continues until 31 August 2026, when it expires.",
      "This Agreement does not renew automatically. Any extension requires a written agreement signed by both parties.",
    ]),
    clause(4, "Fees and Payment", [
      "Customer shall pay Consultant a fixed fee of USD 150,000 for the Services. The fee includes all travel and other expenses.",
      "The fee is payable as follows: 50% upon signature, 50% upon acceptance of final deliverables.",
      "All amounts are exclusive of value added tax and similar taxes, which Customer shall pay where they apply.",
    ]),
    clause(5, "Intellectual Property", [
      "All Deliverables and related intellectual property shall remain the exclusive property of Consultant.",
      "Consultant grants Customer a perpetual licence to use the Deliverables for its internal business purposes. The licence may not be transferred or sublicensed.",
      "Each party keeps ownership of the materials it owned before the Effective Date.",
    ]),
    clause(6, "Confidentiality", CONFIDENTIALITY, true),
    clause(7, "Liability", [
      "Each party's total aggregate liability arising out of or in connection with this Agreement is limited to the fees paid or payable under this Agreement.",
      "Nothing in this Agreement limits either party's liability for death or personal injury caused by its negligence, for wilful misconduct, or for fraud.",
      "Neither party is liable to the other for any indirect or consequential loss.",
    ]),
    clause(8, "Termination", [
      "Either party may terminate this Agreement at any time by giving the other party 30 days written notice.",
      "Either party may terminate this Agreement with immediate effect by written notice if the other party becomes insolvent.",
      "If this Agreement is terminated, Customer shall pay for the Services performed up to the date of termination and Consultant shall hand over all Deliverables completed by that date.",
    ]),
    clause(9, "Notices", NOTICES),
    clause(10, "Assignment", ASSIGNMENT),
    clause(11, "Severability", SEVERABILITY),
    clause(12, "Entire Agreement", ENTIRE_AGREEMENT),
    clause(13, "Governing Law", [
      "This Agreement and any dispute arising out of or in connection with it are governed by the laws of the Federal Republic of Germany.",
      "The courts of Frankfurt am Main have exclusive jurisdiction to settle any such dispute.",
    ]),
    {
      heading: "Signatures",
      paragraphs: [
        "Signed for Meridian Advisory Group GmbH: K. Brandt, Managing Director",
        "Signed for Nexus Corp: Head of Procurement",
      ],
    },
  ],
};
