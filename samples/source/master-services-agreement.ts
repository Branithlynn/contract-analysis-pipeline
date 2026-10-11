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
import type { SampleDoc, SampleSection } from "./types.js";

// The long one: it has to be cut into several chunks, with the parties at the start and the contract
// value in a schedule near the end, so no single chunk holds the whole answer. There is no data
// protection clause, addendum or security schedule anywhere, and that absence is one of the
// expected findings. Keep it that way when adding padding.

interface Tower {
  name: string;
  scope: string;
  tasks: string;
  record: string;
  lead: string;
}

const TOWERS: Tower[] = [
  {
    name: "Customer Support Desk",
    scope:
      "operate the first line support desk that answers questions from the customers of Customer by telephone, email and chat",
    tasks:
      "logging every contact as a ticket, resolving common questions at first contact, routing the remaining tickets to the correct resolver group, and following each ticket through to closure",
    record: "the support desk knowledge base and the call handling scripts",
    lead: "Support Desk Manager",
  },
  {
    name: "Account Administration",
    scope:
      "administer customer accounts on the Customer billing and subscription platforms on the instructions of Customer",
    tasks:
      "opening and closing accounts, updating contact and billing details, applying plan changes requested by a customer, and correcting records that a customer reports as wrong",
    record: "the account administration procedures and the record of changes made",
    lead: "Account Operations Lead",
  },
  {
    name: "Platform Operations",
    scope:
      "monitor and operate the production environments that host the customer facing applications of Customer",
    tasks:
      "watching system health around the clock, responding to alerts, applying routine patches in the agreed maintenance windows, and managing capacity so that the applications stay within their performance targets",
    record: "the operations runbooks and the configuration inventory",
    lead: "Platform Operations Manager",
  },
  {
    name: "Application Maintenance",
    scope:
      "maintain the applications listed in the application register agreed between the parties",
    tasks:
      "diagnosing and correcting defects, making minor enhancements that Customer requests through the change control procedure, keeping third party libraries current, and preparing each release for deployment",
    record: "the release notes and the defect log for each application",
    lead: "Application Maintenance Lead",
  },
  {
    name: "Release and Deployment",
    scope:
      "plan and carry out the deployment of new releases into the test and production environments",
    tasks:
      "agreeing a release calendar with Customer, running the deployment checklist, confirming with Customer that a release may proceed, and reversing a release that causes a serious fault",
    record: "the release calendar and the deployment checklists",
    lead: "Release Manager",
  },
  {
    name: "Testing Services",
    scope:
      "test changes to the applications before they are released into the production environment",
    tasks:
      "writing and maintaining test cases, running regression tests for each release, recording the results, and reporting to Customer any defect that should stop a release from going ahead",
    record: "the test plans, the test cases and the results of each test cycle",
    lead: "Test Lead",
  },
  {
    name: "Reporting and Analytics",
    scope:
      "produce the operational reports that Customer uses to manage its customer service function",
    tasks:
      "preparing the weekly and monthly reports listed in the reporting catalogue, building new reports that Customer asks for through the change control procedure, and checking the figures in each report against the source systems before it is issued",
    record: "the reporting catalogue and the definition of each measure used in the reports",
    lead: "Reporting Lead",
  },
  {
    name: "Service Improvement",
    scope: "run a continuous improvement programme across all of the Services",
    tasks:
      "reviewing recurring tickets to find their underlying causes, proposing changes that would remove those causes, estimating the benefit of each proposal, and carrying out the proposals that Customer approves",
    record: "the improvement register and the status of each open proposal",
    lead: "Service Improvement Lead",
  },
  {
    name: "Knowledge Management",
    scope:
      "maintain the knowledge articles that support desk agents and the customers of Customer use to answer common questions",
    tasks:
      "writing a new article when a new kind of question starts to appear, reviewing every article at least once a year, retiring articles that are out of date, and measuring how often each article resolves a contact",
    record: "the article review schedule and the usage figures for each article",
    lead: "Knowledge Manager",
  },
  {
    name: "Problem Management",
    scope:
      "investigate the underlying causes of incidents that recur or that had a serious effect on the customers of Customer",
    tasks:
      "opening a problem record for each such incident, analysing the evidence, identifying a permanent fix, and tracking that fix until it has been deployed and shown to work",
    record: "the problem register and the analysis for each closed problem",
    lead: "Problem Manager",
  },
];

const towerSections: SampleSection[] = TOWERS.map((tower, i) => ({
  heading: `A.${i + 1} ${tower.name}`,
  paragraphs: [
    `Vendor shall ${tower.scope}. The work in this tower includes ${tower.tasks}.`,
    `Vendor shall document ${tower.record}, shall keep them current, and shall make the latest version available to Customer in the shared project repository.`,
    `The ${tower.lead} appointed by Vendor is the point of contact for this tower, attends the monthly service review, and answers for the performance of the tower against the service levels in Schedule C.`,
  ],
}));

interface ServiceLevel {
  name: string;
  measure: string;
  target: string;
}

