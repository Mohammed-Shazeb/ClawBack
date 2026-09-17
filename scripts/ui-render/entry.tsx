/**
 * Offline render harness for the dispute-letter UI.
 *
 * Server-renders the real `CaseLetter` component with fixture data and asserts
 * the resulting markup, so the letter screen can be verified without a live
 * Convex connection (this environment blocks the WebSocket the real hooks need).
 *
 * Bundled with esbuild so `convex/react` and the generated API can be aliased.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { CaseLetter } from "../../components/case-letter";
import { CaseCommunication } from "../../components/case-communication";
import type { Id } from "../../convex/_generated/dataModel";

let checks = 0;
let failures = 0;
function check(name: string, passed: boolean, detail?: unknown) {
  checks += 1;
  if (passed) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${name}${detail !== undefined ? ` — ${String(detail)}` : ""}`);
}
function section(name: string) {
  console.log(`\n${name}`);
}

const BODY = [
  "I am writing about the security deposit of $1500.00 held for my tenancy. The itemized statement I received lists $1150.00 in deductions. I am requesting that the charges described below be reviewed and that $500.00 of the deposit be reimbursed to me.",
  "Based on the available housing guidance, I am requesting clarification and reimbursement for the deductions described below. I am not asserting that any deduction was unlawful; I am asking that these charges be reviewed against the standards published for this jurisdiction.",
  'The statement includes "Painting" at $300.00. The guidance published by the California Department of Real Estate indicates: "Deductions must be itemized in writing." Based on that guidance, this charge may include an amount attributable to ordinary wear rather than to damage caused during the tenancy.',
  "If any of these charges were based on information I have not seen, I would welcome the supporting documentation so I can review it. Thank you for your time and for reviewing this request.",
].join("\n\n");

const LETTER = {
  _id: "letter1",
  caseId: "case1",
  content: `To: Property Manager\nSubject: Request for review of security deposit deductions\n\n${BODY}`,
  recipient: "Property Manager",
  subject: "Request for review of security deposit deductions",
  body: BODY,
  version: 3,
  status: "AWAITING_APPROVAL",
  pipelineStatus: "READY",
  supportingSourceIds: ["src1", "src2"],
  depositAmount: 1500,
  totalDeductions: 1150,
  potentiallyDisputableAmount: 500,
  createdAt: Date.now() - 60000,
  updatedAt: Date.now() - 1000,
};

const SOURCES = [
  {
    _id: "src1",
    title: "Security Deposits",
    url: "https://www.dre.ca.gov/consumers/security-deposits.html",
    authority: "California Department of Real Estate",
    jurisdiction: "California",
    relevantText: "Deductions must be itemized in writing and returned within 21 days.",
  },
  {
    _id: "src2",
    title: "Security Deposit Self-Help",
    url: "https://courts.ca.gov/selfhelp-security-deposit.html",
    authority: "California Courts",
    jurisdiction: "California",
    relevantText: "A landlord who deducts painting for ordinary wear may be required to return that portion.",
  },
];

const READY = { ready: true, reason: null, assessmentsPending: false };

const LANDLORD_EMAIL = "landlord@example.com";

const REPLY_BODY =
  "After reviewing your letter I can offer to refund $150 for the painting. I have attached invoices for the carpet. Please send me photos of the cabinet if you disagree.";

/** A reading of the reply above, exactly as the pipeline stores one. */
const READING = {
  summary:
    "The landlord offers to refund $150 for the painting, refers to invoices for the carpet, and asks for photographs of the cabinet.",
  acceptsDispute: false,
  rejectsDispute: false,
  requestsMoreInformation: true,
  offersPartialReimbursement: true,
  offeredAmount: 150,
  providesNewEvidence: true,
  newEvidenceSummary: "Invoices for the carpet, attached to the reply.",
  followUpQuestions: ["Photographs of the cabinet"],
  missingInformation: [],
};

const COMMUNICATION = [
  {
    _id: "out1",
    direction: "OUTBOUND",
    subject: LETTER.subject,
    body: BODY,
    sender: "case-abc@agentmail.to",
    recipient: LANDLORD_EMAIL,
    sentAt: Date.now() - 90_000,
    createdAt: Date.now() - 91_000,
    sendStatus: "SENT",
  },
  {
    _id: "in1",
    direction: "INBOUND",
    subject: `Re: ${LETTER.subject}`,
    body: REPLY_BODY,
    sender: LANDLORD_EMAIL,
    recipient: "case-abc@agentmail.to",
    receivedAt: Date.now() - 30_000,
    createdAt: Date.now() - 30_000,
    responseAnalysisStatus: "COMPLETED",
    responseAnalysis: READING,
  },
];

