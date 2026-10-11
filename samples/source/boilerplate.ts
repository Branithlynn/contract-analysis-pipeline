// Standard clauses that pad the sample contracts to a realistic length. They are mutual and name no
// amounts, dates or day counts, so nothing in here is an answer or a risk a model should report.
// No hyphenated words either: the parser joins a word that pdfkit happens to wrap at its hyphen,
// and the text would then no longer match the source.
import type { SampleSection } from "./types.js";

export const DEFINITIONS: string[] = [
  "Affiliate means any entity that controls, is controlled by, or is under common control with a party.",
  "Business Day means a day other than a Saturday, a Sunday or a public holiday in the place where the party receiving a notice is established.",
  "Confidential Information means all information disclosed by one party to the other in connection with this Agreement that is marked as confidential or that a reasonable person would understand to be confidential.",
];

export const CONFIDENTIALITY: string[] = [
  "Each party shall keep the other party's Confidential Information confidential and shall use it only to perform its obligations or exercise its rights under this Agreement.",
  "A party may disclose Confidential Information to its employees, Affiliates and professional advisers who need to know it, provided that they are bound by obligations of confidentiality no less strict than those in this clause.",
  "These obligations do not apply to information that is or becomes public other than through a breach of this Agreement, that was already lawfully known to the receiving party, or that the receiving party is required to disclose by law or by a court of competent jurisdiction.",
  "The obligations in this clause continue for five years after this Agreement ends.",
];

export const NOTICES: string[] = [
  "Any notice given under this Agreement must be in writing and delivered by hand, by recorded post or by email to the address most recently notified in writing by the receiving party.",
  "A notice delivered by hand is received on delivery. A notice sent by recorded post is received on the second Business Day after posting. A notice sent by email is received on the next Business Day after it is sent.",
];

export const FORCE_MAJEURE: string[] = [
  "Neither party is in breach of this Agreement or liable for any delay or failure to perform its obligations to the extent that the delay or failure results from events beyond its reasonable control, including natural disasters, war, acts of government, epidemics and failures of public utilities.",
  "The affected party shall notify the other party promptly and shall use reasonable efforts to limit the effect of the event. If the event continues for more than three consecutive months, either party may terminate this Agreement by written notice to the other party.",
];

export const ASSIGNMENT: string[] = [
  "Neither party may assign, transfer or subcontract any of its rights or obligations under this Agreement without the prior written consent of the other party, which shall not be unreasonably withheld or delayed.",
];

export const SEVERABILITY: string[] = [
  "If any provision of this Agreement is found to be invalid or unenforceable, that provision shall be enforced to the fullest extent permitted by law and the remaining provisions shall continue in full force and effect.",
];

export const ENTIRE_AGREEMENT: string[] = [
  "This Agreement and its schedules are the entire agreement between the parties on its subject matter and replace all earlier discussions, correspondence and understandings.",
  "No change to this Agreement is effective unless it is in writing and signed by authorised representatives of both parties.",
];

// Numbers the paragraphs 4.1, 4.2, ... the way a contract does. A clause with a single paragraph
// stays unnumbered.
export function clause(
  number: number,
  title: string,
  paragraphs: string[],
  pageBreakBefore = false,
): SampleSection {
  return {
    heading: `${number}. ${title}`,
    paragraphs:
      paragraphs.length === 1
        ? paragraphs
        : paragraphs.map((text, i) => `${number}.${i + 1} ${text}`),
    ...(pageBreakBefore ? { pageBreakBefore } : {}),
  };
}
