import {
  ASSIGNMENT,
  CONFIDENTIALITY,
  DEFINITIONS,
  ENTIRE_AGREEMENT,
  FORCE_MAJEURE,
  NOTICES,
  SEVERABILITY,
  clause,
} from "./boilerplate.js";
import type { SampleDoc } from "./types.js";

export const saasSubscription: SampleDoc = {
  name: "saas-subscription",
  title: "Software as a Service Subscription Agreement",
  formats: ["pdf", "docx"],
  sections: [
    {
      heading: "Parties",
      paragraphs: [
        "This Software as a Service Subscription Agreement (the Agreement) is made between Cloudhaven Software Ltd., a company incorporated in England (the Vendor), and Nexus Corp, a Delaware corporation (the Customer).",
        "The Vendor operates a hosted spend analytics platform. The Customer wishes to subscribe to that platform on the terms set out below.",
      ],
    },
    clause(1, "Definitions", [
      "Service means the Cloudhaven Insight hosted platform described in Schedule 1, including its documentation and standard support.",
      "Fees means the subscription fees set out in clause 4.",
      "Authorised Users means the employees and contractors of Customer who are permitted to use the Service.",
      ...DEFINITIONS,
    ]),
    clause(2, "Service", [
      "Vendor shall make the Service available to Customer and its Authorised Users for the duration of this Agreement.",
      "Vendor shall provide support by email and telephone on Business Days and shall give Customer reasonable advance notice of planned maintenance.",
      "Vendor may update the Service from time to time, provided that an update does not materially reduce its functionality.",
    ]),
    clause(3, "Term and Renewal", [
      "This Agreement is effective as of 15 January 2025 (the Effective Date) and continues for an initial term of 12 months (the Initial Term).",
      "After the Initial Term, this Agreement renews automatically for successive terms of 12 months (each a Renewal Term) unless either party gives the other at least 60 days written notice before the end of the then current term that it does not wish to renew.",
    ]),
    clause(4, "Fees", [
      "Customer shall pay Vendor a subscription fee of EUR 7,000 per month. The total fees for the Initial Term are EUR 84,000.",
      "The Fees are exclusive of value added tax and similar taxes, which Customer shall pay where they apply.",
      "Vendor may increase the Fees by up to 9% upon each renewal. Vendor shall tell Customer in writing about any increase before the Renewal Term to which it applies.",
    ]),
    clause(
      5,
      "Payment",
      [
        "Vendor shall invoice the Fees monthly in advance.",
        "Payment terms are Net 30 from the date of invoice. Payments shall be made in euro by bank transfer to the account stated on the invoice.",
        "If Customer disputes an invoice in good faith, it shall pay the undisputed part and the parties shall work together to resolve the remainder promptly.",
      ],
      true,
    ),
    clause(6, "Customer Data", [
      "Customer owns all data that it or its Authorised Users submit to the Service. Vendor shall use that data only to provide the Service.",
      "Vendor shall keep backups of Customer data and shall make the data available for export in a commonly used format when this Agreement ends.",
    ]),
    clause(7, "Data Protection", [
      "Each party shall comply with the data protection laws that apply to it.",
      "Vendor shall process personal data only on the documented instructions of Customer and in accordance with the data processing addendum in Schedule 2, and shall apply appropriate technical and organisational security measures.",
    ]),
    clause(8, "Usage Restrictions", [
      "Customer shall not sublicense, resell or otherwise make the Service available to any third party other than its Authorised Users.",
      "Customer shall not copy, modify, decompile or reverse engineer the Service, and shall not use the Service to build a competing product.",
      "Customer shall not use the Service to store or transmit unlawful material or malicious code.",
    ]),
    clause(9, "Confidentiality", CONFIDENTIALITY),
    clause(10, "Liability", [
      "Subject to clauses 10.2 and 10.3, each party's total aggregate liability arising out of or in connection with this Agreement is limited to the Fees paid or payable by Customer in the 12 months preceding the claim.",
      "Nothing in this Agreement limits Customer's liability for breach of clause 8 (Usage Restrictions).",
      "Nothing in this Agreement limits either party's liability for death or personal injury caused by its negligence, or for fraud.",
      "Neither party is liable to the other for any indirect or consequential loss.",
    ]),
    clause(
      11,
      "Termination",
      [
        "Either party may terminate this Agreement with immediate effect by written notice if the other party commits a material breach and, where the breach can be remedied, fails to remedy it within 30 days of being asked in writing to do so.",
        "Either party may terminate this Agreement with immediate effect by written notice if the other party becomes insolvent or enters into liquidation or administration.",
        "When this Agreement ends, Customer shall stop using the Service and each party shall return or destroy the other party's Confidential Information.",
      ],
      true,
    ),
    clause(12, "Force Majeure", FORCE_MAJEURE),
    clause(13, "Notices", NOTICES),
    clause(14, "Assignment", ASSIGNMENT),
    clause(15, "Severability", SEVERABILITY),
    clause(16, "Entire Agreement", ENTIRE_AGREEMENT),
    clause(17, "Governing Law", [
      "This Agreement and any dispute arising out of or in connection with it are governed by the laws of England and Wales.",
      "The courts of England and Wales have exclusive jurisdiction to settle any such dispute.",
    ]),
    {
      heading: "Signatures",
      paragraphs: [
        "Signed for Cloudhaven Software Ltd.: H. Marlowe, Director",
        "Signed for Nexus Corp: Head of Procurement",
      ],
    },
  ],
};