const scenarios = {
  draft: {
    fixtures: {
      "letters:getForCase": { ...LETTER, status: "DRAFT" },
      "letters:getDraftReadiness": READY,
      "letters:getSupportingSources": SOURCES,
    },
  },
  awaiting: {
    fixtures: {
      "letters:getForCase": LETTER,
      "letters:getDraftReadiness": READY,
      "letters:getSupportingSources": SOURCES,
    },
  },
  approved: {
    fixtures: {
      "letters:getForCase": { ...LETTER, status: "APPROVED", approvedAt: Date.now() },
      "letters:getDraftReadiness": READY,
      "letters:getSupportingSources": SOURCES,
    },
  },
  sent: {
    fixtures: {
      "letters:getForCase": {
        ...LETTER,
        status: "SENT",
        approvedAt: Date.now() - 120_000,
        sentAt: Date.now() - 90_000,
      },
      "letters:getDraftReadiness": READY,
      "letters:getSupportingSources": SOURCES,
    },
  },
  insufficient: {
    fixtures: {
      "letters:getForCase": null,
      "letters:getDraftReadiness": {
        ready: false,
        reason:
          "This case does not have enough assessed evidence to draft a dispute letter yet. At least one deduction needs an assessment that is potentially disputable and supported by an official source.",
        assessmentsPending: false,
      },
      "letters:getSupportingSources": [],
    },
  },
  generating: {
    fixtures: {
      "letters:getForCase": { ...LETTER, pipelineStatus: "GENERATING", version: 0 },
      "letters:getDraftReadiness": READY,
      "letters:getSupportingSources": [],
    },
  },
  failed: {
    fixtures: {
      "letters:getForCase": {
        ...LETTER,
        pipelineStatus: "FAILED",
        pipelineError: "The drafted letter did not meet the evidence and language requirements, so it was not saved.",
      },
      "letters:getDraftReadiness": READY,
      "letters:getSupportingSources": [],
    },
  },
  empty: {
    fixtures: {
      "letters:getForCase": null,
      "letters:getDraftReadiness": READY,
      "letters:getSupportingSources": [],
    },
  },
};

type Fixtures = Record<string, unknown>;

declare global {
  var __FIXTURES__: Fixtures | undefined;
}

function render(fixtures: Fixtures, landlordEmail?: string): string {
  globalThis.__FIXTURES__ = fixtures;
  return renderToStaticMarkup(
    createElement(CaseLetter, {
      caseId: "case1",
      userId: "user1" as Id<"users">,
      potentiallyDisputableAmount: 500,
      landlordEmail,
    })
  );
}

function renderCommunication(fixtures: Fixtures): string {
  globalThis.__FIXTURES__ = fixtures;
  return renderToStaticMarkup(
    createElement(CaseCommunication, {
      caseId: "case1",
      userId: "user1" as Id<"users">,
    })
  );
}

const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

// --- The letter as a document -------------------------------------------------------
section("The letter renders as a document");
{
  const html = render(scenarios.awaiting.fixtures);
  const body = text(html);

  check("the screen is titled Dispute letter", /Dispute letter/.test(body));
  check("the letter renders a To field", /To Property Manager/.test(body), body.slice(0, 160));
  check("the letter renders a Subject field", /Subject Request for review/.test(body));
  check("the body renders in full", /ordinary wear rather than to damage/.test(body));
  check(
    "the body is rendered as paragraphs, not one blob",
    (html.match(/whitespace-pre-wrap/g) ?? []).length >= 4,
    `${(html.match(/whitespace-pre-wrap/g) ?? []).length} paragraphs`
  );
  check("the letter is not rendered as a chat message", !/chat|assistant|bubble/i.test(html));
  check("the letter shows its version", /Draft v3/.test(body), body.slice(-300));
  check("the letter shows an awaiting-approval state", /Awaiting approval/.test(body));
  check(
    "the awaiting state explains the next step",
    /awaiting your approval/.test(body)
  );
}

