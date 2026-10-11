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

export const hardwareSupply: SampleDoc = {
  name: "hardware-supply",
  title: "Hardware Supply Agreement",
  formats: ["pdf"],
  sections: [
    {
      heading: "Parties",
      paragraphs: [
        "This Hardware Supply Agreement (the Agreement) is made between Ferrox Industrial Components S.A., a company incorporated in Luxembourg (the Supplier), and Nexus Corp, a Delaware corporation (the Customer).",
        "The Supplier manufactures steel enclosures for data centre equipment. The Customer wishes to buy those enclosures for its server hardware on the terms set out below.",
      ],
    },
    clause(1, "Definitions", [
      "Component means the FX220 steel rack enclosure described in the specification in Schedule 1.",
      "Products means the Components and the mounting kits and spare parts listed in Schedule 1.",
      "Purchase Order means a written order for Products issued by Customer under this Agreement.",
      ...DEFINITIONS,
    ]),
    clause(2, "Supply of Products", [
      "Supplier shall manufacture and supply the Products ordered by Customer in accordance with the specification in Schedule 1 and the delivery schedule in each Purchase Order.",
      "Customer shall give Supplier a rolling forecast of its expected requirements at the start of each calendar quarter. A forecast is given in good faith and is not a commitment to buy.",
      "Supplier shall confirm each Purchase Order in writing. A Purchase Order is binding once Supplier has confirmed it.",
      "Supplier shall keep enough manufacturing capacity and raw material available to meet the forecast most recently given by Customer.",
    ]),
    clause(3, "Term", [
      "This Agreement commences on 1 June 2026 (the Effective Date) and continues for a fixed term of 36 months (the Term).",
      "This Agreement does not renew automatically. Any extension requires a written agreement signed by both parties.",
    ]),
    clause(
      4,
      "Price",
      [
        "The total price for the Products to be supplied during the Term is USD 1,200,000 (the Contract Price), based on the unit prices in Schedule 2.",
        "Supplier may adjust the unit prices at the start of each calendar quarter in line with the change in the steel price index named in Schedule 2 over the preceding quarter, without cap.",
        "The prices include standard packaging and exclude value added tax, customs duties and similar charges, which Customer shall pay where they apply.",
      ],
      true,
    ),
    clause(5, "Payment", [
      "Supplier shall invoice Customer on delivery of each consignment.",
      "Payment terms are Net 45 from the date of invoice. Payments shall be made in US dollars by bank transfer to the account stated on the invoice.",
      "Customer shall pay a late payment charge of 2% of the invoice amount for each week of late payment.",
    ]),
    clause(6, "Exclusive Purchasing", [
      "During the Term, Customer shall purchase its entire requirement of the Component exclusively from Supplier and shall not buy the Component, or any product that can be used in its place, from any third party.",
      "This clause applies to the Component only. Customer remains free to buy all other goods from any source.",
    ]),
    clause(7, "Delivery", [
      "Supplier shall deliver the Products to the Customer site named in the Purchase Order on the delivery date stated in it.",
      "Risk in the Products passes to Customer on delivery. Title passes to Customer when Supplier has received payment in full for them.",
      "Customer shall inspect each consignment on arrival and shall tell Supplier in writing about any visible damage or shortfall within five Business Days of delivery.",
    ]),
    clause(
      8,
      "Warranty",
      [
        "Supplier warrants that the Products will conform to the specification in Schedule 1 and will be free from defects in materials and workmanship for two years from delivery.",
        "Supplier shall, at its own cost and at the choice of Customer, repair or replace any Product that does not meet this warranty.",
        "The warranty does not cover damage caused by misuse, by unauthorised modification or by a failure to follow the installation instructions of Supplier.",
      ],
      true,
    ),
    clause(9, "Confidentiality", CONFIDENTIALITY),
    clause(10, "Liability", [
      "Each party's total aggregate liability arising out of or in connection with this Agreement is limited to the Contract Price.",
      "Nothing in this Agreement limits either party's liability for death or personal injury caused by its negligence, or for fraud.",
      "Neither party is liable to the other for any indirect or consequential loss.",
    ]),
    clause(11, "Termination", [
      "Either party may terminate this Agreement with immediate effect by written notice if the other party commits a material breach and, where the breach can be remedied, fails to remedy it within 30 days of being asked in writing to do so.",
      "Either party may terminate this Agreement with immediate effect by written notice if the other party becomes insolvent or enters into liquidation.",
      "Termination does not affect any Purchase Order that Supplier has confirmed before the date of termination.",
    ]),
    clause(12, "Force Majeure", FORCE_MAJEURE, true),
    clause(13, "Notices", NOTICES),
    clause(14, "Assignment", ASSIGNMENT),
    clause(15, "Severability", SEVERABILITY),
    clause(16, "Entire Agreement", ENTIRE_AGREEMENT),
    clause(17, "Governing Law", [
      "This Agreement and any dispute arising out of or in connection with it are governed by the laws of the Grand Duchy of Luxembourg.",
      "The courts of Luxembourg City have exclusive jurisdiction to settle any such dispute.",
    ]),
    {
      heading: "Signatures",
      paragraphs: [
        "Signed for Ferrox Industrial Components S.A.: L. Weyland, Chief Commercial Officer",
        "Signed for Nexus Corp: Head of Procurement",
      ],
    },
  ],
};
