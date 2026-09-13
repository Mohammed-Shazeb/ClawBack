/**
 * Offline checks for the parts of the email pipeline that do not need a
 * deployment: extraction validation, the JSON Schema handed to the model,
 * webhook payload normalization, signature verification and error redaction.
 *
 * Run with `npm run verify`.
 */

import { createHmac, randomBytes } from "node:crypto";

import {
  agentMailWebhookEventSchema,
  caseInboxLocalPart,
  normalizeInboundMessage,
} from "../convex/agentmail";
import { toSafeMessage } from "../convex/errors";
import {
  buildStatementUserPrompt,
  depositStatementJsonSchema,
  EXTRACTION_SYSTEM_PROMPT,
  parseDepositStatement,
  toExtractionResult,
} from "../convex/extraction";
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

  const long = toSafeMessage(new Error("x".repeat(4000)));
  check("truncates long messages", long.length <= 300, String(long.length));

  check("falls back for non-errors", toSafeMessage(undefined) === "The statement could not be processed.");
  check(
    "falls back for empty messages",
    toSafeMessage(new Error("   ")) === "The statement could not be processed."
  );
}

async function main() {
  await verifySignatures();
  verifyFailureMessages();

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