// --- Actions available on a draft -----------------------------------------------------
section("A draft offers the full workflow");
{
  const body = text(render(scenarios.draft.fixtures));
  for (const action of ["Edit", "Regenerate", "Present for approval", "Approve"]) {
    check(`the draft offers ${action}`, new RegExp(action, "i").test(body));
  }
  check("the draft does not offer Start a new draft", !/Start a new draft/i.test(body));
  check("the draft shows its version", /Draft v3/.test(body));
  check("the draft never offers to send", !/\bSend\b/.test(body));
  check(
    "a draft that was already presented offers no second Present action",
    !/Present for approval/.test(text(render(scenarios.awaiting.fixtures)))
  );
}

// --- Approval state -------------------------------------------------------------------
section("An approved letter is locked and ready to send");
{
  const html = render(scenarios.approved.fixtures);
  const body = text(html);

  check("approval is shown as ready to send", /Approved — ready to send/.test(body), body.slice(0, 200));
  check(
    "the approved state says nothing has been sent yet",
    /Nothing has been sent yet/.test(body),
    body.slice(0, 240)
  );
  check("an approved letter offers no Edit", !/\bEdit\b/.test(body));
  check("an approved letter offers no Regenerate", !/Regenerate/.test(body));
  check("an approved letter offers no Approve", !/\bApprove\b/.test(body));
  check("an approved letter offers a new draft", /Start a new draft/.test(body));
  check(
    "the approved letter explains it is locked",
    /approved letter is locked/.test(body)
  );
}

// --- Sending: the address and the explicit send action ---------------------------------
section("An approved letter offers an explicit send");
{
  const html = render(scenarios.approved.fixtures, LANDLORD_EMAIL);
  const body = text(html);

  check("the send panel asks where to send it", /Send to/.test(body), body.slice(0, 240));
  check("the send panel offers to save the address", /Save address/.test(body));
  check("the send panel offers the send action", /Send dispute/.test(body));
  check(
    "the panel says Clawback will not guess the address",
    /will not guess it/.test(body)
  );
  check(
    "the panel says the letter is only sent on confirmation",
    /only sent once you confirm/.test(body)
  );
  check(
    "the landlord's saved address is prefilled",
    html.includes(`value="${LANDLORD_EMAIL}"`),
    "no prefilled address"
  );
  check("the approved letter still shows the document", /Subject Request for review/.test(body));
  check("nothing claims it has already been sent", !/Dispute sent/.test(body));
  check(
    "an approved letter never auto-sends",
    !/sending now|sent automatically/i.test(body)
  );
}

// --- Sending: after the dispute has gone -------------------------------------------------
section("A sent letter is locked and shows the send");
{
  const html = render(scenarios.sent.fixtures, LANDLORD_EMAIL);
  const body = text(html);

  check("the sent banner is shown", /Dispute sent/.test(body), body.slice(0, 240));
  check("the banner names the recipient", /Sent to landlord@example\.com/.test(body));
  check(
    "the banner points at the communication section",
    /communication section below/.test(body)
  );
  check("a sent letter offers no Edit", !/\bEdit\b/.test(body));
  check("a sent letter offers no Regenerate", !/Regenerate/.test(body));
  check("a sent letter offers no second send", !/Send dispute/.test(body));
  check("a sent letter offers no send panel at all", !/Save address/.test(body));
  check("a sent letter offers a new draft", /Start a new draft/.test(body));
  check(
    "the sent letter explains why it is locked",
    /record of what was sent cannot change/.test(body)
  );
  check("the sent letter is still shown in full", /ordinary wear rather than to damage/.test(body));
}

// --- Evidence panel ---------------------------------------------------------------------
section("The evidence panel shows real sources");
{
  const html = render(scenarios.draft.fixtures);
  const body = text(html);

  check("the panel is titled Supporting evidence", /Supporting evidence/.test(body));
  check("the panel shows the requested refund", /Requested refund/.test(body));
  check("a source title is shown", /Security Deposits/.test(body));
  check("a source authority is shown", /California Department of Real Estate/.test(body));
  check("a source jurisdiction is shown", /California/.test(body));
  check(
    "the real stored URL is linked",
    html.includes('href="https://www.dre.ca.gov/consumers/security-deposits.html"')
  );
  check(
    "the second real stored URL is linked",
    html.includes('href="https://courts.ca.gov/selfhelp-security-deposit.html"')
  );
  check(
    "no fabricated URL is present",
    !html.includes("example.com") && !html.includes("localhost")
  );
  check(
    "the relevant passage is quoted",
    /Deductions must be itemized in writing/.test(body)
  );
}

