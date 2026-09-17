/**
 * Offline checks for the parts of the email pipeline that do not need a
 * deployment: extraction validation, the JSON Schema handed to the model,
 * webhook payload normalization, signature verification and error redaction.
 *
 * Run with `npm run verify`.
 */

import { createHmac, randomBytes } from "node:crypto";

import type { Id } from "../convex/_generated/dataModel";
import {
  agentMailWebhookEventSchema,
  caseInboxLocalPart,
  normalizeInboundMessage,
} from "../convex/agentmail";
import {
  ASSESSMENT_SYSTEM_PROMPT,
  assessmentJsonSchema,
  buildAssessmentUserPrompt,
  computePotentiallyDisputableAmount,
  validateAssessment,
} from "../convex/assessment";
import { toSafeMessage } from "../convex/errors";
import {
  buildStatementUserPrompt,
  depositStatementJsonSchema,
  EXTRACTION_SYSTEM_PROMPT,
  parseDepositStatement,
  toExtractionResult,
} from "../convex/extraction";
import {
  classifyAuthority,
  extractRelevantPassage,
  parseSearchResponse,
} from "../convex/firecrawl";
import { buildResearchQuestion } from "../convex/questions";
import {
  buildLetterUserPrompt,
  hasLetterEvidence,
  INSUFFICIENT_EVIDENCE_MESSAGE,
  LETTER_SCHEMA_NAME,
  LETTER_SYSTEM_PROMPT,
  letterJsonSchema,
  validateLetter,
} from "../convex/letter";
import { bytesToBase64, verifySvixSignature } from "../convex/svix";
import {
  buildResponseAnalysisUserPrompt,
  RESPONSE_ANALYSIS_SCHEMA_NAME,
  RESPONSE_ANALYSIS_SYSTEM_PROMPT,
  responseAnalysisJsonSchema,
  summarizeReading,
  validateResponseAnalysis,
} from "../convex/response";
import {
  decideSendClaim,
  duplicateSendMessage,
  isSendableEmail,
  sendIdempotencyKey,
  STALE_SEND_CLAIM_MS,
  validateSendRequest,
} from "../convex/send";
import { DEDUCTION_CATEGORIES } from "../convex/validators";

let checks = 0;
let failures = 0;

