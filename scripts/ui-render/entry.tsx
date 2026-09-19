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

import { AppShell } from "../../components/app-shell";
import { CaseLetter } from "../../components/case-letter";
import { Dashboard } from "../../components/dashboard";
import { CaseCommunication } from "../../components/case-communication";
import { CaseDeductions } from "../../components/case-deductions";
import { CaseFinances } from "../../components/case-finances";
import { CaseInvestigation } from "../../components/case-investigation";
import { CaseOverview } from "../../components/case-overview";
import { CaseStatement } from "../../components/case-statement";
import { SignIn } from "../../components/sign-in";
import { WorkspaceGate } from "../../components/workspace-gate";
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
    deductionId: "ded1",
    title: "Security Deposits",
    url: "https://www.dre.ca.gov/consumers/security-deposits.html",
    authority: "California Department of Real Estate",
    jurisdiction: "California",
    relevantText: "Deductions must be itemized in writing and returned within 21 days.",
  },
  {
    _id: "src2",
    deductionId: "ded1",
    title: "Security Deposit Self-Help",
    url: "https://courts.ca.gov/selfhelp-security-deposit.html",
    authority: "California Courts",
    jurisdiction: "California",
    relevantText: "A landlord who deducts painting for ordinary wear may be required to return that portion.",
  },
];

/**
 * The deductions the letter rests on. The evidence panel groups sources by the
 * deduction they support, so the fixture has to carry the relationship the real
 * data carries.
 */