const SERVICE_LEVELS: ServiceLevel[] = [
  {
    name: "Availability of Production Applications",
    measure:
      "The share of the agreed service hours in which each production application can be used by the customers of Customer, leaving out the agreed maintenance windows.",
    target: "99.5%",
  },
  {
    name: "Speed of Answer",
    measure:
      "The share of telephone calls to the support desk that an agent answers within the answer time set out in the support desk procedures.",
    target: "85%",
  },
  {
    name: "First Contact Resolution",
    measure:
      "The share of support desk tickets that are resolved during the first contact with the customer and are not opened again within the following week.",
    target: "70%",
  },
  {
    name: "Response to Critical Incidents",
    measure:
      "The share of critical incidents for which Vendor has assigned an engineer and told Customer who that engineer is within the response time for critical incidents.",
    target: "95%",
  },
  {
    name: "Resolution of Critical Incidents",
    measure:
      "The share of critical incidents for which the affected service has been restored, by a fix or by a workaround that Customer accepts, within the resolution time for critical incidents.",
    target: "90%",
  },
  {
    name: "Release Quality",
    measure:
      "The share of releases deployed to the production environment that do not have to be reversed and do not cause a critical incident in the week after deployment.",
    target: "95%",
  },
  {
    name: "Timeliness of Reports",
    measure:
      "The share of the reports in the reporting catalogue that Vendor issues to Customer on or before the date on which they are due.",
    target: "98%",
  },
  {
    name: "Customer Satisfaction",
    measure:
      "The share of responses to the support desk survey in which the customer rates the contact as good or very good.",
    target: "88%",
  },
  {
    name: "Ticket Backlog",
    measure:
      "The share of the support desk tickets open at the end of the month that are older than the agreed ageing limit. A lower figure is better.",
    target: "no more than 5%",
  },
];

const serviceLevelSections: SampleSection[] = SERVICE_LEVELS.map((level, i) => ({
  heading: `C.${i + 2} ${level.name}`,
  paragraphs: [
    `${level.measure} The target for each calendar month is ${level.target}.`,
    `Vendor shall state the result for this service level in the monthly service report. Where the target is missed, the report shall explain the cause and set out the steps Vendor is taking so that the target is met in the following month.`,
  ],
}));

interface Forum {
  name: string;
  frequency: string;
  attendees: string;
  agenda: string;
}

const FORUMS: Forum[] = [
  {
    name: "Operational Review",
    frequency: "every week",
    attendees: "the tower leads of Vendor and the service owners of Customer",
    agenda:
      "open incidents, the tickets that are older than the agreed ageing limit, the changes planned for the coming week, and any staffing matters that affect the Services",
  },
  {
    name: "Service Review",
    frequency: "every month",
    attendees: "the Vendor Service Manager and the Customer Service Manager",
    agenda:
      "the monthly service report, the results against each service level, the progress of improvement proposals, and the change requests awaiting a decision",
  },
  {
    name: "Commercial Review",
    frequency: "every quarter",
    attendees: "the account director of Vendor and the procurement lead of Customer",
    agenda:
      "the invoices issued in the quarter, the forecast of work for the next two quarters, the status of each Statement of Work, and any matter escalated from the service review",
  },
  {
    name: "Executive Review",
    frequency: "twice a year",
    attendees: "a senior executive of each party",
    agenda:
      "the overall health of the relationship, the strategic plans of Customer that may change its need for the Services, and any dispute that has not been settled at a lower level",
  },
];

const forumSections: SampleSection[] = FORUMS.map((forum, i) => ({
  heading: `D.${i + 2} ${forum.name}`,
  paragraphs: [
    `The ${forum.name} meets ${forum.frequency} and is attended by ${forum.attendees}. Its standing agenda covers ${forum.agenda}.`,
    `Vendor shall circulate the papers for the ${forum.name} in advance, shall record the decisions and actions agreed at the meeting, and shall send that record to the attendees within three Business Days of the meeting.`,
  ],
}));