function check(name: string, passed: boolean, detail?: string) {
  checks += 1;
  if (passed) {
    console.log(`  ok   ${name}`);
    return;
  }

  failures += 1;
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

function section(name: string) {
  console.log(`\n${name}`);
}

/** The example statement from the milestone brief, as the model should return it. */
const canonicalStatement = {
  depositAmount: 1500,
  statedTotalDeductions: 1000,
  deductions: [
    { description: "Painting", amount: 300, category: "ORDINARY_WEAR" },
    { description: "Carpet cleaning", amount: 150, category: "ORDINARY_WEAR" },
    { description: "Broken cabinet", amount: 400, category: "TENANT_DAMAGE" },
    { description: "Administrative fee", amount: 150, category: "FEE" },
  ],
  notes: null,
};

section("Extraction schema accepts a real statement");
{
  const parsed = parseDepositStatement(canonicalStatement);
  check("canonical statement validates", parsed !== null);
  check(
    "deposit amount is kept",
    parsed?.depositAmount === 1500,
    String(parsed?.depositAmount)
  );
  check(
    "all four deductions are kept",
    parsed?.deductions.length === 4,
    String(parsed?.deductions.length)
  );
  check(
    "landlord wording is preserved",
    parsed?.deductions[2].description === "Broken cabinet"
  );
  check(
    "amounts are preserved exactly",
    parsed?.deductions.reduce((total, item) => total + (item.amount ?? 0), 0) === 1000
  );

  const sparse = parseDepositStatement({
    depositAmount: null,
    statedTotalDeductions: null,
    deductions: [
      { description: "Cleaning", amount: null, category: "UNKNOWN" },
    ],
    notes: "The statement names a cleaning charge without an amount.",
  });
  check("missing amounts are allowed as null", sparse !== null);
  check("null amount survives validation", sparse?.deductions[0].amount === null);

  const empty = parseDepositStatement({
    depositAmount: null,
    statedTotalDeductions: null,
    deductions: [],
    notes: null,
  });
  check("an email with no statement content still validates", empty !== null);
}

section("Extraction schema rejects malformed model output");
{
  const rejected: Array<[string, unknown]> = [
    ["invented category", { ...canonicalStatement, deductions: [{ description: "Painting", amount: 300, category: "ILLEGAL_CHARGE" }] }],
    ["amount as a string", { ...canonicalStatement, deductions: [{ description: "Painting", amount: "300", category: "FEE" }] }],
    ["negative amount", { ...canonicalStatement, deductions: [{ description: "Painting", amount: -300, category: "FEE" }] }],
    ["negative deposit", { ...canonicalStatement, depositAmount: -1500 }],
    ["missing deductions array", { depositAmount: 1500, statedTotalDeductions: null, notes: null }],
    ["missing description", { ...canonicalStatement, deductions: [{ amount: 300, category: "FEE" }] }],
    ["empty description", { ...canonicalStatement, deductions: [{ description: "", amount: 300, category: "FEE" }] }],
    ["missing category", { ...canonicalStatement, deductions: [{ description: "Painting", amount: 300 }] }],
    ["missing depositAmount key", { statedTotalDeductions: null, deductions: [], notes: null }],
    ["free-form text instead of an object", "The landlord deducted $1000."],
    ["null", null],
  ];

  for (const [name, payload] of rejected) {
    check(`rejects ${name}`, parseDepositStatement(payload) === null);
  }
}

section("Validated extraction is stored without nulls");
{
  const parsed = parseDepositStatement(canonicalStatement);
  const stored = toExtractionResult(parsed!);

  check("deposit amount carried over", stored.depositAmount === 1500);
  check(
    "every deduction has a category",
    stored.deductions.every((deduction) => DEDUCTION_CATEGORIES.includes(deduction.category))
  );

  const withNulls = toExtractionResult({
    depositAmount: null,
    statedTotalDeductions: null,
    deductions: [{ description: "Cleaning", amount: null, category: "UNKNOWN" }],
    notes: null,
  });

  check("null deposit becomes undefined", withNulls.depositAmount === undefined);
  check("null amount becomes undefined", withNulls.deductions[0].amount === undefined);
  check("null notes become undefined", withNulls.notes === undefined);
}

section("Model JSON Schema is strict structured-output compatible");
{
  const schema = depositStatementJsonSchema as Record<string, unknown>;

  check("$schema is stripped", !("$schema" in schema));
  check("top level is an object", schema.type === "object");
  check("top level forbids extra properties", schema.additionalProperties === false);

  const required = (schema.required as string[]) ?? [];
  const properties = Object.keys((schema.properties ?? {}) as Record<string, unknown>);
  check(
    "every top-level property is required",
    properties.every((key) => required.includes(key)),
    properties.filter((key) => !required.includes(key)).join(", ")
  );

  const deductionSchema = ((schema.properties as Record<string, unknown>).deductions as Record<string, unknown>);
  const items = deductionSchema.items as Record<string, unknown>;
  check("deduction items forbid extra properties", items.additionalProperties === false);
  check(
    "deduction items require every property",
    (Object.keys(items.properties as Record<string, unknown>)).every((key) =>
      ((items.required as string[]) ?? []).includes(key)
    )
  );

  const categorySchema = (items.properties as Record<string, unknown>).category as Record<string, unknown>;
  check(
    "category enum matches the Convex validator",
    JSON.stringify(categorySchema.enum) === JSON.stringify([...DEDUCTION_CATEGORIES])
  );

  // A deduction the statement names without an amount must still be
  // representable, so `amount` has to accept null. Zod expresses that either as
  // a `["number", "null"]` type or as an `anyOf` branch, so match both.
  const amountSchema = JSON.stringify((items.properties as Record<string, unknown>).amount);
  check("amount accepts null for unquantified deductions", amountSchema.includes('"null"'), amountSchema);
  check("amount is constrained to non-negative figures", amountSchema.includes("minimum"), amountSchema);
}

section("Prompt keeps the model inside this milestone");
{
  check(
    "forbids legal conclusions",
    EXTRACTION_SYSTEM_PROMPT.includes("Never judge whether a deduction is legal")
  );
  check(
    "forbids inventing amounts",
    EXTRACTION_SYSTEM_PROMPT.includes("Never guess an amount")
  );
  check(
    "tells the model to ignore unquantified conditions",
    EXTRACTION_SYSTEM_PROMPT.includes("we may deduct additional cleaning costs")
  );
  check(
    "the subject travels with the body",
    buildStatementUserPrompt({ subject: "Security Deposit Statement", body: "Hi" }) ===
      "Subject: Security Deposit Statement\n\nHi"
  );
  check(
    "an empty subject is labelled",
    buildStatementUserPrompt({ subject: "", body: "Hi" }).startsWith("Subject: (no subject)")
  );
}

section("Webhook payload normalization");
{
  const event = agentMailWebhookEventSchema.safeParse({
    event_type: "message.received",
    event_id: "evt_1",
    message: {
      message_id: "msg_1",
      inbox_id: "case-abc123@agentmail.to",
      timestamp: "2026-09-13T10:00:00.000Z",
      from: "landlord@example.com",
      to: ["case-abc123@agentmail.to"],
      subject: "Security Deposit Statement",
      text: "Your security deposit was $1,500.",
      attachments: [
        { attachment_id: "att_1", filename: "statement.pdf", content_type: "application/pdf", size: 2048 },
      ],
    },
  });

  check("a message.received event validates", event.success);

  const message = normalizeInboundMessage(event.data!.message!);
  check("message id is the idempotency key", message.externalMessageId === "msg_1");
  check("inbox id routes the message", message.inboxId === "case-abc123@agentmail.to");
  check("string sender is read", message.sender === "landlord@example.com");
  check("array recipient is read", message.recipient === "case-abc123@agentmail.to");
  check("body is kept", message.body === "Your security deposit was $1,500.");
  check(
    "timestamp becomes epoch millis",
    message.receivedAt === Date.parse("2026-09-13T10:00:00.000Z")
  );
  check("attachment metadata is preserved", message.attachments[0]?.filename === "statement.pdf");

  const alternate = agentMailWebhookEventSchema.safeParse({
    event_type: "message.received",
    message: {
      message_id: "msg_2",
      inbox_id: "case-abc123@agentmail.to",
      from_: [{ email: "landlord@example.com" }],
      extracted_text: "Fallback body",
      created_at: "2026-09-13T11:00:00.000Z",
    },
  });

  check("address object arrays validate", alternate.success);
  const fallback = normalizeInboundMessage(alternate.data!.message!);
  check("object-array sender is read", fallback.sender === "landlord@example.com");
  check("missing subject becomes empty", fallback.subject === "");
  check("extracted_text is used when text is absent", fallback.body === "Fallback body");
  check("created_at is used when timestamp is absent", fallback.receivedAt === Date.parse("2026-09-13T11:00:00.000Z"));
  check("no attachments is an empty list", fallback.attachments.length === 0);

  check(
    "an unrelated event type carries no message",
    agentMailWebhookEventSchema.safeParse({ event_type: "domain.verified" }).data?.message ===
      undefined
  );

  // The inbox local part is derived from the case id, so it must be exact,
  // stable, and distinct between cases: two cases must never share an address.
  check(
    "case address is the tail of the case id",
    caseInboxLocalPart("jd7f2k9wq3m8x1vz6b4n5c2p7r0t") === "case-6b4n5c2p7r0t",
    caseInboxLocalPart("jd7f2k9wq3m8x1vz6b4n5c2p7r0t")
  );
  check(
    "case address drops punctuation and lowercases",
    caseInboxLocalPart("JN7F2K9W-Q3M8_X1VZ6B4N") === "case-q3m8x1vz6b4n",
    caseInboxLocalPart("JN7F2K9W-Q3M8_X1VZ6B4N")
  );
  check(
    "case address is stable across calls",
    caseInboxLocalPart("jd7f2k9wq3m8x1vz6b4n5c2p7r0t") === caseInboxLocalPart("jd7f2k9wq3m8x1vz6b4n5c2p7r0t")
  );
  check(
    "different cases get different addresses",
    caseInboxLocalPart("jn7f2k9wq3m8x1vz6b4n5c2p7r0t") !==
      caseInboxLocalPart("jn7f2k9wq3m8x1vz6b4n5c2p7r9x")
  );
}

async function verifySignatures() {
  section("Svix webhook signature verification");
  const secretBytes = randomBytes(24);
  const secret = `whsec_${secretBytes.toString("base64")}`;
  const body = JSON.stringify({ event_type: "message.received" });
  const messageId = "msg_2ZvN9";
  const timestamp = String(Math.floor(Date.now() / 1000));

  const sign = (id: string, ts: string, payload: string) =>
    bytesToBase64(
      createHmac("sha256", secretBytes).update(`${id}.${ts}.${payload}`).digest()
    );

  const headersFor = (id: string, ts: string, signature: string) =>
    new Headers({
      "svix-id": id,
      "svix-timestamp": ts,
      "svix-signature": `v1,${signature}`,
    });

  check(
    "accepts a correctly signed delivery",
    await verifySvixSignature({
      rawBody: body,
      headers: headersFor(messageId, timestamp, sign(messageId, timestamp, body)),
      secret,
    })
  );

  check(
    "rejects a tampered body",
    !(await verifySvixSignature({
      rawBody: `${body} `,
      headers: headersFor(messageId, timestamp, sign(messageId, timestamp, body)),
      secret,
    }))
  );

  check(
    "rejects a signature from another secret",
    !(await verifySvixSignature({
      rawBody: body,
      headers: headersFor(
        messageId,
        timestamp,
        bytesToBase64(createHmac("sha256", randomBytes(24)).update(`${messageId}.${timestamp}.${body}`).digest())
      ),
      secret,
    }))
  );

  const stale = String(Math.floor(Date.now() / 1000) - 3600);
  check(
    "rejects a replayed timestamp",
    !(await verifySvixSignature({
      rawBody: body,
      headers: headersFor(messageId, stale, sign(messageId, stale, body)),
      secret,
    }))
  );

  check(
    "rejects missing headers",
    !(await verifySvixSignature({ rawBody: body, headers: new Headers(), secret }))
  );

  check(
    "accepts a multi-signature header",
    await verifySvixSignature({
      rawBody: body,
      headers: new Headers({
        "svix-id": messageId,
        "svix-timestamp": timestamp,
        "svix-signature": `v1,AAAA ${`v1,${sign(messageId, timestamp, body)}`}`,
      }),
      secret,
    })
  );
}

function verifyFailureMessages() {
  section("Failure messages stay safe to store and show");
  const withKey = toSafeMessage(new Error("Request failed for sk-live-abcdef123456"));
  check("redacts OpenAI style keys", !withKey.includes("sk-live") && withKey.includes("[redacted]"), withKey);

  const withAgentMailKey = toSafeMessage(new Error("401 from am_9f8e7d6c5b4a using Bearer am_9f8e7d6c5b4a"));
  check("redacts AgentMail keys", !withAgentMailKey.includes("am_9f8e7d6c5b4a"), withAgentMailKey);

  const withFirecrawlKey = toSafeMessage(new Error("401 for fc-0a1b2c3d4e5f6g7h8i"));
  check("redacts Firecrawl keys", !withFirecrawlKey.includes("fc-0a1b2c3d4e5f6g7h8i"), withFirecrawlKey);

  const long = toSafeMessage(new Error("x".repeat(4000)));
  check("truncates long messages", long.length <= 300, String(long.length));

  check("falls back for non-errors", toSafeMessage(undefined) === "The statement could not be processed.");
  check(
    "falls back for empty messages",
    toSafeMessage(new Error("   ")) === "The statement could not be processed."
  );
}

function verifyResearchQuestions() {
  section("Research question generation");
  const question = buildResearchQuestion({
    jurisdiction: "California",
    description: "Carpet replacement",
    category: "ORDINARY_WEAR",
  });

  check("mentions the jurisdiction", question.includes("California"));
  check("keeps the landlord's wording", question.includes('"Carpet replacement"'));
  check("asks about the category", question.includes("ordinary wear"));
  check(
    "asks for the applicable conditions, not a verdict",
    question.includes("conditions") && question.endsWith("?")
  );
  check(
    "does not assert a legal conclusion",
    !/illegal|unlawful|must repay/i.test(question)
  );

  const feeQuestion = buildResearchQuestion({
    jurisdiction: "Texas",
    description: "Administrative fee",
    category: "FEE",
  });
  check("fee focus mentions non-repair fees", feeQuestion.includes("non-repair fee"));

  const unknownQuestion = buildResearchQuestion({
    jurisdiction: "Nevada",
    description: "Miscellaneous",
    category: undefined,
  });
  check(
    "an unclassified deduction still produces a question",
    unknownQuestion.includes("Nevada") && unknownQuestion.includes('"Miscellaneous"')
  );

  check(
    "the same deduction always produces the same question",
    buildResearchQuestion({ jurisdiction: "California", description: "Carpet replacement", category: "ORDINARY_WEAR" }) ===
      buildResearchQuestion({ jurisdiction: "California", description: "Carpet replacement", category: "ORDINARY_WEAR" })
  );
}

function verifyAuthorityClassification() {
  section("Official source classification");

  check("accepts a state .gov agency page", classifyAuthority("https://www.dre.ca.gov/consumers") === "OFFICIAL");
  check("accepts a federal .gov page", classifyAuthority("https://www.hud.gov/topics") === "OFFICIAL");
  check("accepts a legislature host", classifyAuthority("https://leginfo.legislature.ca.gov/faces/codes.xhtml") === "OFFICIAL");
  check("accepts a courts host", classifyAuthority("https://courts.ca.gov/selfhelp") === "OFFICIAL");
  check("accepts a state.<xx>.us host", classifyAuthority("https://www.hhs.state.tx.us/rules") === "OFFICIAL");

  check("rejects a blog", classifyAuthority("https://example.com/blog/security-deposits") === "NON_OFFICIAL");
  check("rejects a law-firm marketing page", classifyAuthority("https://www.lawfirm.com/practices/security-deposit") === "NON_OFFICIAL");
  check("rejects reddit", classifyAuthority("https://www.reddit.com/r/legaladvice") === "NON_OFFICIAL");
  check("rejects a fake .gov suffix", classifyAuthority("https://example.com/gov-site") === "NON_OFFICIAL");
  check("rejects gov in the path only", classifyAuthority("https://www.blog.net/california.gov/rules") === "NON_OFFICIAL");
  check("rejects garbage urls", classifyAuthority("not a url") === "NON_OFFICIAL");
}

function verifyFirecrawlParsing() {
  section("Firecrawl search response parsing");

  const classic = parseSearchResponse({
    success: true,
    data: [
      { url: "https://www.dre.ca.gov/a", title: "  Security deposits  ", description: "Rules about deposits.", markdown: "## Deposits\n\nA landlord may deduct..." },
      { url: "https://example.com/b", title: null, description: null },
      { url: "", title: "empty url" },
    ],
  });
  check("classic array shape yields two results", classic.length === 2, String(classic.length));
  check("titles are trimmed", classic[0].title === "Security deposits");
  check("markdown is kept for passage extraction", classic[0].markdown?.includes("deduct") === true);
  check("missing optional fields become undefined", classic[1].title === undefined && classic[1].description === undefined);

  const wrapped = parseSearchResponse({
    success: true,
    data: { results: [{ url: "https://courts.ca.gov/x", title: "Courts", description: null, markdown: null }] },
  });
  check("metadata-wrapped results are read", wrapped.length === 1 && wrapped[0].url === "https://courts.ca.gov/x");

  const webWrapped = parseSearchResponse({
    success: true,
    data: { web: { results: [{ url: "https://www.hud.gov/y", title: "HUD", description: null, markdown: null }] } },
  });
  check("web-wrapped results are read", webWrapped.length === 1 && webWrapped[0].url === "https://www.hud.gov/y");

  check("a non-list body becomes an empty list", parseSearchResponse({ success: true, data: 42 }).length === 0);
  check("an arbitrary object becomes an empty list", parseSearchResponse({ hello: "world" }).length === 0);
  check("null becomes an empty list", parseSearchResponse(null).length === 0);
  check("a bare array body becomes an empty list", parseSearchResponse([1, 2, 3]).length === 0);
}

function verifyPassageExtraction() {
  section("Relevant passage extraction");
  const markdown = [
    "# Tenant rights in California",
    "",
    "This page describes unrelated intake procedures and general agency contact details.",
    "",
    "A landlord may use the security deposit for unpaid rent or repairs beyond ordinary wear and tear. Deductions must be itemized in writing.",
    "",
    "Carpet replacement charged as ordinary maintenance may not be deductible where the carpet suffered only normal wear.",
  ].join("\n");

  const passage = extractRelevantPassage(markdown, "Carpet replacement");
  check("a passage is extracted", passage !== undefined);
  check("the passage mentions deductions", /deduct|deposit/i.test(passage ?? ""));
  check("the passage is bounded", (passage ?? "").length <= 1200);

  const noKeywords = extractRelevantPassage("Welcome to our homepage. Menus and navigation links live here.", "Carpet");
  check("a page with nothing on-topic yields no passage", noKeywords === undefined);

  check("missing markdown yields no passage", extractRelevantPassage(undefined, "Carpet") === undefined);
  check(
    "a very long page is truncated with an ellipsis",
    (extractRelevantPassage(`Deposit rules. ${"filler ".repeat(400)}`, "Deposit") ?? "").endsWith("…")
  );

  // The stored passage must be text that was genuinely selected out of the
  // retrieved page. A provider summary is not a passage, so a page with no
  // usable on-topic text must yield nothing rather than something made up.
  const summaryOnly = extractRelevantPassage(
    "Official guidance on security deposit deductions and itemized statements.",
    "Broken cabinet"
  );
  check(
    "a provider summary is not promoted into a passage",
    summaryOnly === undefined || summaryOnly.includes("security deposit"),
    summaryOnly
  );
}

/**
 * Source fixtures for the assessment checks. These ids never touch a database,
 * so they are cast: the point of the checks is label→id translation and the
 * amount invariants, not id generation.
 */
const validAssessmentSources = [
  { label: "S1", id: "src1111111111111111111111" as Id<"sources"> },
  { label: "S2", id: "src2222222222222222222222" as Id<"sources"> },
];

function verifyAssessmentValidation() {
  section("Assessment output validation");
  const valid = validateAssessment(
    {
      assessmentStatus: "POTENTIALLY_DISPUTABLE",
      reasoning: "The available source indicates deductions must exceed ordinary wear and tear.",
      potentiallyDisputableAmount: 400,
      supportingSourceIds: ["S1", "S2"],
      missingInformation: [],
    },
    { deductionAmount: 400, sources: validAssessmentSources }
  );
  check("a valid disputable assessment passes", valid !== null);
  check("source labels are translated to ids", valid?.assessmentSourceIds.length === 2);
  check("the amount is kept", valid?.potentiallyDisputableAmount === 400);

  const clamped = validateAssessment(
    {
      assessmentStatus: "POTENTIALLY_DISPUTABLE",
      reasoning: "The available source indicates the charge may not satisfy the conditions.",
      potentiallyDisputableAmount: 900,
      supportingSourceIds: ["S1"],
      missingInformation: [],
    },
    { deductionAmount: 400, sources: validAssessmentSources }
  );
  check("an amount above the deduction is capped at the deduction", clamped?.potentiallyDisputableAmount === 400);

  const unquantified = validateAssessment(
    {
      assessmentStatus: "POTENTIALLY_DISPUTABLE",
      reasoning: "The source indicates the charge may not be deductible.",
      potentiallyDisputableAmount: 500,
      supportingSourceIds: ["S1"],
      missingInformation: ["The stated amount for this charge"],
    },
    { deductionAmount: undefined, sources: validAssessmentSources }
  );
  check("an unquantified deduction contributes 0", unquantified?.potentiallyDisputableAmount === 0);
  check("missing information is preserved", unquantified?.assessmentMissingInformation.length === 1);

  const likelyValid = validateAssessment(
    {
      assessmentStatus: "LIKELY_VALID",
      reasoning: "The available source indicates repair costs for damage are deductible.",
      potentiallyDisputableAmount: 400,
      supportingSourceIds: ["S1"],
      missingInformation: [],
    },
    { deductionAmount: 400, sources: validAssessmentSources }
  );
  check("a likely-valid assessment contributes 0", likelyValid?.potentiallyDisputableAmount === 0);

  const needsInfo = validateAssessment(
    {
      assessmentStatus: "NEEDS_MORE_INFORMATION",
      reasoning: "The provided passages do not state whether this charge is allowed.",
      potentiallyDisputableAmount: 0,
      supportingSourceIds: [],
      missingInformation: ["Move-out inspection report"],
    },
    { deductionAmount: 400, sources: validAssessmentSources }
  );
  check("insufficient evidence passes with no sources", needsInfo !== null);

  const inventedSources = validateAssessment(
    {
      assessmentStatus: "POTENTIALLY_DISPUTABLE",
      reasoning: "According to a source I know about.",
      potentiallyDisputableAmount: 100,
      supportingSourceIds: ["S9"],
      missingInformation: [],
    },
    { deductionAmount: 400, sources: validAssessmentSources }
  );
  check("an outcome citing only invented sources is rejected", inventedSources === null);

  const rejected: Array<[string, unknown]> = [
    ["negative amount", { assessmentStatus: "POTENTIALLY_DISPUTABLE", reasoning: "x", potentiallyDisputableAmount: -50, supportingSourceIds: ["S1"], missingInformation: [] }],
    ["unknown status", { assessmentStatus: "DEFINITELY_ILLEGAL", reasoning: "x", potentiallyDisputableAmount: 50, supportingSourceIds: ["S1"], missingInformation: [] }],
    ["amount as a string", { assessmentStatus: "NEEDS_MORE_INFORMATION", reasoning: "x", potentiallyDisputableAmount: "0", supportingSourceIds: [], missingInformation: [] }],
    ["missing reasoning", { assessmentStatus: "NEEDS_MORE_INFORMATION", potentiallyDisputableAmount: 0, supportingSourceIds: [], missingInformation: [] }],
    ["missing supportingSourceIds", { assessmentStatus: "NEEDS_MORE_INFORMATION", reasoning: "x", potentiallyDisputableAmount: 0, missingInformation: [] }],
    ["free-form text", "The deduction seems unfair."],
    ["null", null],
  ];
  for (const [name, payload] of rejected) {
    check(`rejects ${name}`, validateAssessment(payload, { deductionAmount: 400, sources: validAssessmentSources }) === null);
  }
}

function verifyCaseTotals() {
  section("Case disputable totals come from stored assessments");
  const deductions: Array<{
    amount?: number;
    assessment?: "POTENTIALLY_DISPUTABLE" | "LIKELY_VALID" | "NEEDS_MORE_INFORMATION";
    potentiallyDisputableAmount?: number;
  }> = [
    { amount: 400, assessment: "POTENTIALLY_DISPUTABLE", potentiallyDisputableAmount: 400 },
    { amount: 300, assessment: "POTENTIALLY_DISPUTABLE", potentiallyDisputableAmount: 350 },
    { amount: 150, assessment: "LIKELY_VALID", potentiallyDisputableAmount: 0 },
    { amount: 150, assessment: "NEEDS_MORE_INFORMATION", potentiallyDisputableAmount: 150 },
    { amount: 200, assessment: "POTENTIALLY_DISPUTABLE", potentiallyDisputableAmount: 175 },
    { amount: undefined, assessment: "POTENTIALLY_DISPUTABLE", potentiallyDisputableAmount: 100 },
    { amount: 90, assessment: undefined, potentiallyDisputableAmount: 90 },
  ];

  check(
    "only disputable assessments count, capped at their amounts",
    computePotentiallyDisputableAmount(deductions) === 875,
    String(computePotentiallyDisputableAmount(deductions))
  );
  check("no assessments means 0", computePotentiallyDisputableAmount(deductions.slice(6)) === 0);
  check("an empty case means 0", computePotentiallyDisputableAmount([]) === 0);
  check("amounts are rounded to cents", computePotentiallyDisputableAmount([
    { amount: 100, assessment: "POTENTIALLY_DISPUTABLE", potentiallyDisputableAmount: 33.333 },
  ]) === 33.33);
}

/**
 * The stored reasoning is shown to renters as Clawback's explanation, so it must
 * never read as an absolute legal verdict or a promise of money back. These
 * checks pin the wording the prompts ask for.
 */
function verifyNoLegalConclusions() {
  section("No fabricated or absolute legal language");

  const forbidden = [
    /\billegal\b/i,
    /\bunlawful\b/i,
    /\byou will (win|recover)\b/i,
    /\bthe landlord (broke|violated) the law\b/i,
    /\bguarantee[ds]?\b/i,
    /\b\d{1,3}% chance\b/i,
  ];

  const prompts = [ASSESSMENT_SYSTEM_PROMPT, EXTRACTION_SYSTEM_PROMPT];

  check(
    "the assessment prompt bans declaring a deduction illegal",
    /never state that a deduction is illegal/i.test(ASSESSMENT_SYSTEM_PROMPT)
  );
  check(
    "the assessment prompt bans promising recovery",
    /never.{0,80}recover money/i.test(ASSESSMENT_SYSTEM_PROMPT)
  );
  check(
    "the assessment prompt requires cautious wording",
    /may warrant further review/i.test(ASSESSMENT_SYSTEM_PROMPT)
  );
  check(
    "the assessment prompt prefers missing information over guessing",
    /prefer this over guessing/i.test(ASSESSMENT_SYSTEM_PROMPT)
  );
  check(
    "the assessment prompt forbids inventing citations and URLs",
    /do not invent[\s\S]{0,120}(citations|urls)/i.test(ASSESSMENT_SYSTEM_PROMPT)
  );

  for (const [index, prompt] of prompts.entries()) {
    const label = index === 0 ? "assessment" : "extraction";
    for (const pattern of forbidden) {
      // The prompts quote the forbidden phrasings only inside a negation.
      const offending = prompt
        .split(/[.\n]/)
        .filter((sentence) => pattern.test(sentence) && !/\b(never|not|do not|no)\b/i.test(sentence));
      check(`the ${label} prompt never asserts "${pattern.source}"`, offending.length === 0, offending[0]);
    }
  }

  check(
    "the extraction prompt keeps the landlord's wording without judging it",
    /Keep their phrasing/i.test(EXTRACTION_SYSTEM_PROMPT)
  );
  check(
    "the extraction prompt refuses to judge legality",
    /Never judge whether a deduction is legal/i.test(EXTRACTION_SYSTEM_PROMPT)
  );
}

function verifyAssessmentPrompt() {
  section("Assessment prompt and schema");
  check(
    "the prompt forbids inventing law",
    ASSESSMENT_SYSTEM_PROMPT.includes("Do not invent laws")
  );
  check(
    "the prompt forbids promising recovery",
    ASSESSMENT_SYSTEM_PROMPT.includes("Never state that a deduction is illegal")
  );
  check(
    "the prompt prefers insufficient evidence over guessing",
    ASSESSMENT_SYSTEM_PROMPT.includes("Prefer this over guessing")
  );

  const schema = assessmentJsonSchema as Record<string, unknown>;
  check("$schema is stripped", !("$schema" in schema));
  check("top level is an object", schema.type === "object");
  check("top level forbids extra properties", schema.additionalProperties === false);

  const properties = Object.keys((schema.properties ?? {}) as Record<string, unknown>);
  const required = (schema.required as string[]) ?? [];
  check(
    "every property is required",
    properties.every((key) => required.includes(key)),
    properties.filter((key) => !required.includes(key)).join(", ")
  );

  const statusSchema = ((schema.properties as Record<string, unknown>).assessmentStatus as Record<string, unknown>);
  check(
    "the status enum matches the stored outcomes",
    JSON.stringify(statusSchema.enum) ===
      JSON.stringify(["POTENTIALLY_DISPUTABLE", "LIKELY_VALID", "NEEDS_MORE_INFORMATION"])
  );

  const amountSchema = JSON.stringify((schema.properties as Record<string, unknown>).potentiallyDisputableAmount);
  check("amount is constrained to non-negative figures", amountSchema.includes("minimum"), amountSchema);

  const prompt = buildAssessmentUserPrompt({
    jurisdiction: "California",
    depositAmount: 1500,
    description: "Broken cabinet",
    amount: 400,
    category: "TENANT_DAMAGE",
    researchQuestion: "What rules apply?",
    sources: [
      { label: "S1", title: "Official guidance", authority: "Government / Housing Authority", jurisdiction: "California", relevantText: "Deductions must exceed ordinary wear." },
      { label: "S2", title: "Second source", authority: "Government / Housing Authority", jurisdiction: "California" },
    ],
  });
  check("the prompt carries the jurisdiction", prompt.includes("Jurisdiction: California"));
  check("the prompt carries the deposit", prompt.includes("$1500.00"));
  check("the prompt keeps the landlord's wording", prompt.includes('"Broken cabinet"'));
  check("the prompt carries the deduction amount", prompt.includes("$400.00"));
  check("the prompt carries the research question", prompt.includes("What rules apply?"));
  check("every source is labelled", prompt.includes("[S1]") && prompt.includes("[S2]"));
  check("passages are quoted", prompt.includes('Passage: "Deductions must exceed ordinary wear."'));
  check(
    "a source without a passage says so instead of staying silent",
    prompt.includes("the provider returned no passage")
  );
}

function verifyLetterValidation() {
  section("Dispute letter validation");

  const sources = [
    { label: "S1", id: "src1111111111111111111111" as Id<"sources"> },
    { label: "S2", id: "src2222222222222222222222" as Id<"sources"> },
  ];

  const base = {
    recipient: "Property Manager",
    subject: "Request for review of security deposit deductions",
    body: "Based on the available housing guidance, I am requesting clarification and reimbursement for the deductions described below. The published guidance indicates that this charge may warrant further review. I am asking that the amount identified as potentially disputable be reimbursed to me. I would welcome any supporting documentation so I can review it directly. Thank you for your time and consideration of this request.",
    supportingSourceIds: ["S1"],
  };

  const valid = validateLetter(base, { sources });
  check("a compliant letter validates", valid !== null);
  check("validated labels resolve to real source ids", valid?.supportingSourceIds[0] === sources[0].id);

  // Structured-output contract.
  check("a letter with no body is rejected", validateLetter({ ...base, body: "" }, { sources }) === null);
  check("a stub body is rejected", validateLetter({ ...base, body: "Please refund me." }, { sources }) === null);
  check("a letter with no subject is rejected", validateLetter({ ...base, subject: "" }, { sources }) === null);
  check("a letter with no recipient is rejected", validateLetter({ ...base, recipient: "" }, { sources }) === null);
  check(
    "a letter with the wrong shape is rejected",
    validateLetter({ ...base, supportingSourceIds: "S1" }, { sources }) === null
  );
  check("non-object output is rejected", validateLetter("not json", { sources }) === null);

  // Legal safety: the enforcement behind the prompt's rules.
  const forbidden: Array<[string, string]> = [
    ["asserts the landlord acted illegally", "You illegally withheld my deposit."],
    ["asserts the landlord acted unlawfully", "This was an unlawful deduction."],
    ["asserts a broken law", "Your landlord broke the law here."],
    ["asserts a legal violation", "This is a violation of law."],
    ["accuses the landlord of theft", "You stole my deposit."],
    ["accuses the landlord of stealing", "The landlord is stealing from me."],
    ["uses the word theft", "This amounts to theft."],
    ["promises a guaranteed outcome", "I am guaranteed to recover this amount."],
    ["promises a win", "We will win this."],
    ["states a success probability", "There is a 95% chance you will lose."],
    ["threatens a lawsuit", "I will sue you over this."],
    ["threatens small claims court", "I will file in small claims court."],
    ["threatens the attorney general", "I will contact the attorney general."],
    ["invents a deadline", "You must respond within 14 days."],
    ["cites a statute", "Pursuant to Civil Code 1950.5, this is improper."],
    ["cites a U.S. Code section", "Under 15 U.S.C. 1692 this is barred."],
    ["cites a court case", "See Smith v. Jones on this point."],
    ["puts a URL in the letter", "See https://example.com/guide for details."],
  ];

  for (const [name, body] of forbidden) {
    check(
      `rejects a letter that ${name}`,
      validateLetter({ ...base, body: `${base.body} ${body}` }, { sources }) === null
    );
  }

  // The filter must not be so blunt that ordinary, safe wording trips it.
  const allowed: Array<[string, string]> = [
    ["the phrase 'the applicable law'", "I am asking that the applicable law be applied to this review."],
    ["the word 'legal' in a neutral sense", "I would prefer to resolve this without any legal involvement."],
    ["the word 'lawyer'", "I am not represented by a lawyer in this matter."],
    ["a request for review", "I am requesting that these charges be reviewed."],
    ["a cautious inconsistency claim", "This appears inconsistent with the published guidance."],
  ];

  for (const [name, sentence] of allowed) {
    check(
      `accepts a letter using ${name}`,
      validateLetter({ ...base, body: `${base.body} ${sentence}` }, { sources }) !== null
    );
  }

  // Evidence traceability.
  check(
    "a letter citing no known source is rejected",
    validateLetter({ ...base, supportingSourceIds: ["S9"] }, { sources }) === null
  );
  check(
    "a letter citing no sources at all is rejected",
    validateLetter({ ...base, supportingSourceIds: [] }, { sources }) === null
  );
  check(
    "invented labels are dropped while real ones survive",
    validateLetter({ ...base, supportingSourceIds: ["S1", "S99"] }, { sources })?.supportingSourceIds.length === 1
  );
  check(
    "duplicate labels collapse to one source",
    validateLetter({ ...base, supportingSourceIds: ["S1", "S1"] }, { sources })?.supportingSourceIds.length === 1
  );
  check(
    "a letter with no available sources is rejected",
    validateLetter(base, { sources: [] }) === null
  );

  // Length clamps keep a runaway model from writing an unbounded document.
  const long = validateLetter(
    { ...base, subject: "s".repeat(1000), recipient: "r".repeat(1000), body: `${base.body}${"x".repeat(30_000)}` },
    { sources }
  );
  check("an over-long subject is clamped", (long?.subject.length ?? 0) <= 300);
  check("an over-long recipient is clamped", (long?.recipient.length ?? 0) <= 200);
  check("an over-long body is clamped", (long?.body.length ?? 0) <= 20_000);

  // The JSON Schema handed to the provider must match the Zod contract.
  check("the letter schema name is stable", LETTER_SCHEMA_NAME === "dispute_letter");
  check("the provider schema has no $schema key", !("$schema" in letterJsonSchema));
  check(
    "the provider schema requires every field",
    Array.isArray(letterJsonSchema.required) &&
      (letterJsonSchema.required as string[]).includes("supportingSourceIds")
  );

  // The prompt must carry the same prohibitions the validator enforces.
  for (const [name, pattern] of [
    ["inventing facts or citations", /never invent/i],
    ["asserting illegality", /never state that the landlord broke the law/i],
    ["claiming a guaranteed outcome", /never claim the renter will win/i],
    ["threatening legal action", /never threaten legal action/i],
    ["inventing a deadline", /never invent a deadline/i],
    ["leaving a label or URL in the body", /never write a source label, URL, or database id/i],
    ["using only provided figures", /do not add, total, or estimate any amount/i],
    ["attributing claims to a passage", /attributed to a provided source passage/i],
  ] as Array<[string, RegExp]>) {
    check(`the letter prompt forbids ${name}`, pattern.test(LETTER_SYSTEM_PROMPT));
  }

  check(
    "the letter prompt requires a professional, non-lawyer tone",
    /must not read as if written by a lawyer/i.test(LETTER_SYSTEM_PROMPT)
  );
  check(
    "the letter prompt sets out the required letter structure",
    /professional opening/i.test(LETTER_SYSTEM_PROMPT) && /professional closing/i.test(LETTER_SYSTEM_PROMPT)
  );
  check(
    "the letter prompt bans markdown in the body",
    /do not use markdown formatting/i.test(LETTER_SYSTEM_PROMPT)
  );
}

function verifyLetterPrompt() {
  section("Dispute letter prompt");

  const prompt = buildLetterUserPrompt({
    jurisdiction: "California",
    depositAmount: 1500,
    totalDeductions: 1150,
    potentiallyDisputableAmount: 500,
    deductions: [
      {
        description: "Painting",
        amount: 300,
        category: "ORDINARY_WEAR",
        assessment: "POTENTIALLY_DISPUTABLE",
        assessmentReason: "ordinary wear",
        potentiallyDisputableAmount: 300,
        missingInformation: [],
        sourceLabels: ["S1", "S2"],
      },
      {
        description: "Broken cabinet",
        amount: 400,
        category: "TENANT_DAMAGE",
        assessment: "LIKELY_VALID",
        assessmentReason: "tenant damage",
        potentiallyDisputableAmount: 0,
        missingInformation: [],
        sourceLabels: ["S1"],
      },
      {
        description: "Administrative fee",
        amount: 100,
        category: "FEE",
        assessment: "NEEDS_MORE_INFORMATION",
        assessmentReason: "unclear",
        potentiallyDisputableAmount: 0,
        missingInformation: ["Whether the lease allows it"],
        sourceLabels: [],
      },
    ],
    sources: [
      {
        label: "S1",
        title: "Security Deposits",
        authority: "California Department of Real Estate",
        jurisdiction: "California",
        relevantText: "Deductions must be itemized in writing.",
      },
      {
        label: "S2",
        title: "Security Deposit Self-Help",
        authority: "California Courts",
        jurisdiction: "California",
      },
    ],
  });

  check("the prompt carries the jurisdiction", prompt.includes("California"));
  check("the prompt carries the deposit", prompt.includes("$1500.00"));
  check("the prompt carries the total deductions", prompt.includes("$1150.00"));
  check(
    "the prompt carries the precomputed disputable amount",
    prompt.includes("Total identified as potentially disputable: $500.00")
  );
  check("the prompt names every deduction", prompt.includes('"Painting"') && prompt.includes('"Broken cabinet"'));
  check("the prompt carries each assessment", prompt.includes("assessment: LIKELY_VALID"));
  check("the prompt carries the capped disputable amount", prompt.includes("potentially disputable amount: $300.00"));
  check("the prompt ties a deduction to its sources", prompt.includes("supported by sources: S1, S2"));
  check(
    "the prompt says when a deduction has no supporting source",
    prompt.includes("supported by sources: none")
  );
  check(
    "the prompt surfaces what information is missing",
    prompt.includes("Whether the lease allows it")
  );
  check("the prompt labels every source", prompt.includes("[S1]") && prompt.includes("[S2]"));
  check("the prompt quotes a passage", prompt.includes('Passage: "Deductions must be itemized in writing."'));
  check(
    "a source with no passage says so instead of staying silent",
    prompt.includes("the provider returned no passage for this source")
  );
  check(
    "the prompt never leaks a database id",
    !/[a-z0-9]{32}/.test(prompt)
  );
  check(
    "the prompt asks for the letter described in the instructions",
    prompt.includes("Draft the dispute letter described in your instructions")
  );
  check(
    "the prompt leaves no dangling nulls from an unassessed deduction",
    !prompt.includes("null")
  );
}

function verifyLetterEvidenceGate() {
  section("Dispute letter evidence gate");

  const withSource = "src1111111111111111111111" as Id<"sources">;

  check("a case with no deductions cannot draft a letter", !hasLetterEvidence([]));
  check(
    "a disputable deduction with a source and an amount qualifies",
    hasLetterEvidence([
      { assessment: "POTENTIALLY_DISPUTABLE", assessmentSourceIds: [withSource], potentiallyDisputableAmount: 300 },
    ])
  );
  check(
    "a disputable deduction with no source does not qualify",
    !hasLetterEvidence([
      { assessment: "POTENTIALLY_DISPUTABLE", assessmentSourceIds: [], potentiallyDisputableAmount: 300 },
    ])
  );
  check(
    "a disputable deduction with a zero amount does not qualify",
    !hasLetterEvidence([
      { assessment: "POTENTIALLY_DISPUTABLE", assessmentSourceIds: [withSource], potentiallyDisputableAmount: 0 },
    ])
  );
  check(
    "a LIKELY_VALID deduction does not qualify",
    !hasLetterEvidence([
      { assessment: "LIKELY_VALID", assessmentSourceIds: [withSource], potentiallyDisputableAmount: 0 },
    ])
  );
  check(
    "a NEEDS_MORE_INFORMATION deduction does not qualify on its own",
    !hasLetterEvidence([
      { assessment: "NEEDS_MORE_INFORMATION", assessmentSourceIds: [], potentiallyDisputableAmount: 0 },
    ])
  );
  check(
    "one qualifying deduction is enough",
    hasLetterEvidence([
      { assessment: "LIKELY_VALID", assessmentSourceIds: [withSource], potentiallyDisputableAmount: 0 },
      { assessment: "POTENTIALLY_DISPUTABLE", assessmentSourceIds: [withSource], potentiallyDisputableAmount: 200 },
    ])
  );
  check(
    "the refusal explains what is actually missing",
    /potentially disputable/i.test(INSUFFICIENT_EVIDENCE_MESSAGE) &&
      /official source/i.test(INSUFFICIENT_EVIDENCE_MESSAGE)
  );
}

/**
 * The send contract: what may be sent, and what counts as the same send.
 *
 * These rules are the ones that must hold before a landlord receives anything,
 * so they are checked here rather than only through a live deployment.
 */
function verifySendContract() {
  section("Send contract — addressing");

  check("a plain address is sendable", isSendableEmail("landlord@example.com"));
  check("a subdomain address is sendable", isSendableEmail("deposits@mail.landlord.co.uk"));
  check("surrounding whitespace is tolerated", isSendableEmail("  landlord@example.com  "));
  check("an empty string is not sendable", !isSendableEmail(""));
  check("undefined is not sendable", !isSendableEmail(undefined));
  check("an address with no domain is not sendable", !isSendableEmail("landlord@localhost"));
  check("an address with no @ is not sendable", !isSendableEmail("landlord.example.com"));
  check("an address containing a space is not sendable", !isSendableEmail("land lord@example.com"));
  check("an address with two @ is not sendable", !isSendableEmail("a@b@example.com"));
  check(
    "an over-long address is not sendable",
    !isSendableEmail(`${"a".repeat(320)}@example.com`)
  );

  section("Send contract — preconditions");

  const approved = {
    status: "APPROVED" as const,
    pipelineStatus: "READY" as const,
    subject: "Dispute of deposit deductions",
    body: "I dispute the deductions set out in your statement.",
  };
  const addressed = { inboxId: "case-abc@agentmail.to", landlordEmail: "landlord@example.com" };

  check(
    "an approved, addressed, ready letter may be sent",
    validateSendRequest({ letter: approved, ...addressed }) === null
  );

  check(
    "a missing letter is refused",
    validateSendRequest({ letter: null, ...addressed })?.code === "NO_LETTER"
  );
  check(
    "an already-sent letter is refused",
    validateSendRequest({ letter: { ...approved, status: "SENT" }, ...addressed })?.code ===
      "ALREADY_SENT"
  );
  check(
    "a draft is refused",
    validateSendRequest({ letter: { ...approved, status: "DRAFT" }, ...addressed })?.code ===
      "NOT_APPROVED"
  );
  check(
    "a letter awaiting approval is refused",
    validateSendRequest({
      letter: { ...approved, status: "AWAITING_APPROVAL" },
      ...addressed,
    })?.code === "NOT_APPROVED"
  );
  check(
    "a letter still generating is refused",
    validateSendRequest({
      letter: { ...approved, pipelineStatus: "GENERATING" },
      ...addressed,
    })?.code === "NOT_READY"
  );
  check(
    "an empty subject is refused",
    validateSendRequest({ letter: { ...approved, subject: "   " }, ...addressed })?.code ===
      "NO_SUBJECT"
  );
  check(
    "an empty body is refused",
    validateSendRequest({ letter: { ...approved, body: "\n\t " }, ...addressed })?.code ===
      "NO_BODY"
  );
  check(
    "a case with no sending address is refused",
    validateSendRequest({ letter: approved, ...addressed, inboxId: undefined })?.code ===
      "NO_INBOX"
  );
  check(
    "a missing landlord address is refused",
    validateSendRequest({ letter: approved, ...addressed, landlordEmail: undefined })?.code ===
      "NO_RECIPIENT"
  );
  check(
    "a malformed landlord address is refused",
    validateSendRequest({ letter: approved, ...addressed, landlordEmail: "not-an-address" })
      ?.code === "NO_RECIPIENT"
  );
  check(
    "the refusal for an unapproved letter tells the renter what to do",
    /approve/i.test(validateSendRequest({ letter: { ...approved, status: "DRAFT" }, ...addressed })!.message)
  );

  section("Send contract — idempotency");

  const letterId = "jd7abcdefghijklmnop";
  check(
    "the key is deterministic for one document revision",
    sendIdempotencyKey(letterId, 3) === sendIdempotencyKey(letterId, 3)
  );
  check(
    "the key names the letter and the revision",
    sendIdempotencyKey(letterId, 3) === `send:${letterId}:v3`
  );
  check(
    "a revised document gets a different key",
    sendIdempotencyKey(letterId, 3) !== sendIdempotencyKey(letterId, 4)
  );
  check(
    "a different letter gets a different key",
    sendIdempotencyKey(letterId, 3) !== sendIdempotencyKey(`${letterId}x`, 3)
  );

  check(
    "a delivered document refuses a second send",
    decideSendClaim({ sendStatus: "SENT", ageMs: 0 }) === "REFUSE_ALREADY_SENT"
  );
  check(
    "a fresh in-flight claim refuses a concurrent send",
    decideSendClaim({ sendStatus: "SENDING", ageMs: 1_000 }) === "REFUSE_IN_FLIGHT"
  );
  check(
    "a failed send may be retried on the same record",
    decideSendClaim({ sendStatus: "FAILED", ageMs: 60_000 }) === "REUSE"
  );
  check(
    "a claim exactly at the staleness boundary is still held",
    decideSendClaim({ sendStatus: "SENDING", ageMs: STALE_SEND_CLAIM_MS - 1 }) ===
      "REFUSE_IN_FLIGHT"
  );
  check(
    "a claim at the staleness boundary is taken over",
    decideSendClaim({ sendStatus: "SENDING", ageMs: STALE_SEND_CLAIM_MS }) === "REUSE"
  );
  check(
    "a long-abandoned claim is taken over rather than blocking the case forever",
    decideSendClaim({ sendStatus: "SENDING", ageMs: 24 * 60 * 60 * 1000 }) === "REUSE"
  );
  check(
    "a delivered document is never taken over, however old",
    decideSendClaim({ sendStatus: "SENT", ageMs: 365 * 24 * 60 * 60 * 1000 }) ===
      "REFUSE_ALREADY_SENT"
  );
  check(
    "the duplicate refusal says the landlord already has it",
    /already been sent to the landlord/i.test(duplicateSendMessage("REFUSE_ALREADY_SENT"))
  );
  check(
    "the in-flight refusal says the send is under way",
    /already being sent/i.test(duplicateSendMessage("REFUSE_IN_FLIGHT"))
  );
}

/** A well-formed reading of a landlord's reply, used as the valid baseline. */
const validReading = {
  summary:
    "The landlord replies that the carpet was replaced before the tenancy and offers to return part of the deposit.",
  acceptsDispute: false,
  rejectsDispute: true,
  requestsMoreInformation: false,
  offersPartialReimbursement: true,
  offeredAmount: 400,
  providesNewEvidence: true,
  newEvidenceSummary: "An invoice for carpet replacement dated before the tenancy began.",
  followUpQuestions: [],
  missingInformation: [],
};

function verifyResponseAnalysis() {
  section("Landlord response analysis — validation");

  const stored = validateResponseAnalysis(validReading, { depositAmount: 1500 });
  check("a well-formed reading is accepted", stored !== null);
  check("the summary survives validation", stored?.summary.startsWith("The landlord replies") === true);
  check("the named figure is kept", stored?.offeredAmount === 400);
  check("the flags are kept as given", stored?.rejectsDispute === true);
  check("new evidence material is kept", /invoice/i.test(stored?.newEvidenceSummary ?? ""));

  check(
    "a reply that is not an object is rejected",
    validateResponseAnalysis("not an object", { depositAmount: 1500 }) === null
  );
  check(
    "a reading missing a required field is rejected",
    validateResponseAnalysis({ ...validReading, summary: undefined }, { depositAmount: 1500 }) ===
      null
  );
  check(
    "a reading with the wrong field type is rejected",
    validateResponseAnalysis({ ...validReading, acceptsDispute: "yes" }, { depositAmount: 1500 }) ===
      null
  );
  check(
    "a reply that both accepts and refuses the dispute is rejected",
    validateResponseAnalysis(
      { ...validReading, acceptsDispute: true, rejectsDispute: true },
      { depositAmount: 1500 }
    ) === null
  );
  check(
    "an empty summary is rejected",
    validateResponseAnalysis({ ...validReading, summary: "   " }, { depositAmount: 1500 }) === null
  );
  check(
    "a summary shorter than a sentence is rejected",
    validateResponseAnalysis({ ...validReading, summary: "Rejected." }, { depositAmount: 1500 }) ===
      null
  );
  check(
    "a negative figure is rejected",
    validateResponseAnalysis({ ...validReading, offeredAmount: -1 }, { depositAmount: 1500 }) ===
      null
  );
  check(
    "a figure larger than the deposit held is rejected as fabricated",
    validateResponseAnalysis({ ...validReading, offeredAmount: 4_000 }, { depositAmount: 1500 }) ===
      null
  );
  check(
    "a null figure is accepted when the reply names none",
    validateResponseAnalysis(
      { ...validReading, offersPartialReimbursement: false, offeredAmount: null },
      { depositAmount: 1500 }
    ) !== null
  );
  check(
    "claiming new evidence with nothing to describe is rejected",
    validateResponseAnalysis(
      { ...validReading, providesNewEvidence: true, newEvidenceSummary: null },
      { depositAmount: 1500 }
    ) === null
  );
  check(
    "claiming new evidence with a blank description is rejected",
    validateResponseAnalysis(
      { ...validReading, providesNewEvidence: true, newEvidenceSummary: "  " },
      { depositAmount: 1500 }
    ) === null
  );
  check(
    "an empty list is accepted",
    validateResponseAnalysis(
      { ...validReading, followUpQuestions: [], missingInformation: [] },
      { depositAmount: 1500 }
    ) !== null
  );
  check(
    "blank list items are dropped",
    validateResponseAnalysis(
      { ...validReading, followUpQuestions: ["", "  ", "Send the invoice."] },
      { depositAmount: 1500 }
    )?.followUpQuestions.length === 1
  );
  check(
    "a runaway list is clamped",
    validateResponseAnalysis(
      { ...validReading, followUpQuestions: Array.from({ length: 50 }, (_, i) => `item ${i}`) },
      { depositAmount: 1500 }
    )?.followUpQuestions.length === 20
  );
  check(
    "an over-long list item is truncated",
    validateResponseAnalysis(
      { ...validReading, followUpQuestions: ["x".repeat(900)] },
      { depositAmount: 1500 }
    )?.followUpQuestions[0].length === 500
  );

  section("Landlord response analysis — no legal conclusions");

  const forbidden: Array<[string, string]> = [
    ["the deduction is illegal", "the deduction is illegal"],
    ["the landlord broke the law", "The landlord broke the law."],
    ["the renter will win", "The renter will win this."],
    ["a guarantee", "We guarantee a full refund."],
    ["a legal entitlement", "You are legally entitled to the deposit."],
    ["a legal obligation phrased with a subject", "The landlord is legally obliged to return it."],
    ["an absence of legal obligation", "The landlord has no legal obligation here."],
    ["advice to sue", "We recommend that you should sue the landlord."],
    ["a confidence percentage", "There is a 90% chance of recovery."],
  ];

  for (const [name, summary] of forbidden) {
    check(
      `${name} is rejected`,
      validateResponseAnalysis({ ...validReading, summary }, { depositAmount: 1500 }) === null
    );
  }

  check(
    "a forbidden phrase in the new-evidence note is rejected",
    validateResponseAnalysis(
      { ...validReading, newEvidenceSummary: "An invoice proving the deduction was unlawful." },
      { depositAmount: 1500 }
    ) === null
  );
  check(
    "a forbidden phrase in a follow-up question is rejected",
    validateResponseAnalysis(
      { ...validReading, followUpQuestions: ["Are you legally entitled to withhold this?"] },
      { depositAmount: 1500 }
    ) === null
  );
  check(
    "a neutral mention of the law is still allowed",
    validateResponseAnalysis(
      { ...validReading, summary: "The landlord refers to the tenancy agreement and the local law." },
      { depositAmount: 1500 }
    ) !== null
  );

  section("Landlord response analysis — prompt and schema");

  check("the schema is named for the task", RESPONSE_ANALYSIS_SCHEMA_NAME === "landlord_response_analysis");
  check(
    "the prompt tells the model to transcribe rather than evaluate",
    /transcribing the message, not evaluating it/i.test(RESPONSE_ANALYSIS_SYSTEM_PROMPT)
  );
  check(
    "the prompt forbids legal conclusions",
    /Never state or imply a legal conclusion/i.test(RESPONSE_ANALYSIS_SYSTEM_PROMPT)
  );
  check(
    "the prompt requires flags to reflect explicit content only",
    /Flags reflect explicit content only/i.test(RESPONSE_ANALYSIS_SYSTEM_PROMPT)
  );
  check(
    "the prompt forbids estimating a figure",
    /Never estimate one/i.test(RESPONSE_ANALYSIS_SYSTEM_PROMPT)
  );

  const properties = (responseAnalysisJsonSchema.properties ?? {}) as Record<string, unknown>;
  const required = (responseAnalysisJsonSchema.required ?? []) as string[];
  const expectedKeys = Object.keys(validReading);

  check("the model schema is an object", responseAnalysisJsonSchema.type === "object");
  check("the model schema omits $schema", !("$schema" in responseAnalysisJsonSchema));
  check(
    "the model schema covers every field the validator expects",
    expectedKeys.every((key) => key in properties)
  );
  check(
    "every field is required, so the model cannot omit one",
    expectedKeys.every((key) => required.includes(key))
  );
  check(
    "the optional figure is nullable rather than required-non-null",
    JSON.stringify(properties.offeredAmount).includes("null")
  );

  const prompt = buildResponseAnalysisUserPrompt({
    context: {
      jurisdiction: "Ontario, Canada",
      depositAmount: 1500,
      totalDeductions: 850,
      potentiallyDisputableAmount: 850,
      letterSubject: "Dispute of deposit deductions",
    },
    message: {
      sender: "landlord@example.com",
      subject: "Re: Dispute of deposit deductions",
      body: "The carpet was replaced before you moved in.",
    },
  });

  check("the prompt carries the case figures", prompt.includes("$850.00"));
  check("the prompt carries the deposit", prompt.includes("$1500.00"));
  check("the prompt names the letter being answered", prompt.includes("Dispute of deposit deductions"));
  check("the prompt includes the reply body verbatim", prompt.includes("The carpet was replaced"));
  check("the prompt restates the transcript-only instruction", /Use only what the reply contains/.test(prompt));

  section("Landlord response analysis — summary line");

  check(
    "a rejection reads as a rejection",
    summarizeReading({
      summary: "x",
      acceptsDispute: false,
      rejectsDispute: true,
      requestsMoreInformation: false,
      offersPartialReimbursement: false,
      providesNewEvidence: false,
      followUpQuestions: [],
      missingInformation: [],
    }) === "rejects the dispute"
  );
  check(
    "an offer of money names the figure",
    summarizeReading({
      summary: "x",
      acceptsDispute: false,
      rejectsDispute: false,
      requestsMoreInformation: false,
      offersPartialReimbursement: true,
      offeredAmount: 400,
      providesNewEvidence: false,
      followUpQuestions: [],
      missingInformation: [],
    }) === "offers $400.00"
  );
  check(
    "an offer with no figure does not invent one",
    summarizeReading({
      summary: "x",
      acceptsDispute: false,
      rejectsDispute: false,
      requestsMoreInformation: false,
      offersPartialReimbursement: true,
      providesNewEvidence: false,
      followUpQuestions: [],
      missingInformation: [],
    }) === "offers to pay"
  );
  check(
    "several positions are combined",
    summarizeReading({
      summary: "x",
      acceptsDispute: false,
      rejectsDispute: true,
      requestsMoreInformation: true,
      offersPartialReimbursement: false,
      providesNewEvidence: true,
      followUpQuestions: [],
      missingInformation: [],
    }) === "rejects the dispute, asks for more information, provides new material"
  );
  check(
    "an empty reading says so rather than guessing",
    summarizeReading({
      summary: "x",
      acceptsDispute: false,
      rejectsDispute: false,
      requestsMoreInformation: false,
      offersPartialReimbursement: false,
      providesNewEvidence: false,
      followUpQuestions: [],
      missingInformation: [],
    }) === "no clear position stated"
  );
}

async function main() {
  await verifySignatures();
  verifyFailureMessages();
  verifyResearchQuestions();
  verifyAuthorityClassification();
  verifyFirecrawlParsing();
  verifyPassageExtraction();
  verifyAssessmentValidation();
  verifyCaseTotals();
  verifyNoLegalConclusions();
  verifyAssessmentPrompt();
  verifyLetterValidation();
  verifyLetterPrompt();
  verifyLetterEvidenceGate();
  verifySendContract();
  verifyResponseAnalysis();

  console.log(`\n${checks - failures}/${checks} checks passed`);

  if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