const DEDUCTIONS = [
  {
    _id: "ded1",
    description: "Painting",
    amount: 300,
    assessment: "POTENTIALLY_DISPUTABLE",
    potentiallyDisputableAmount: 300,
    assessmentSourceIds: ["src1", "src2"],
  },
  {
    _id: "ded2",
    description: "Broken cabinet",
    amount: 400,
    assessment: "LIKELY_VALID",
    potentiallyDisputableAmount: 0,
    assessmentSourceIds: ["src1"],
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
  /** The session state `useConvexAuth` reports. Defaults to signed in. */
  var __AUTH__: { isLoading: boolean; isAuthenticated: boolean } | undefined;
}

function render(fixtures: Fixtures, landlordEmail?: string): string {
  globalThis.__FIXTURES__ = fixtures;
  return renderToStaticMarkup(
    createElement(CaseLetter, {
      caseId: "case1",
      userId: "user1" as Id<"users">,
      potentiallyDisputableAmount: 500,
      landlordEmail,
      deductions: DEDUCTIONS,
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

/**
 * Renders the whole case page. `useQuery` in the harness returns whatever the
 * fixture holds, so `{"cases:get": null}` reproduces the one case the page must
 * handle without pretending: a case that is not there.
 */
/**
 * Renders the whole case page. `useQuery` in the harness returns whatever the
 * fixture holds, so `{"cases:get": null}` reproduces the one case the page must
 * handle without pretending: a case that is not there.
 *
 * `userId` is a plain prop — the component no longer reaches for the session
 * itself — which is what lets the whole case screen be rendered offline. The
 * identity decision lives in `WorkspaceGate`, which this harness does not
 * render; the gate has its own section below.
 */
/** The row `users:current` returns for a signed-in caller. */
const SIGNED_IN_USER = {
  _id: "user1",
  email: "renter@example.com",
  name: "Renter",
};

function renderOverview(fixtures: Fixtures): string {
  globalThis.__FIXTURES__ = { "users:current": SIGNED_IN_USER, ...fixtures };
  return renderToStaticMarkup(
    createElement(CaseOverview, { caseId: "case1", userId: "user1" as Id<"users"> })
  );
}

// --- Fixtures for the case screens -------------------------------------------------

/** Deposit $1,500, deductions $1,000, potentially disputable $850. */
const FINANCES = {
  depositAmount: 1500,
  totalDeductions: 1000,
  potentiallyDisputableAmount: 850,
  // 1000 of deductions = 850 disputable + 150 likely valid; 500 was never withheld.
  likelyValidAmount: 150,
  deductionCount: 4,
  assessedCount: 4,
};

const DEDUCTION_ROWS = [
  {
    _id: "d1",
    description: "Carpet replacement",
    amount: 450,
    category: "ORDINARY_WEAR",
    researchStatus: "COMPLETED",
    researchQuestion: "May a California landlord charge a departing tenant for carpet replacement?",
    assessmentStatus: "COMPLETED",
    assessment: "POTENTIALLY_DISPUTABLE",
    assessmentReason:
      "The retrieved guidance indicates deductions must be for damage beyond ordinary wear, and this charge appears to relate to ordinary wear.",
    potentiallyDisputableAmount: 450,
    assessmentSourceIds: ["src1"],
    assessmentMissingInformation: [],
  },
  {
    _id: "d2",
    description: "Cleaning",
    amount: 250,
    category: "TENANT_DAMAGE",
    researchStatus: "COMPLETED",
    assessmentStatus: "COMPLETED",
    assessment: "LIKELY_VALID",
    assessmentReason:
      "The statement attributes this to cleaning required after the tenancy, which the guidance treats as a permitted deduction.",
    potentiallyDisputableAmount: 0,
    assessmentSourceIds: ["src1"],
    assessmentMissingInformation: [],
  },
  {
    _id: "d3",
    description: "Painting",
    amount: 300,
    category: "ORDINARY_WEAR",
    researchStatus: "COMPLETED",
    assessmentStatus: "COMPLETED",
    assessment: "NEEDS_MORE_INFORMATION",
    assessmentReason:
      "The retrieved passages do not establish how long the previous paint lasted, so the proportion attributable to wear cannot be established.",
    potentiallyDisputableAmount: 0,
    assessmentSourceIds: [],
    assessmentMissingInformation: ["The age of the previous paint"],
  },
];

const SOURCE_ROWS = [
  {
    _id: "src1",
    deductionId: "d1",
    title: "Security Deposits",
    url: "https://www.dre.ca.gov/consumers/security-deposits.html",
    authority: "California Department of Real Estate",
    jurisdiction: "California",
    relevantText: "Deductions must be itemized in writing and may not be taken for ordinary wear.",
    retrievedAt: Date.now() - 120_000,
  },
];

const TIMELINE_ROWS = [
  { _id: "t1", type: "EMAIL_RECEIVED", description: "Deposit statement received", createdAt: Date.now() - 300_000 },
  { _id: "t2", type: "ANALYSIS_COMPLETED", description: "3 deductions identified", createdAt: Date.now() - 280_000 },
  { _id: "t3", type: "RESEARCH_COMPLETED", description: "Official sources retrieved", createdAt: Date.now() - 240_000 },
  { _id: "t4", type: "ASSESSMENT_COMPLETED", description: "Deductions assessed", createdAt: Date.now() - 200_000 },
];

const INVESTIGATION = {
  jurisdiction: "California",
  status: "EVIDENCE_FOUND",
  deductionCount: 3,
  sourceCount: 1,
  connectedSourceCount: 1,
  assessedCount: 3,
  letterExists: false,
  letterReady: false,
  letterStatus: undefined as string | undefined,
  timeline: TIMELINE_ROWS,
};

const STATEMENT_EMAIL = {
  _id: "e1",
  direction: "INBOUND",
  subject: "Security deposit statement",
  sender: "landlord@example.com",
  recipient: "case-abc@agentmail.to",
  receivedAt: Date.now() - 300_000,
  processingStatus: "PROCESSED",
  processingError: undefined as string | undefined,
  attachments: [{ filename: "statement.pdf", contentType: "application/pdf", size: 48_000 }],
  createdAt: Date.now() - 300_000,
};

function renderFinances(overrides: Partial<typeof FINANCES> = {}, assessed = true): string {
  return renderToStaticMarkup(
    createElement(CaseFinances, { ...FINANCES, ...overrides, assessed })
  );
}

function renderDeductions(
  rows: typeof DEDUCTION_ROWS = DEDUCTION_ROWS,
  sources: typeof SOURCE_ROWS = SOURCE_ROWS
): string {
  return renderToStaticMarkup(
    createElement(CaseDeductions, {
      userId: "user1" as Id<"users">,
      deductions: rows,
      sources,
      isAnalyzing: false,
    })
  );
}

function renderInvestigation(overrides: Partial<typeof INVESTIGATION> = {}): string {
  return renderToStaticMarkup(
    createElement(CaseInvestigation, { input: { ...INVESTIGATION, ...overrides } })
  );
}

function renderStatement(emails: Array<typeof STATEMENT_EMAIL>, deductionCount = 3): string {
  return renderToStaticMarkup(
    createElement(CaseStatement, {
      userId: "user1" as Id<"users">,
      emails,
      deductionCount,
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
  check("the letter shows its version", /\bv3\b/.test(body), body.slice(-300));
  check("the letter shows an awaiting-approval state", /Awaiting approval/.test(body));
  check(
    "the awaiting state explains the next step",
    /approve it to mark it ready to send/i.test(body)
  );
  check(
    "the awaiting state says approving does not send",
    /Approving does not send anything/i.test(body)
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
  check("the draft shows its version", /\bv3\b/.test(body));
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

// --- The letter and its evidence are linked both ways ----------------------------------------
section("A paragraph can be traced back to the evidence behind it");
{
  const html = render(scenarios.draft.fixtures);
  const body = text(html);

  const references = html.match(/Show the evidence behind this paragraph/g) ?? [];

  // The fixture letter has four paragraphs and exactly one of them names a
  // stored authority. Over-linking would claim a paragraph rests on evidence it
  // does not name, so the count is asserted, not just the presence.
  check(
    "exactly the paragraph naming a source is interactive",
    references.length === 1,
    `${references.length} interactive paragraph(s)`
  );
  check(
    "every paragraph is still rendered",
    (html.match(/whitespace-pre-wrap/g) ?? []).length === 4,
    `${(html.match(/whitespace-pre-wrap/g) ?? []).length} paragraph(s)`
  );
  check(
    "the reference names the authority it links to",
    /Show the evidence behind this paragraph — California Department of Real Estate/.test(html)
  );
  check(
    "the reference is a real control, not a styled span",
    /<button[^>]*aria-pressed="false"[^>]*>/.test(html)
  );
  check(
    "the source it points at is addressable",
    html.includes('id="source-src1"'),
    "source-src1 missing"
  );

  // The drafting rules forbid a source label, URL or id in the letter body, so
  // the link must be derived from the prose. A citation marker appearing in the
  // body would mean the letter started citing sources it was told not to cite.
  check(
    "the letter body carries no citation markers",
    !/\[S?\d\]/.test(body) && !/Source \d\d:/.test(body),
    "a citation marker leaked into the letter body"
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
  // Scoped to the reading itself, not the whole section. The section also
  // carries the sent dispute, whose own text deliberately says "I am not
  // asserting that any deduction was unlawful" — a whole-section scan flags that
  // correct sentence and so proves nothing about the reading.
  const readingStart = body.indexOf("What the reply appears to say");
  const readingEnd = body.indexOf("This is an automatic reading");
  const reading =
    readingStart >= 0 && readingEnd > readingStart ? body.slice(readingStart, readingEnd) : null;

  check(
    "the reading is identifiable in the render",
    reading !== null,
    "the reading block could not be located, so it cannot be checked"
  );
  check(
    "the reading never asserts a legal conclusion",
    reading !== null && !/\billegal\b|\bunlawful\b|\bguarantee\b|\bwill win\b/i.test(reading),
    reading === null ? "no reading found" : reading.slice(0, 200)
  );
  check("the section offers no AI chat affordance", !/chat|assistant/i.test(html));
  check(
    "the section makes no recovery claim",
    !/recovered \$|AI recovered|guaranteed recovery/i.test(body)
  );
  check("a response can be viewed or hidden", /Hide response|View response/.test(body));
}

section("The record of what was sent is readable");
{
  const html = renderCommunication({ "emails:listCommunication": COMMUNICATION });
  const body = text(html);

  check(
    "the sent dispute can be opened",
    /View what was sent/.test(body),
    "no control to read the message that was sent"
  );

  // The letter section above shows the *current* letter. After a revision that
  // is no longer what the landlord received, so the sent message has to be
  // readable here — but collapsed, or the thread becomes unreadable.
  check(
    "the sent letter is not expanded before it is asked for",
    !body.includes("I am writing about the security deposit"),
    "the whole sent letter is rendered by default"
  );
  check(
    "the landlord's reply is expanded without being asked for",
    body.includes("offer to refund $150 for the painting"),
    "the reply is collapsed, hiding the answer the renter opened the section for"
  );
  check(
    "the two directions are labelled distinctly",
    /You → Landlord/.test(body) && /Landlord → You/.test(body)
  );
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

// --- The money hierarchy ---------------------------------------------------------------
section("The money block leads with the disputable figure");
{
  const body = text(renderFinances());

  check("the headline is the potentially disputable amount", /Potentially disputable/.test(body));
  check("the headline figure is rendered", /\$850\.00/.test(body), body.slice(0, 300));
  check("the security deposit is shown as context", /Security deposit/.test(body));
  check("the deposit figure is rendered", /\$1,500\.00/.test(body));
  check("the total deductions are shown as context", /Total deductions/.test(body));
  check("the deductions figure is rendered", /\$1,000\.00/.test(body));
  check("the share of deductions is stated", /85% of the deductions claimed/.test(body));

  // The single most important honesty constraint in the product. The word
  // "recovered" is allowed only in a negating sentence, never attached to a figure.
  check("the figure carries an explicit disclaimer", /not money recovered/.test(body));
  check(
    "no amount is ever presented as recovered",
    !/\$\s?[\d,.]+\s+(?:has been\s+)?recovered/i.test(body) &&
      !/you (?:have|will) recover/i.test(body) &&
      !/\bguaranteed\b|\byou will win\b/i.test(body),
    body.match(/.{0,40}recover.{0,40}/gi)?.join(" | ")
  );
  check(
    "the figures are disclosed as server-computed",
    /computed on the server from the stored deduction records/.test(body)
  );

  // --- The deposit decomposition -------------------------------------------------
  // The three parts must account for the whole deposit, and each must be named
  // for what the data actually supports.
  check("the amount never withheld is shown", /Not withheld/.test(body));
  check(
    "the never-withheld figure is deposit less deductions",
    /\$500\.00/.test(body),
    body.slice(0, 400)
  );
  check("the likely-valid total is shown", /likely valid/i.test(body));
  check("the likely-valid figure is rendered", /\$150\.00/.test(body));
  check(
    "the deductions reviewed count is shown",
    /Deductions reviewed[\s\S]{0,80}4[\s\S]{0,20}\/\s*4/.test(body),
    body.slice(0, 500)
  );
  check(
    "every review counts as complete when all are assessed",
    /Every deduction has an assessment/.test(body)
  );

  // The naming constraint. The app knows the deposit was not deducted; it cannot
  // know the money was handed back. "Returned" would assert what the data cannot
  // support, so it must not appear attached to a figure.
  check(
    "no figure is described as returned to the renter",
    !/\$[\d,.]+\s+(?:returned|refunded|recovered)/i.test(body) &&
      !/returned to you|already returned/i.test(body),
    body.match(/.{0,50}(?:returned|refunded).{0,50}/gi)?.join(" | ")
  );
  check(
    "the uncertainty about the never-withheld amount is stated",
    /cannot tell whether this has been returned/.test(body)
  );

  const partial = text(renderFinances({ assessedCount: 2, deductionCount: 4 }));
  check(
    "a partly reviewed case says assessments are still running",
    /Assessments still running/.test(partial)
  );
  check(
    "a partly reviewed case does not claim every deduction was assessed",
    !/Every deduction has an assessment/.test(partial)
  );

  // A statement claiming more than the deposit held must not render a negative.
  const overclaimed = text(renderFinances({ totalDeductions: 2400, depositAmount: 1500 }));
  check(
    "a statement claiming more than the deposit never renders a negative",
    !/-\$/.test(overclaimed),
    overclaimed.match(/-?\$[\d,.]+/g)?.join(" ")
  );

  const unassessed = text(renderFinances({ potentiallyDisputableAmount: 0 }, false));
  check(
    "an unassessed case refuses to claim any amount",
    /not claiming any amount as disputable yet/.test(unassessed)
  );
  check("an unassessed case does not show a share", !/% of the deductions claimed/.test(unassessed));
  check(
    "an unassessed case shows no decomposition bar",
    !/likely valid/i.test(unassessed)
  );
}

// --- The evidence workspace ------------------------------------------------------------
section("Each deduction carries its finding and its evidence");
{
  const html = renderDeductions();
  const body = text(html);

  check("the panel is titled Deductions", /Deductions/.test(body));
  check("every deduction description is listed", /Carpet replacement/.test(body) && /Cleaning/.test(body) && /Painting/.test(body));
  check("the itemized total is shown", /Itemized total/.test(body));
  check(
    "the amount in question is shown on the row itself",
    /in question/.test(body),
    body.slice(0, 300)
  );
  check(
    "a deduction the evidence supported is not marked as in question",
    (body.match(/in question/g) ?? []).length < DEDUCTION_ROWS.length,
    `${(body.match(/in question/g) ?? []).length} of ${DEDUCTION_ROWS.length} rows flagged`
  );
  check("a disputable deduction is labelled", /Potentially disputable/.test(body));
  check("a valid deduction is labelled", /Likely valid/.test(body));
  check("an unresolved deduction is labelled", /Needs more information/.test(body));
  check(
    "the finding explains itself rather than asserting a conclusion",
    /ordinary wear/.test(body)
  );

  // Traceability: the source behind a finding must be visible.
  check("the supporting source title is shown", /Security Deposits/.test(body));
  check("the source authority is shown", /California Department of Real Estate/.test(body));
  check("the source jurisdiction is shown", /California/.test(body));
  check("the source passage is quoted", /may not be taken for ordinary wear/.test(body));
  check(
    "the real stored source URL is linked",
    html.includes('href="https://www.dre.ca.gov/consumers/security-deposits.html"')
  );
  check(
    "no fabricated source URL is present",
    !/example\.com|localhost/.test(html.replace(/landlord@example\.com/g, ""))
  );

  // The workspace shows one deduction at a time, so the deduction that carries
  // missing information has to be selected to see that state at all.
  const paintingFirst = text(
    renderDeductions([DEDUCTION_ROWS[2], DEDUCTION_ROWS[0], DEDUCTION_ROWS[1]])
  );
  check(
    "missing information is surfaced for the deduction that has it",
    /age of the previous paint/i.test(paintingFirst)
  );
  check(
    "a deduction with no cited source says so rather than inventing one",
    /No passage was retrieved|no source|could not be assessed/i.test(paintingFirst) ||
      !/dre\.ca\.gov/.test(paintingFirst)
  );

  const withoutSources = text(renderDeductions(DEDUCTION_ROWS, []));
  check(
    "a deduction with no stored source renders no source card",
    !/California Department of Real Estate/.test(withoutSources)
  );
  check(
    "a deduction with no stored source does not fabricate a passage",
    !/may not be taken for ordinary wear/.test(withoutSources)
  );
  check(
    "the workspace never asserts a legal conclusion",
    !/\billegal\b|\bunlawful\b|\bwill win\b|\bguarantee\b/i.test(body)
  );
  check(
    "nothing is presented as recovered money",
    !/\brecovered\b/i.test(body)
  );
}

// --- The intelligence timeline ----------------------------------------------------------
section("The timeline reports what actually happened");
{
  const body = text(renderInvestigation());

  for (const step of [
    "Statement received",
    "deductions identified",
    "Jurisdiction confirmed",
    "Official sources retrieved",
    "Evidence connected",
    "Deductions assessed",
  ]) {
    check(`the timeline shows "${step}"`, new RegExp(step, "i").test(body));
  }

  check("the timeline counts real deductions", /3 deductions identified|3 of 3|3 deductions/.test(body));
  check(
    "the timeline does not claim a dispute is ready when no letter exists",
    !/A dispute letter has been drafted/.test(body)
  );

  const withLetter = text(
    renderInvestigation({
      letterExists: true,
      letterReady: true,
      letterStatus: "AWAITING_APPROVAL",
      status: "AWAITING_APPROVAL",
    })
  );
  check(
    "the timeline reports a prepared dispute once one exists",
    /dispute letter has been drafted/.test(withLetter)
  );
  check(
    "the timeline never exposes internal reasoning",
    !/chain of thought|reasoning:|prompt|token/i.test(body)
  );
}

// --- The statement progression -----------------------------------------------------------
section("The statement panel shows the real ingest progression");
{
  const read = text(renderStatement([STATEMENT_EMAIL]));
  check("the panel is titled Statement", /Statement/.test(read));
  check("a read statement says so", /Statement read/.test(read));
  check("the deduction count is reported", /3 deductions itemized from the statement/.test(read));
  check("the sender is shown", /landlord@example\.com/.test(read));
  check("the attachment is listed", /statement\.pdf/.test(read));
  check("the real status is shown", /Read/.test(read));

  const reading = text(
    renderStatement([{ ...STATEMENT_EMAIL, processingStatus: "PROCESSING" }])
  );
  check("an in-flight statement says it is being read", /Reading the statement/.test(reading));
  check(
    "an in-flight statement does not claim deductions were found",
    !/deductions itemized from the statement/.test(reading)
  );

  const failed = text(
    renderStatement([
      {
        ...STATEMENT_EMAIL,
        processingStatus: "FAILED",
        processingError: "The statement could not be read into deductions.",
      },
    ])
  );
  check("a failed statement shows the real reason", /could not be read into deductions/.test(failed));
  check("a failed statement offers a retry", /Retry reading/.test(failed));
  check("a failed statement does not claim success", !/Statement read/.test(failed));
  check("a failed statement shows no itemized count", !/itemized from the statement/.test(failed));

  const empty = text(renderStatement([]));
  check("a case with no mail does not fabricate a statement", !/Statement read/.test(empty));
  check("a case with no mail shows no status banner", !/Reading the statement/.test(empty));
}

/**
 * A whole case, exactly as `cases:get` returns one. The two money figures are
 * derived from the deduction rows below rather than typed in, so the header and
 * the itemised list can never disagree in a way that hides a wiring bug.
 */
const CASE_ROW = {
  _id: "case1",
  userId: "user1",
  jurisdiction: "California",
  depositAmount: 1500,
  totalDeductions: DEDUCTION_ROWS.reduce((sum, row) => sum + row.amount, 0),
  potentiallyDisputableAmount: DEDUCTION_ROWS.reduce(
    (sum, row) => sum + row.potentiallyDisputableAmount,
    0
  ),
  status: "EVIDENCE_FOUND",
  createdAt: Date.now() - 300_000,
  updatedAt: Date.now() - 60_000,
  inboxId: "case-abc@agentmail.to",
  inboxStatus: "READY",
  landlordEmail: LANDLORD_EMAIL,
};

section("The case page renders the case it was given, and says so when there is none");

{
  // The two halves are a pair on purpose. `cases:get` returns null — not an
  // error — when the case does not exist, which is deliberately different from
  // the "Unauthorized" thrown for a case belonging to someone else. Asserting
  // only the null branch would also pass for a page that renders nothing at all,
  // so the same page is rendered with a real case and the contrast is asserted.
  const present = text(
    renderOverview({
      "cases:get": CASE_ROW,
      "cases:getTimeline": TIMELINE_ROWS,
      "emails:listByCase": [STATEMENT_EMAIL],
      "emails:listCommunication": [],
      "deductions:listByCase": DEDUCTION_ROWS,
      "sources:listByCase": SOURCE_ROWS,
      "letters:getForCase": null,
      "letters:getDraftReadiness": READY,
      "letters:getSupportingSources": [],
    })
  );

  check("the case page shows the deposit the case row holds", /Security deposit[\s\S]{0,400}?\$1,500\.00/.test(present));
  check("the case page shows the deductions the case row holds", /Total deductions[\s\S]{0,400}?\$1,000\.00/.test(present));
  // 450 of 1,000 is 45%. The share is computed by the money block from the two
  // stored figures, so it can only be right if the case row reached the panel.
  check("the case page derives the share from the stored figures", /45% of the deductions claimed/.test(present));
  check("the case page maps the stored status", /Evidence found/.test(present));
  check("the case page shows the case's own jurisdiction", /California/.test(present));
  check("the case page shows the real statement sender", /landlord@example\.com/.test(present));
  check("the case page shows the real attachment", /statement\.pdf/.test(present));
  check("the case page shows the case's inbound address", /case-abc@agentmail\.to/.test(present));
  // Each stored deduction has to appear. Its description shows twice for the
  // selected row — once in the list, once as the "Landlord claim" being
  // investigated — so this counts distinct descriptions, not occurrences.
  const stored = ["Carpet replacement", "Cleaning", "Painting"];
  check(
    "the case page itemises every stored deduction",
    stored.every((description) => present.includes(description)),
    `missing: ${stored.filter((description) => !present.includes(description)).join(", ") || "none"}`
  );
  check("the case page investigates one claim at a time", (present.match(/Landlord claim/g) ?? []).length === 1);
  check("the case page offers no letter it does not have", !/Subject Request for review/.test(present));
  check("the case page shows money at all", /\$/.test(present));

  const missing = text(renderOverview({ "cases:get": null }));

  check("a missing case is reported as unavailable", /Case not available/.test(missing));
  check("a missing case explains why", /does not exist, or it belongs to a different account/.test(missing));
  check("a missing case offers no money figures", !/\$/.test(missing));
  check("a missing case does not claim a status", !/Potentially disputable/.test(missing));
  check("a missing case does not show the ingest panel", !/Statement/.test(missing));
  check("a missing case does not offer to draft a letter", !/Dispute letter/.test(missing));
}

// --- The case section nav --------------------------------------------------------------
section("The case nav links to sections that exist");
{
  const html = renderOverview({
    "cases:get": CASE_ROW,
    "cases:getTimeline": TIMELINE_ROWS,
    "emails:listByCase": [STATEMENT_EMAIL],
    "emails:listCommunication": [],
    "deductions:listByCase": DEDUCTION_ROWS,
    "sources:listByCase": SOURCE_ROWS,
    "letters:getForCase": null,
    "letters:getDraftReadiness": READY,
    "letters:getSupportingSources": [],
  });

  const hrefs = [...html.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]);
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));

  check("the case nav is rendered", /aria-label="Case sections"/.test(html));
  check(
    "the nav offers a link per section",
    hrefs.length >= 5,
    `${hrefs.length} link(s): ${hrefs.join(", ")}`
  );

  // The structural check that matters. A nav link whose anchor does not exist is
  // a dead control that looks completely fine — it only fails when a renter
  // clicks it. Renaming a section id is exactly how that happens.
  const dead = hrefs.filter((href) => !ids.has(href));
  check(
    "every nav link points at a section that exists",
    dead.length === 0,
    `dead link(s): ${dead.join(", ")}`
  );

  // The inverse: a section that exists but is not reachable from the nav.
  const navTargets = new Set(hrefs);
  const orphaned = [...ids].filter((id) => id.startsWith("case-") && !navTargets.has(id));
  check(
    "every case section is reachable from the nav",
    orphaned.length === 0,
    `unreachable: ${orphaned.join(", ")}`
  );

  check(
    "the nav does not claim the letter is a separate page",
    !/href="\/cases\/[^"]*\/letter"/.test(html)
  );
}

// --- First run --------------------------------------------------------------------------
section("A renter with no cases gets a hero, not a dashboard of zeroes");
{
  const renderDashboard = (cases: unknown): string => {
    globalThis.__FIXTURES__ = { "users:current": SIGNED_IN_USER, "cases:list": cases };
    return text(renderToStaticMarkup(createElement(Dashboard)));
  };

  const firstRun = renderDashboard([]);

  check("the first-run hero is shown", /Your deposit, itemized/.test(firstRun), firstRun.slice(0, 220));
  check(
    "the hero explains what Clawback does",
    /checks it against authoritative housing rules/.test(firstRun)
  );
  check("the hero offers one primary action", /Get started/.test(firstRun));
  check("the hero links to case creation", /href="\/cases\/new"/.test(renderToStaticMarkup(
    (() => {
      globalThis.__FIXTURES__ = { "users:current": SIGNED_IN_USER, "cases:list": [] };
      return createElement(Dashboard);
    })()
  )));
  check("the hero names the three steps", /Send the statement/.test(firstRun) && /You decide what goes out/.test(firstRun));
  check(
    "the hero says evidence backs every finding",
    /evidence behind every finding/.test(firstRun)
  );

  // A hero is the easiest place in the whole product to overclaim, so the same
  // constraints the rest of the UI holds to are asserted here too.
  check(
    "the hero does not promise a recovery",
    !/you will (?:get|receive|win)|guarantee|guaranteed|recover your|get your money back/i.test(firstRun),
    firstRun.match(/.{0,50}(?:guarantee|recover|money back).{0,50}/gi)?.join(" | ")
  );
  check(
    "the hero does not assert the money is already theirs",
    !/your money\.|is yours to take/i.test(firstRun)
  );
  check(
    "the hero states it is not legal advice",
    /not a law firm and does not give legal advice/.test(firstRun)
  );
  check("the hero claims no amount", !/\$[\d,]/.test(firstRun));
  check(
    "the hero hedges what is worth disputing rather than asserting it",
    /may be worth disputing/.test(firstRun) && !/exactly what's worth disputing/i.test(firstRun)
  );

  // The inverse, and the more important half: once a case exists the working
  // dashboard must come back, or the hero would hide a renter's own cases.
  const withCases = renderDashboard([CASE_ROW]);
  check("a renter with a case sees the working dashboard", !/Your deposit, itemized/.test(withCases));
  check("a renter with a case sees their money", /Potentially disputable/.test(withCases));
  check("a renter with a case sees their case listed", /Carpet replacement|case1|California/.test(withCases));

  globalThis.__FIXTURES__ = undefined;
}

// --- Identity: who gets to see a workspace -------------------------------------------------
//
// The single most serious regression this UI can have is showing one renter's
// cases to someone who is not signed in. It is also invisible unless the
// signed-out state is rendered on purpose — every other section here renders as
// a signed-in user. So all three states are rendered explicitly, and the child
// is a marker string whose absence is the actual assertion.
section("A signed-out visitor is asked to sign in, never shown a workspace");
{
  const MARKER = "CASE-DATA-MARKER";

  const renderGate = (): string =>
    text(
      renderToStaticMarkup(
        createElement(WorkspaceGate, null, createElement("p", null, MARKER))
      )
    );

  // Signed out: no session, no user row.
  globalThis.__AUTH__ = { isLoading: false, isAuthenticated: false };
  globalThis.__FIXTURES__ = { "users:current": undefined };
  const signedOut = renderGate();

  check("a signed-out visitor is asked to sign in", /Sign in to Clawback/.test(signedOut), signedOut.slice(0, 200));
  check("a signed-out visitor sees no case data", !signedOut.includes(MARKER));
  check("the sign-in screen asks for an email address", /Email address/.test(signedOut));
  check("the sign-in screen never asks for a password", !/password/i.test(signedOut));
  check(
    "the sign-in screen does not ask for a code before one was requested",
    !/Code from the email/.test(signedOut)
  );
  check("signing in is offered as an emailed code", /Email me a sign-in code/.test(signedOut));
  check(
    "the sign-in screen does not claim a demo or shared workspace",
    !/demo|shared by everyone/i.test(signedOut)
  );

  // The session is still resolving: neither the workspace nor a login prompt,
  // because a signed-in visitor whose row has not landed yet would otherwise be
  // shown a login screen they do not need.
  globalThis.__AUTH__ = { isLoading: true, isAuthenticated: false };
  const loading = renderGate();
  check("a visitor whose session is resolving sees a loading state", /Loading your workspace/.test(loading));
  check("a visitor whose session is resolving is not asked to sign in", !/Sign in to Clawback/.test(loading));
  check("a visitor whose session is resolving sees no case data", !loading.includes(MARKER));

  // A session exists but the row is still in flight — the state that makes
  // `isSignedIn` and `userId` different questions. It must not prompt to sign in.
  globalThis.__AUTH__ = { isLoading: false, isAuthenticated: true };
  globalThis.__FIXTURES__ = { "users:current": undefined };
  const rowPending = renderGate();
  check(
    "a signed-in visitor whose row is still loading is not asked to sign in",
    !/Sign in to Clawback/.test(rowPending)
  );
  check("a signed-in visitor whose row is still loading sees no case data yet", !rowPending.includes(MARKER));

  // Signed in with the row present: the workspace, and no sign-in prompt.
  globalThis.__FIXTURES__ = { "users:current": SIGNED_IN_USER };
  const signedIn = renderGate();
  check("a signed-in visitor sees the workspace", signedIn.includes(MARKER));
  check("a signed-in visitor is not asked to sign in", !/Sign in to Clawback/.test(signedIn));

  // The unreachable-backend branch cannot be reached here: its message comes from
  // an effect, and static rendering does not run effects. Rather than assert on a
  // state that cannot occur, this pins what the loading state must *not* do — it
  // must not read as "you have no cases", which is the failure mode that makes a
  // dead backend look like an empty account.
  globalThis.__AUTH__ = { isLoading: true, isAuthenticated: false };
  const pending = renderGate();
  check(
    "a pending session is not reported as an empty workspace",
    !/no cases/i.test(pending) && !/\$/.test(pending)
  );
  check("a pending session announces itself to assistive tech", /aria-busy|Loading your workspace/.test(pending));

  // Leave the harness in its default state for anything added after this.
  globalThis.__AUTH__ = undefined;
  globalThis.__FIXTURES__ = undefined;
}

section("The shell names the account instead of a placeholder");
{
  globalThis.__AUTH__ = { isLoading: false, isAuthenticated: true };
  globalThis.__FIXTURES__ = { "users:current": SIGNED_IN_USER };
  const shell = text(renderToStaticMarkup(createElement(AppShell, null, null)));

  check("the shell names the signed-in address", /renter@example\.com/.test(shell), shell.slice(0, 240));
  check("the shell offers a way to sign out", /Sign out/.test(shell));
  check(
    "the shell no longer claims a workspace shared by everyone",
    !/shared by everyone/i.test(shell)
  );
  check(
    "the shell does not claim the cases are visible to other accounts",
    !/visible to everyone/i.test(shell)
  );

  // Signed out, the shell must not invent an account.
  globalThis.__AUTH__ = { isLoading: false, isAuthenticated: false };
  globalThis.__FIXTURES__ = { "users:current": undefined };
  const anonShell = text(renderToStaticMarkup(createElement(AppShell, null, null)));

  check("a signed-out shell says so rather than naming a user", /Not signed in/.test(anonShell));
  check("a signed-out shell offers no sign out", !/Sign out/.test(anonShell));
  check("a signed-out shell names no address", !/@/.test(anonShell));

  globalThis.__AUTH__ = undefined;
  globalThis.__FIXTURES__ = undefined;
}

section("The sign-in form is the only way in");
{
  const html = renderToStaticMarkup(createElement(SignIn));
  const body = text(html);

  check("the form posts rather than navigating", /<form/.test(html));
  check("the email field is required", /required/.test(html) && /type="email"/.test(html));
  check(
    "the form says the cases belong to an account",
    /belong to your account/i.test(body),
    body.slice(0, 200)
  );
  check("the form offers to email a code", /Email me a sign-in code/.test(body));

  // The step boundary is the security-relevant part of this UI, and it is
  // visible in the markup: the code field does not exist until a code has been
  // requested, and the form does not claim one was sent. A form that renders the
  // code input up front invites a visitor to type a code for an address they
  // have not proved they control.
  check("no code field is rendered before a code is requested", !/Code from the email/.test(body));
  check("the form does not claim a code was already sent", !/We sent a six-digit code/.test(body));
  check("the form does not yet claim the address was verified", !/expires in one hour/.test(body));

  check(
    "the form does not promise the dispute letter will be sent",
    !/will be sent|we will send your dispute/i.test(body)
  );
  // Asserted on the fields themselves, not on the prose: the footer legitimately
  // says "Clawback never asks for … your bank login", so a keyword scan over the
  // rendered text would flag the very sentence that makes the promise.
  const inputs = html.match(/<input\b[^>]*>/g) ?? [];
  check(
    "the first step renders exactly one field, and it is the address",
    inputs.length === 1 && /type="email"/.test(inputs[0]),
    `${inputs.length} field(s): ${inputs.join(" ").slice(0, 200)}`
  );
  check("the first step renders no password field", !/type="password"/.test(html));
  check("the first step renders no hidden credential field", !/type="hidden"/.test(html));

  globalThis.__AUTH__ = undefined;
  globalThis.__FIXTURES__ = undefined;
}

console.log(`\n${checks - failures}/${checks} UI render checks passed`);
if (failures > 0) process.exit(1);