// --- Insufficient evidence ------------------------------------------------------------------
section("A case without evidence refuses to draft");
{
  const body = text(render(scenarios.insufficient.fixtures));
  check("the real reason is shown", /does not have enough assessed evidence/.test(body));
  check("the refusal explains what is needed", /potentially disputable/.test(body));
  check("no letter document is rendered", !/Subject Request for review/.test(body));
  check("no evidence panel is rendered", !/Supporting evidence/.test(body));
  check("no approval action is offered", !/\bApprove\b/.test(body));
}

// --- Generation states -------------------------------------------------------------------------
section("Generation states are honest");
{
  const generating = text(render(scenarios.generating.fixtures));
  check("a generating letter says it is drafting", /Drafting the letter from the evidence/.test(generating));
  check("no fake progress percentage is shown", !/\d{1,3}\s?%/.test(generating));
  check("no letter document is shown while generating", !/Subject Request for review/.test(generating));

  const failed = text(render(scenarios.failed.fixtures));
  check("a failed generation shows the real error", /did not meet the evidence and language requirements/.test(failed));
  check("a failed generation offers a retry", /Try again/.test(failed));
  check("a failed generation renders no document", !/Subject Request for review/.test(failed));

  const empty = text(render(scenarios.empty.fixtures));
  check("an undrafted case offers to draft", /Draft dispute letter/.test(empty));
  check("an undrafted case shows no document", !/Subject Request for review/.test(empty));
}

// --- Communication: the two-way loop -----------------------------------------------------
section("The communication section shows the whole loop");
{
  const html = renderCommunication({ "emails:listCommunication": COMMUNICATION });
  const body = text(html);

  check("the section is titled Communication", /Communication/.test(body));
  check(
    "the section explains what it holds",
    /The dispute sent to the landlord, and their replies/.test(body)
  );
  check("the outbound dispute is listed", /You → Landlord/.test(body));
  check("the inbound reply is listed", /Landlord → You/.test(body));
  check("the outbound message shows it was sent", /Dispute letter sent/.test(body));
  check("the reply shows it was received and read", /Response received and read/.test(body));
  check(
    "the landlord's own words are shown verbatim",
    body.includes("offer to refund $150 for the painting")
  );
  check("the reading is labelled as a reading", /What the reply appears to say/.test(body));
  check("the landlord's message is labelled as theirs", /What the landlord wrote/.test(body));
  check("the reading is labelled not legal advice", /not legal advice/.test(body));
  check("the reading shows the offered amount", /Offers \$150\.00/.test(body));
  check("the reading flags the request for information", /Asks for more information/.test(body));
  check("the reading flags new material", /Provides new material/.test(body));
  check("the new material is described", /Invoices for the carpet/.test(body));
  check("the follow-up request is listed", /Photographs of the cabinet/.test(body));
  check(
    "a flag the reply does not support is not shown",
    !/Accepts the dispute/.test(body) && !/Rejects the dispute/.test(body)
  );
  check(
    "the reading never asserts a legal conclusion",
    !/\billegal\b|\bunlawful\b|\bguarantee\b|\bwill win\b/i.test(body)
  );
  check("the section offers no AI chat affordance", !/chat|assistant/i.test(html));
  check(
    "the section makes no recovery claim",
    !/recovered \$|AI recovered|guaranteed recovery/i.test(body)
  );
  check("a response can be viewed or hidden", /Hide response|View response/.test(body));
}

section("An empty communication section is honest");
{
  const body = text(renderCommunication({ "emails:listCommunication": [] }));
  check("an empty section says there are no messages", /No messages yet/.test(body));
  check(
    "it explains what will appear there",
    /Anything the landlord sends back will appear here/.test(body)
  );
  check("it does not invent a message", !/You → Landlord/.test(body));
}

section("A reply that could not be read stays honest");
{
  const body = text(
    renderCommunication({
      "emails:listCommunication": [
        {
          ...COMMUNICATION[1],
          responseAnalysisStatus: "FAILED",
          responseAnalysis: undefined,
          responseAnalysisError: "The reading did not match the expected structure.",
        },
      ],
    })
  );

  check("a failed reading says it could not be read", /could not be read automatically/.test(body));
  check("the real reason is shown", /did not match the expected structure/.test(body));
  check("the landlord's message is still shown", /offer to refund \$150/.test(body));
  check("a retry is offered", /Try reading it again/.test(body));
  check("no reading is invented", !/What the reply appears to say/.test(body));
}

console.log(`\n${checks - failures}/${checks} UI render checks passed`);
if (failures > 0) process.exit(1);