const body: SampleSection[] = [
  {
    heading: "Parties",
    paragraphs: [
      "This Master Services Agreement (the Agreement) is made between Atlas Ridge Technologies LLC, a Texas limited liability company (the Vendor), and Nexus Corp, a Delaware corporation (the Customer), and is effective as of 1 February 2026 (the Effective Date).",
      "The Vendor provides managed customer support and application operations services. The Customer wishes to engage the Vendor to provide those services for its customer facing software products, and the Vendor has agreed to do so on the terms of this Agreement.",
    ],
  },
  clause(1, "Definitions", [
    "Acceptance Criteria means the objective tests or measures that a Deliverable must satisfy, as set out in the applicable Statement of Work.",
    "Change Order means a written document signed by both parties that changes the scope, timing or price of the Services in accordance with clause 10.",
    "Customer Data means all data, records and content that Customer or the customers of Customer supply to Vendor, or that Vendor collects or generates on behalf of Customer, in the course of the Services.",
    "Customer Materials means the software, documents, equipment and other materials that Customer makes available to Vendor for the purposes of the Services.",
    "Deliverable means any item that Vendor is required to deliver to Customer under a Statement of Work.",
    "Fees means the charges for the Services set out in Schedule B and in any Change Order.",
    "Key Personnel means the individuals named as such in Schedule D or in a Statement of Work.",
    "Services means the services described in Schedule A and in each Statement of Work, together with any work that is a necessary part of providing them.",
    "Statement of Work means a document agreed and signed by both parties under clause 2 that describes specific Services, Deliverables and timescales.",
    "Vendor Personnel means the employees, agents and subcontractors of Vendor who are engaged in providing the Services.",
    "Work Product means all software, documentation, designs, reports, data models, processes and other materials that Vendor creates in the course of providing the Services, whether alone or together with Customer.",
    "Incident means an unplanned interruption to a service that forms part of the Services, or a reduction in the quality of such a service.",
    "Production Environment means the systems on which the live applications of Customer run and which the customers of Customer use.",
    "Release means a set of changes to an application that is deployed together.",
    "Service Level means a standard of performance set out in Schedule C.",
    "Tower means one of the groups of Services described in Schedule A.",
    ...DEFINITIONS,
    "In this Agreement, headings are for convenience only and do not affect interpretation, words in the singular include the plural, and a reference to a clause or a schedule is a reference to a clause of or a schedule to this Agreement.",
  ]),
  clause(2, "Structure of this Agreement", [
    "This Agreement sets out the terms on which Vendor provides Services to Customer. It consists of these clauses, the schedules, and each Statement of Work that the parties agree from time to time.",
    "Either party may propose a Statement of Work. A Statement of Work takes effect when it has been signed by an authorised representative of each party, and from that moment it forms part of this Agreement.",
    "Each Statement of Work shall describe the Services to be performed, the Deliverables, the timetable, the Acceptance Criteria, the Key Personnel if any, and any assumptions on which it is based.",
    "If there is a conflict between the parts of this Agreement, the clauses prevail over the schedules, and the schedules prevail over a Statement of Work, unless the Statement of Work states expressly which clause it is intended to change.",
    "Affiliates of Customer may receive the benefit of the Services. Customer remains responsible to Vendor for the acts and omissions of any Affiliate that does so.",
    "A Statement of Work may be changed only by a Change Order. An exchange of emails between project staff does not change a Statement of Work, even where both sides act on it for a time.",
    "Vendor shall keep a register of all Statements of Work that shows the status of each, and shall give Customer an up to date copy of the register at each commercial review.",
    "Vendor shall not start work that is outside the scope of a signed Statement of Work, and Customer is not obliged to pay for any work that has been started in that way.",
  ]),
  clause(3, "Term and Renewal", [
    "This Agreement commences on the Effective Date and continues for an initial term of 24 months (the Initial Term).",
    "After the Initial Term, this Agreement renews automatically for successive terms of 12 months (each a Renewal Term) unless either party gives the other at least 90 days written notice before the end of the then current term that it does not wish to renew.",
    "A Statement of Work that is still in progress when this Agreement ends continues until it is completed, and the terms of this Agreement continue to apply to it until then.",
  ]),
  clause(4, "Services", [
    "Vendor shall provide the Services in accordance with this Agreement, Schedule A and each Statement of Work.",
    "Vendor shall provide the Services from its own delivery centres and, where a Statement of Work requires it, at the premises of Customer.",
    "Vendor shall supply all of the people, tools, equipment and software that it needs to provide the Services, other than the Customer Materials.",
    "Vendor shall cooperate with the other suppliers of Customer where their work touches on the Services, and shall take part in joint planning sessions that Customer reasonably convenes.",
    "Vendor shall tell Customer promptly if it becomes aware of anything that is likely to delay the Services or to affect their quality, and shall propose a plan to deal with it.",
    "Vendor shall not make any material change to the way in which the Services are delivered without first agreeing that change with Customer through the change control procedure.",
    "Vendor shall keep the documentation of the Services, including the runbooks and the procedures, complete and current, so that a competent person who is new to the Services could operate them from the documentation alone.",
    "Where a Statement of Work sets milestones, Vendor shall meet each milestone by its date. If Vendor expects to miss a milestone, it shall tell Customer as soon as it knows, explain the reason, and propose a revised date together with the steps it will take to hold that date.",
    "Vendor shall use the tools and templates that Customer specifies for ticketing, for document storage and for project reporting, so that the records of the Services sit in the systems of Customer.",
    "Vendor shall hold a planning session with Customer before the start of each quarter to agree the priorities for that quarter, and shall arrange the work of the team to match them.",
    "Vendor shall take over the Services from the present arrangements of Customer in line with the transition plan agreed between the service managers, and shall make sure that the customers of Customer see no break in service while it does so.",
  ]),
  clause(5, "Performance Standards", [
    "Vendor shall perform the Services with the skill, care and diligence that would be expected of a leading provider of similar services.",
    "Vendor shall meet or exceed the service levels set out in Schedule C. Vendor shall measure its performance against each service level and shall report the results to Customer every month.",
    "If Vendor misses the same service level in two consecutive months, it shall prepare a written correction plan, agree that plan with Customer, and carry it out at its own cost.",
    "Vendor shall keep its methods, tools and documentation in line with good industry practice as that practice develops over the life of this Agreement.",
    "The parties shall review the service levels once a year and may change them by written agreement to reflect changes in the business of Customer.",
    "Vendor shall carry out a root cause analysis of every critical incident and shall give Customer a written report of its findings within ten Business Days of the incident being closed. The report shall say what happened, why it happened, and what Vendor has changed to stop it from happening again.",
    "Vendor shall measure the satisfaction of the customers of Customer with the support desk by means of a short survey offered at the end of each contact, and shall include the results in the monthly service report.",
    "Where Customer reasonably believes that the quality of the Services has fallen, it may ask Vendor for a quality review. Vendor shall carry out the review with a person from outside the delivery team and shall share the findings and its proposed actions with Customer.",
    "Vendor shall keep a library of the lessons learned from incidents, releases and reviews, and shall show at each service review how those lessons have changed the way it works.",
  ]),
  clause(6, "Vendor Personnel", [
    "Vendor shall make sure that the Vendor Personnel have the qualifications, training and experience needed for the tasks assigned to them.",
    "Vendor is responsible for the pay, benefits, taxes and working conditions of the Vendor Personnel. Nothing in this Agreement makes any of the Vendor Personnel an employee of Customer.",
    "Vendor shall carry out the background checks on Vendor Personnel that are lawful in the country where each individual works and that Customer reasonably asks for.",
    "Customer may ask Vendor to remove an individual from the Services if Customer reasonably believes that the individual is not performing to the required standard. Vendor shall discuss the request with Customer in good faith and shall replace the individual without delay if the concern is not resolved.",
    "Vendor shall keep the turnover of Vendor Personnel assigned to the Services as low as it reasonably can, and shall arrange a proper handover whenever an individual leaves the team.",
    "While they are at the premises of Customer, the Vendor Personnel shall follow the site rules and the health and safety policies that Customer has made known to Vendor.",
    "Vendor shall give every new member of the team an induction that covers the business of Customer, the applications that Customer runs, the procedures for the Services and the policies of Customer that apply to them.",
    "Vendor shall keep a current list of the Vendor Personnel assigned to the Services, showing the role and the location of each, and shall give that list to Customer on request.",
    "Vendor shall maintain a training plan for the team and shall bear the cost of the training that the Vendor Personnel need in order to keep their skills current.",
    "Vendor shall make sure that the Vendor Personnel who speak to the customers of Customer are fluent in the languages in which Customer serves its customers and have been trained in the tone and style that Customer asks its own staff to use.",
    "Vendor shall plan the working patterns of the team so that the Services are properly staffed during public holidays and at the times of year when the volume of contacts is highest.",
  ]),
  clause(7, "Key Personnel", [
    "Vendor shall assign the Key Personnel to the Services for the periods and at the levels of commitment stated in Schedule D or in the applicable Statement of Work.",
    "Vendor shall not remove or replace any of the Key Personnel without the prior written consent of Customer, unless the individual resigns, is dismissed for misconduct, or is unable to work because of illness or a similar personal circumstance.",
    "If one of the Key Personnel has to be replaced, Vendor shall propose a replacement with equivalent skills and experience, shall give Customer the chance to interview that person, and shall arrange a handover period at its own cost.",
    "Vendor shall make sure that each of the Key Personnel has a named deputy who knows the Services well enough to stand in during holidays and other short absences.",
    "The parties shall review the list of Key Personnel once a year and may change it by written agreement.",
    "Vendor shall tell Customer as soon as it learns that one of the Key Personnel intends to leave, and shall not wait until a replacement has been found before doing so.",
  ]),
  clause(8, "Customer Responsibilities", [
    "Customer shall give Vendor the information, decisions and approvals that Vendor reasonably needs to provide the Services, and shall do so within the times stated in the Statement of Work or otherwise within a reasonable time.",
    "Customer shall appoint a service manager who has the authority to act for Customer in the day to day running of this Agreement.",
    "Customer shall make the Customer Materials available to Vendor and confirms that it has the right to let Vendor use them for the Services.",
    "If Customer does not meet one of its responsibilities and that failure delays Vendor, Vendor shall tell Customer promptly and the timetable shall be extended by a period that fairly reflects the delay.",
    "Customer shall make sure that its own staff who work with Vendor are available for the meetings and workshops described in Schedule D.",
    "Customer shall tell Vendor in good time about planned changes to its own systems, products or business processes that are likely to affect the volume or the nature of the work that Vendor does.",
    "Customer shall give Vendor a forecast of the expected number of support contacts for each quarter. The forecast is given in good faith to help Vendor plan its staffing and is not a commitment.",
    "Customer remains responsible for the decisions that it makes about its own products and policies, including the rules that Vendor applies on its behalf when dealing with the customers of Customer.",
    "Customer shall give the Vendor Personnel the product training that they need in order to support a new product or a major new feature before it is released to the customers of Customer.",
    "Customer shall tell Vendor promptly about any complaint that it receives about the Services, so that Vendor has the chance to look into it and put it right.",
  ]),
  clause(9, "Facilities and Access", [
    "Where the Services are performed at the premises of Customer, Customer shall provide the Vendor Personnel with reasonable working space, network access and the other facilities that they need.",
    "Vendor shall use the facilities and systems of Customer only for the purpose of providing the Services and shall follow the acceptable use policies that Customer has made known to it.",
    "Customer may give Vendor remote access to its systems. Vendor shall make sure that only those Vendor Personnel who need that access use it, and shall tell Customer when an individual no longer needs it.",
    "Vendor shall return all passes, equipment and other property of Customer when the individual to whom they were issued leaves the Services, and in any case when this Agreement ends.",
    "Vendor shall look after any equipment that Customer lends to it, shall use it only for the Services, and shall return it in the condition in which it was received, fair wear and tear excepted.",
    "Each party shall tell the other promptly if it becomes aware of any misuse of the facilities or systems of Customer by the Vendor Personnel, and the parties shall work together to deal with it.",
    "Where Vendor Personnel work at the premises of Customer for more than a short visit, the parties shall agree the working hours, the desks to be used and the arrangements for access outside normal hours.",
  ]),
  clause(10, "Change Control", [
    "Either party may ask for a change to the Services, to a Statement of Work or to the service levels by sending a written change request to the other party.",
    "Within ten Business Days of receiving or sending a change request, Vendor shall give Customer a written assessment of the effect of the proposed change on the Services, the timetable, the Deliverables and the Fees.",
    "A change takes effect only when both parties have signed a Change Order that records it. Until then, each party shall continue to perform its obligations as if the change had not been requested.",
    "Vendor shall not unreasonably refuse a change that Customer requests, and Customer shall not unreasonably refuse a change that Vendor needs to make in order to comply with a change in the law.",
    "Vendor shall keep a log of all change requests and their status and shall present that log at each monthly service review.",
    "Minor operational changes that do not affect the scope, the timetable or the Fees may be agreed in writing between the service managers without a Change Order.",
    "Where a change is needed urgently in order to restore a service or to prevent a serious fault, the service managers may agree it orally. Vendor shall record the change in writing by the end of the next Business Day and the parties shall then complete a Change Order in the usual way.",
    "The assessment that Vendor gives under this clause shall be prepared at the cost of Vendor, unless the parties agree in advance that a particular assessment needs so much work that it should be paid for.",
    "Each Change Order shall be numbered in sequence and shall state the Statement of Work to which it relates, the change that is being made, the reason for it, and its effect on the timetable, the Deliverables and the Fees.",
    "If the parties cannot agree on a change request, either of them may refer the matter to the service review, and the request stays open until it has been agreed, withdrawn or rejected there.",
  ]),
  clause(11, "Acceptance", [
    "Vendor shall tell Customer in writing when a Deliverable is ready for review and shall give Customer the materials that Customer needs in order to review it.",
    "Customer shall review each Deliverable against its Acceptance Criteria within fifteen Business Days of receiving it, or within any other period stated in the Statement of Work.",
    "If the Deliverable meets its Acceptance Criteria, Customer shall confirm acceptance in writing. If it does not, Customer shall give Vendor a written list of the points on which it falls short.",
    "Vendor shall correct the points on that list at its own cost and shall present the Deliverable again for review. The review procedure in this clause then applies again.",
    "If a Deliverable still does not meet its Acceptance Criteria after it has been presented for a third time, the matter shall be referred to the dispute resolution procedure in clause 24.",
    "Use of a Deliverable by Customer for testing or evaluation is not acceptance of it.",
    "Where a Deliverable is to be delivered in stages, this clause applies to each stage separately, and acceptance of an earlier stage does not prevent Customer from raising a point on that stage that could only be found when a later stage was tested.",
    "Customer shall not withhold acceptance because of minor faults that do not affect the use of the Deliverable. Vendor shall correct those faults within a reasonable time after acceptance.",
    "Vendor shall test each Deliverable itself before presenting it for review and shall give Customer the results of that testing on request.",
  ]),
  clause(12, "Governance and Reporting", [
    "Each party shall appoint the representatives named in Schedule D and shall take part in the meetings described there.",
    "Vendor shall give Customer a written service report within ten Business Days of the end of each calendar month. The report shall cover the work done in the month, the results against the service levels, the open risks and issues, and the plan for the following month.",
    "Vendor shall keep a register of risks and issues that affect the Services, shall update it at least once a month, and shall share it with Customer.",
    "Either service manager may call an additional meeting on reasonable notice if a matter needs attention before the next scheduled meeting.",
    "Decisions made at a governance meeting bind the parties only if they are within the authority of the people who attended and are recorded in the written record of the meeting.",
    "Vendor shall keep an action log that records each action agreed at a governance meeting, the person responsible for it and the date by which it is due, and shall report on overdue actions at the next meeting.",
    "Once a year the parties shall hold a planning session at which Customer sets out its priorities for the coming year and Vendor explains how it proposes to support them.",
    "The monthly service report shall follow the format agreed between the service managers, and the parties shall review that format once a year to make sure that it still gives Customer the information it needs.",
    "Vendor shall give Customer access to the live dashboards that it uses to manage the Services, so that Customer can see the current position between reports.",
  ]),
  clause(13, "Fees and Invoicing", [
    "In return for the Services, Customer shall pay Vendor the Fees. The Fees, the invoicing schedule and the payment terms are set out in Schedule B.",
    "Each invoice shall identify this Agreement and the Statement of Work to which it relates, shall describe the Services covered, and shall be sent to the accounts payable address that Customer has given to Vendor.",
    "If Customer disputes an invoice in good faith, it shall tell Vendor in writing which part it disputes and why, and shall pay the part that is not disputed. The parties shall work together to settle the disputed part promptly.",
    "Except as stated in Schedule B or in a Change Order, the Fees are the whole of the amount payable by Customer for the Services, and Vendor shall not charge for anything else.",
    "Vendor shall issue each invoice within three months of the end of the period to which it relates.",
    "Vendor shall give Customer the supporting information that Customer reasonably asks for in order to check an invoice, including timesheets where the Fees depend on the time spent.",
    "Vendor shall name a contact in its finance team who can answer questions about invoices, and shall tell Customer if that contact changes.",
  ]),
  clause(14, "Taxes", [
    "The Fees do not include sales tax, use tax, value added tax or similar taxes. Where such a tax applies to the Services, Vendor shall show it separately on the invoice and Customer shall pay it.",
    "Each party is responsible for the taxes on its own income, property and employees.",
    "If the law requires Customer to withhold tax from a payment to Vendor, Customer shall pay the amount withheld to the tax authority, shall give Vendor the official receipt, and shall cooperate with Vendor in claiming any relief that is available.",
  ]),
  clause(15, "Expenses", [
    "The Fees include all of the costs that Vendor incurs in providing the Services from its own delivery centres.",
    "Customer shall reimburse the reasonable travel and accommodation costs of Vendor Personnel who travel to the premises of Customer at the request of Customer, provided that Customer approved the trip in writing in advance and the costs are in line with the travel policy that Customer has given to Vendor.",
    "Vendor shall invoice approved expenses at cost, without any markup, and shall provide receipts on request.",
    "Vendor shall book travel at the most economical fare that is reasonably available and shall combine trips where it sensibly can.",
  ]),
  clause(16, "Records and Audit", [
    "Vendor shall keep complete and accurate records of the Services, of the time spent by Vendor Personnel where the Fees depend on it, and of the amounts invoiced to Customer.",
    "Vendor shall keep those records for six years after the end of the year to which they relate.",
    "Customer, or an independent auditor that it appoints, may inspect those records once in each year on reasonable written notice and during normal working hours, in order to check that the invoices are correct and that Vendor is meeting its obligations under this Agreement.",
    "If an audit shows that Vendor has charged more than it was entitled to, Vendor shall refund the difference promptly. If an audit shows that Vendor has charged less than it was entitled to, Customer shall pay the difference promptly.",
    "Each party bears its own costs of an audit. An auditor appointed by Customer shall sign a confidentiality undertaking in a reasonable form before starting work.",
    "Vendor shall give the auditor reasonable access to the people, the premises and the systems that are relevant to the audit, and shall answer the reasonable questions of the auditor promptly.",
    "Customer shall give Vendor a copy of the findings of each audit. The parties shall discuss the findings at the next commercial review and shall agree the actions, if any, that follow from them.",
    "Vendor shall keep its records in a form that allows the work done for Customer to be told apart from the work that Vendor does for its other clients.",
  ]),
  clause(17, "Customer Data", [
    "Customer owns all Customer Data. Nothing in this Agreement transfers ownership of any Customer Data to Vendor.",
    "In providing the Services, Vendor will host, access and handle Customer Data, including the names, contact details, account histories and support records of the customers of Customer.",
    "Vendor shall give Customer a copy of the Customer Data in a commonly used format whenever Customer reasonably asks for one, and when this Agreement ends.",
  ]),
  clause(18, "Warranties", [
    "Each party warrants that it has the power and authority to enter into this Agreement and to perform its obligations under it.",
    "Vendor warrants that the Services will be performed in a professional manner by people with suitable skills, and that each Deliverable will meet its Acceptance Criteria when it is delivered.",
    "Vendor warrants that the Deliverables will be free from material defects for six months after acceptance. If a defect appears in that period, Vendor shall correct it at its own cost within a reasonable time.",
    "Vendor warrants that it will not knowingly introduce into the systems of Customer any software that is designed to damage or disrupt them.",
    "Customer warrants that it has the right to give Vendor access to the Customer Materials for the purposes of the Services.",
    "The warranties in this Agreement are the only warranties given by the parties. All other warranties, whether express or implied, are excluded to the extent the law allows.",
    "Vendor warrants that it owns or has the right to use the tools, methods and materials that it uses to provide the Services.",
    "Each party shall tell the other promptly if it becomes aware that one of its warranties is no longer true.",
    "Where Vendor passes on to Customer a product made by a third party, Vendor shall give Customer the benefit of any warranty that the maker of that product gives, so far as it is able to do so.",
  ]),
  clause(19, "Compliance with Laws", [
    "Each party shall comply with the laws that apply to its business and to its performance of this Agreement.",
    "Neither party shall offer, give or accept a bribe or any other improper advantage in connection with this Agreement. Each party shall keep in place policies and controls that are designed to prevent bribery by its staff and agents.",
    "Each party shall comply with the export control and sanctions laws that apply to it, and shall not transfer any software or technical information received under this Agreement in breach of those laws.",
    "Vendor shall comply with the employment, immigration and working time laws that apply to the Vendor Personnel, and shall not use forced labour or child labour anywhere in its business.",
    "Vendor shall obtain and keep in force the licences and permits that it needs in order to provide the Services.",
    "Vendor shall maintain a code of conduct for its staff and shall give Customer a copy on request. Vendor shall give the Vendor Personnel a confidential way to report concerns about unlawful or unethical conduct.",
    "Each party shall tell the other promptly if it becomes aware of a breach of this clause that relates to this Agreement, and shall cooperate with any reasonable inquiry that the other makes.",
    "Vendor shall give the Vendor Personnel training on the matters covered by this clause at least once a year and shall keep a record of who has completed it.",
  ]),
  clause(20, "Insurance", [
    "Vendor shall keep in force, with insurers of good standing, professional liability insurance, general commercial liability insurance and the employer liability insurance required by law, each in an amount that is customary for a business of its size and kind.",
    "Vendor shall keep that insurance in force for the term of this Agreement and for two years after it ends, and shall give Customer a certificate of insurance on request.",
    "The insurance that Vendor holds does not limit its obligations or its liability under this Agreement.",
    "Vendor shall tell Customer in writing before any of the policies required by this clause is cancelled or is changed in a way that materially reduces the cover.",
    "If Vendor uses a subcontractor for a material part of the Services, it shall make sure that the subcontractor holds insurance that is appropriate to the work it does.",
  ]),
  clause(21, "Indemnification", [
    "Customer shall indemnify, defend and hold harmless Vendor, its Affiliates and their officers, employees and agents against any and all claims, without limitation, arising out of or in connection with this Agreement or the use of the Services by Customer, including the legal fees and other costs of responding to those claims.",
    "Vendor shall tell Customer in writing about any claim for which it seeks to be indemnified as soon as it reasonably can after it becomes aware of the claim.",
    "Customer may take control of the defence and settlement of the claim, and Vendor shall give Customer the information and help that Customer reasonably asks for in doing so. Customer shall not settle a claim in a way that admits fault on the part of Vendor without the written consent of Vendor.",
  ]),
  clause(22, "Subcontracting", [
    "Vendor shall not subcontract any material part of the Services without the prior written consent of Customer, which Customer shall not unreasonably withhold.",
    "Vendor shall give Customer the name of each proposed subcontractor and a description of the work that it would do.",
    "Vendor remains fully responsible for the work of its subcontractors and for their compliance with this Agreement, as if that work had been done by Vendor itself.",
    "Vendor shall make sure that each subcontract contains obligations of confidentiality that are no less strict than those in this Agreement.",
    "Vendor shall give Customer a list of its approved subcontractors at each commercial review and shall tell Customer of any change in the ownership of a subcontractor that it becomes aware of.",
    "Vendor shall not replace an approved subcontractor with another without following this clause again.",
  ]),
  clause(23, "Business Continuity", [
    "Vendor shall keep in place a written business continuity plan that sets out how it will go on providing the Services if one of its delivery centres cannot be used.",
    "Vendor shall test that plan at least once a year, shall share a summary of the results with Customer, and shall correct any weakness that the test brings to light.",
    "If an event occurs that triggers the plan, Vendor shall tell Customer without delay, shall put the plan into effect, and shall keep Customer informed until the Services are back to normal.",
    "Vendor shall review the plan whenever the Services change materially and shall update it where that is needed.",
    "The plan shall name the alternative site from which each tower of the Services would be delivered, the time within which delivery from that site would begin, and the people who are responsible for making the move.",
  ]),
  clause(24, "Dispute Resolution", [
    "The parties shall try in good faith to settle any dispute arising out of or in connection with this Agreement by negotiation before they start court proceedings.",
    "A party that wishes to raise a dispute shall send the other party a written notice that describes it. The service managers shall meet within ten Business Days of that notice to try to settle the dispute.",
    "If the service managers have not settled the dispute within twenty Business Days of the notice, either party may refer it to the executive review described in Schedule D, and the senior executives shall meet to try to settle it.",
    "If the dispute has still not been settled within forty Business Days of the notice, either party may start proceedings in the courts named in clause 41.",
    "Nothing in this clause prevents a party from applying to a court at any time for an urgent order to protect its rights. Each party shall continue to perform its obligations under this Agreement while a dispute is being dealt with.",
    "The parties shall keep the content of any negotiation under this clause confidential and shall not rely on anything said in it in later proceedings, other than a settlement that is recorded in writing and signed by both parties.",
  ]),
  clause(25, "Exit Assistance", [
    "When this Agreement or a Statement of Work is coming to an end, for whatever reason, Vendor shall give Customer the help that Customer reasonably needs in order to move the Services to Customer itself or to another supplier.",
    "That help includes handing over the current documentation and the open tickets, explaining how the Services are run to the people who will take them over, and answering their reasonable questions.",
    "Vendor shall provide exit assistance for up to six months after the end date if Customer asks for it. Exit assistance that goes beyond the scope of the Services is charged at the rates agreed in a Change Order.",
    "The parties shall agree an exit plan within six months of the Effective Date, following the outline in Schedule D, and shall review that plan once a year.",
    "During an exit period Vendor shall continue to provide the Services to the standards required by this Agreement.",
    "Vendor shall not move the Vendor Personnel who are needed for exit assistance to other work during an exit period without the agreement of Customer.",
    "Exit assistance does not extend the term of this Agreement, and the parties remain bound by its terms for as long as exit assistance is being provided.",
  ]),
  clause(26, "Termination", [
    "Vendor may terminate this Agreement or any Statement of Work for convenience at any time by giving Customer 30 days written notice.",
    "Customer may not terminate this Agreement or any Statement of Work for convenience.",
    "Either party may terminate this Agreement or any Statement of Work with immediate effect by written notice if the other party commits a material breach and, where the breach can be remedied, fails to remedy it within 30 days of being asked in writing to do so.",
    "Either party may terminate this Agreement with immediate effect by written notice if the other party becomes insolvent, makes an arrangement with its creditors, or has a receiver or similar officer appointed over its assets.",
    "Termination of one Statement of Work does not affect any other Statement of Work or the rest of this Agreement.",
  ]),
  clause(27, "Consequences of Termination", [
    "When this Agreement ends, Customer shall pay Vendor the Fees for the Services performed up to the end date, and Vendor shall deliver to Customer all Deliverables that have been completed and paid for.",
    "Each party shall return to the other, or destroy if the other so asks, the Confidential Information and the property of the other that it holds.",
    "The end of this Agreement does not affect any right or remedy that a party has already acquired. The clauses that by their nature are meant to continue after the end of this Agreement do so, including the clauses on confidentiality, liability, intellectual property and governing law.",
    "Vendor shall give Customer a final statement of account within a reasonable time after the end date, showing the amounts invoiced, the amounts paid and any balance that remains.",
  ]),
  clause(28, "Limitation of Liability", [
    "Subject to clause 28.4, each party's total aggregate liability arising out of or in connection with this Agreement, whether in contract, tort or otherwise, shall not exceed the fees paid in the twelve (12) months preceding the claim.",
    "The limit in clause 28.1 applies to all liability under this Agreement, including the liability of Customer under the indemnity in clause 21.",
    "Neither party is liable to the other for any indirect or consequential loss, or for any loss of profit, revenue or goodwill, however it arises.",
    "Nothing in this Agreement limits or excludes the liability of either party for death or personal injury caused by its negligence, for fraud, or for any other liability that cannot be limited or excluded by law.",
    "Each party shall take reasonable steps to reduce any loss for which it intends to claim against the other.",
  ]),
  clause(29, "Third Party Materials", [
    "Vendor shall not include any software or other materials owned by a third party in a Deliverable unless the Statement of Work says so or Customer has agreed in writing.",
    "Where third party materials are included, Vendor shall give Customer a list of them and a copy of the licence terms that apply to each.",
    "Vendor shall not include in a Deliverable any open source software whose licence would require Customer to publish its own source code.",
    "Each party shall comply with the licence terms of the third party materials that it uses in connection with the Services.",
    "Vendor shall keep a register of the third party materials used in the Services and in the Deliverables and shall give Customer a copy on request.",
  ]),
  clause(30, "Intellectual Property", [
    "Each party keeps ownership of the intellectual property that it owned before the Effective Date or that it develops independently of this Agreement. Customer keeps ownership of the Customer Materials.",
    "All Work Product, including Work Product that is created specifically for Customer and that Customer has paid for in full, is owned exclusively by Vendor from the moment it is created.",
    "Vendor grants Customer a licence to use the Work Product for the internal business purposes of Customer during the term of this Agreement. The licence may not be transferred or sublicensed.",
    "To the extent that any right in the Work Product belongs to Customer by operation of law, Customer assigns that right to Vendor and shall sign any document that Vendor reasonably needs in order to record the assignment.",
    "Vendor may use the general skills, knowledge and experience that the Vendor Personnel gain in the course of the Services.",
  ]),
  clause(31, "Confidentiality", CONFIDENTIALITY),
  clause(32, "Publicity", [
    "Neither party shall use the name, logo or trademarks of the other party in any press release, advertisement or other public statement without the prior written consent of the other party.",
    "Either party may disclose the existence of this Agreement where the law or the rules of a stock exchange require it to do so.",
    "With the written consent of Customer in each case, Vendor may name Customer in its list of clients.",
  ]),
  clause(33, "Force Majeure", FORCE_MAJEURE),
  clause(34, "Notices", NOTICES),
  clause(35, "Assignment", ASSIGNMENT),
  clause(36, "Relationship of the Parties", [
    "Vendor is an independent contractor. Nothing in this Agreement creates a partnership, a joint venture or a relationship of employer and employee between the parties.",
    "Neither party has the authority to make commitments on behalf of the other or to bind the other in any way.",
    "Each party is responsible for its own staff and for the taxes and social charges that relate to them.",
  ]),
  clause(37, "Third Party Rights", [
    "A person who is not a party to this Agreement has no right to enforce any of its terms, other than an Affiliate of Customer that receives the Services in accordance with clause 2.",
  ]),
  clause(38, "Waiver", [
    "A failure or delay by a party in exercising a right under this Agreement is not a waiver of that right. A waiver is effective only if it is given in writing and applies only to the circumstances for which it is given.",
  ]),
  clause(39, "Severability", SEVERABILITY),
  clause(40, "Entire Agreement", ENTIRE_AGREEMENT),
  clause(41, "Governing Law", [
    "This Agreement and any dispute arising out of or in connection with it are governed by the laws of the State of New York, without regard to its conflict of laws rules.",
    "The state and federal courts sitting in New York County have exclusive jurisdiction to settle any such dispute, and each party submits to the jurisdiction of those courts.",
  ]),
  clause(42, "Counterparts", [
    "This Agreement may be signed in any number of counterparts, each of which is an original and all of which together are one agreement. A signature delivered by electronic means is as effective as a signature on paper.",
  ]),
  {
    heading: "Signatures",
    paragraphs: [
      "Signed for Atlas Ridge Technologies LLC: D. Okonkwo, Chief Operating Officer",
      "Signed for Nexus Corp: Chief Procurement Officer",
    ],
  },
];

