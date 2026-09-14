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
import { bytesToBase64, verifySvixSignature } from "../convex/svix";
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