const schedules: SampleSection[] = [
  {
    heading: "Schedule A: Service Description",
    paragraphs: [
      "This schedule describes the Services that Vendor provides from the Effective Date. The Services are organised into the towers set out below. A Statement of Work may add detail to a tower but does not reduce what this schedule requires.",
      "Unless a tower says otherwise, Vendor provides the Services on every Business Day during the working hours of the Customer service function, and provides cover for critical incidents at all other times.",
    ],
    pageBreakBefore: true,
  },
  ...towerSections,
  {
    heading: "Schedule B: Fees and Payment",
    paragraphs: [
      "B.1 Total Contract Value: USD 2,400,000. This is the total of the Fees for the Services described in Schedule A over the Initial Term.",
      "B.2 Vendor shall invoice the Fees in equal quarterly instalments, each at the end of the quarter to which it relates.",
      "B.3 Payment terms: Net 60 from the date of invoice. Payments shall be made in US dollars by bank transfer to the account stated on the invoice.",
      "B.4 The Fees for a Renewal Term are charged at the same annual rate as the Fees for the Initial Term, unless the parties agree otherwise in writing before the Renewal Term begins.",
      "B.5 Work that is added by a Change Order is charged at the price stated in that Change Order and is invoiced together with the next quarterly instalment.",
      "B.6 The Fees are fixed. They are not adjusted for inflation, for changes in exchange rates, or for changes in the costs of Vendor.",
    ],
    pageBreakBefore: true,
  },
  {
    heading: "Schedule C: Service Levels",
    paragraphs: [
      "This schedule sets out the service levels that Vendor shall meet under clause 5 and how each of them is measured.",
    ],
    pageBreakBefore: true,
  },
  {
    heading: "C.1 Incident Priorities",
    paragraphs: [
      "A critical incident is one in which a production application cannot be used by a substantial number of the customers of Customer, or in which a core business process of Customer has stopped.",
      "A high incident is one in which an important function of a production application is unavailable or badly degraded and there is no acceptable workaround.",
      "A medium incident is one that affects a limited number of users or for which an acceptable workaround exists. A low incident is a minor fault, a cosmetic defect or a request for information.",
      "The priority of an incident is set by Vendor when the incident is logged. Customer may ask Vendor to raise or lower the priority, and Vendor shall not unreasonably refuse.",
      "The response and resolution times for each priority are set out in the support desk procedures agreed between the service managers, and are measured from the moment the incident is logged.",
    ],
  },
  ...serviceLevelSections,
  {
    heading: "Schedule D: Governance and Exit",
    paragraphs: [
      "This schedule names the governance roles and meetings referred to in clause 12 and sets out the outline of the exit plan referred to in clause 25.",
    ],
    pageBreakBefore: true,
  },
  {
    heading: "D.1 Roles",
    paragraphs: [
      "Each party shall appoint a service manager who is responsible for the day to day running of the Services and who is the first point of contact for the other party.",
      "Vendor shall appoint an account director who is responsible for the overall relationship and for the commercial matters that arise under this Agreement. Customer shall appoint a procurement lead for the same purpose.",
      "The Key Personnel of Vendor at the Effective Date are the Vendor Service Manager, the Platform Operations Manager and the Support Desk Manager.",
      "A party that changes one of its representatives shall tell the other party in writing who the new representative is.",
    ],
  },
  ...forumSections,
  {
    heading: "D.6 Outline of the Exit Plan",
    paragraphs: [
      "The exit plan shall list the Services to be handed over and the order in which they are to be handed over, with a proposed timetable for each.",
      "The exit plan shall describe the documentation, the runbooks, the configuration records and the open tickets that Vendor will hand over, and the format in which each of them will be supplied.",
      "The exit plan shall set out the knowledge transfer sessions that Vendor will run for the people who are to take over the Services, and the number of Vendor Personnel who will be available to support them.",
      "The exit plan shall identify the third party contracts and licences that are used only for the Services, and shall state for each of them whether it can be transferred to Customer or to a new supplier.",
      "The exit plan shall name the people on each side who are responsible for carrying it out and shall describe how progress will be reported to the service review.",
    ],
  },
];

export const masterServicesAgreement: SampleDoc = {
  name: "master-services-agreement",
  title: "Master Services Agreement",
  formats: ["pdf"],
  sections: [...body, ...schedules],
};
