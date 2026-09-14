/**
 * End-to-end pipeline verification against a local Convex deployment with
 * mock providers (Firecrawl, OpenAI, AgentMail).
 *
 * Covers: webhook signature verification and idempotency, extraction, research
 * with official-source filtering, evidence-based assessment, case totals
 * computed from stored deductions, status transitions, timeline, authorization,
 * and the retry/re-run paths.
 *
 * Requires: local Convex deployment on :3210/:3211, mocks on :4590/:4591/:4592,
 * and the deployment pointed at the mocks via `npx convex env set`.
 *
 * Run with `npm run verify:e2e`.
 */
import { createHmac } from "node:crypto";

const CONVEX = process.env.CONVEX_URL ?? "http://127.0.0.1:3210";
const SITE = process.env.CONVEX_SITE_URL ?? "http://127.0.0.1:3211";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? "whsec_bW9ja3NlY3JldGZvcnRlc3Rpbmc";

const secretBytes = Buffer.from(WEBHOOK_SECRET.replace(/^whsec_/, ""), "base64");

const checks = [];
let failed = 0;

function check(name, passed, detail) {
  checks.push(`${passed ? "ok  " : "FAIL"} ${name}${!passed && detail !== undefined ? ` — ${detail}` : ""}`);
  if (!passed) failed += 1;
}

async function call(kind, path, args) {
  const res = await fetch(`${CONVEX}/api/${kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, args }),
  });
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

const query = (path, args) => call("query", path, args);
const mutation = (path, args) => call("mutation", path, args);
const action = (path, args) => call("action", path, args);

async function waitFor(description, predicate, { attempts = 60, delayMs = 1000 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await predicate();
      if (result) return true;
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  check(description, false, "timed out");
  return false;
}

let messageCounter = 0;

/**
 * Every run gets its own message-id prefix. The local Convex deployment keeps
 * its data between runs, and inbound mail is idempotent on the provider's
 * message id, so a hard-coded id would be swallowed as an already-processed
 * replay by the next run and the new case would silently receive nothing.
 */
const RUN = `r${Date.now().toString(36)}`;

/** Scopes a logical message id to this run. */
function messageId(name) {
  return `${name}_${RUN}`;
}

/** Builds a signed Svix delivery, exactly as AgentMail would send it. */
function signedDelivery(payload, { id, timestamp } = {}) {
  const body = JSON.stringify(payload);
  const svixId = id ?? `msg_${Date.now()}_${(messageCounter += 1)}`;
  const ts = timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secretBytes).update(`${svixId}.${ts}.${body}`).digest("base64");

  return {
    body,
    headers: {
      "Content-Type": "application/json",
      "svix-id": svixId,
      "svix-timestamp": ts,
      "svix-signature": `v1,${signature}`,
    },
  };
}

function statementEvent(inboxId, { messageId, records }) {
  return {
    event_type: "message.received",
    event_id: `evt_${messageId}`,
    message: {
      message_id: messageId,
      inbox_id: inboxId,
      timestamp: new Date().toISOString(),
      from: "landlord@example.com",
      to: [inboxId],
      subject: "Security Deposit Statement",
      text: records.join("\n"),
      attachments: [],
    },
  };
}

async function deliver(delivery) {
  const res = await fetch(`${SITE}/agentmail/webhook`, {
    method: "POST",
    headers: delivery.headers,
    body: delivery.body,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

const STANDARD_RECORDS = [
  "Security deposit: $1,500",
  "Painting: $300",
  "Carpet replacement: $200",
  "Broken cabinet: $400",
  "Administrative fee: $100",
  "Total deductions: $1,000",
];

async function main() {
  // --- 0. Health ---------------------------------------------------------------
  const version = await fetch(`${CONVEX}/version`).then((r) => r.text()).catch(() => null);
  check("local Convex deployment reachable", version !== null, "cannot reach :3210");

  // --- 1. User + case ----------------------------------------------------------
  const userId = (await mutation("users:ensureDemo", {})).value;
  check("demo user ensured", Boolean(userId));

  const caseId = (await action("cases:createWithInbox", {
    userId,
    jurisdiction: "California",
    depositAmount: 1500,
    totalDeductions: 1000,
  })).value;
  check("case created with inbox provisioning", Boolean(caseId));

  let caseData = null;
  await waitFor("case inbox becomes READY", async () => {
    caseData = (await query("cases:get", { caseId, userId })).value;
    return caseData?.inboxStatus === "READY" && Boolean(caseData?.inboxId);
  });
  check("case email address exists", Boolean(caseData?.inboxId), caseData?.inboxId);

  // --- 2. Signature verification ------------------------------------------------
  const unsigned = await fetch(`${SITE}/agentmail/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(statementEvent(caseData.inboxId, { messageId: messageId("msg_unsigned"), records: STANDARD_RECORDS })),
  });
  check("an unsigned webhook is rejected", unsigned.status === 401, `status=${unsigned.status}`);

  const tampered = signedDelivery(
    statementEvent(caseData.inboxId, { messageId: messageId("msg_tampered"), records: STANDARD_RECORDS })
  );
  tampered.body = tampered.body.replace("$300", "$3");
  const tamperedResult = await fetch(`${SITE}/agentmail/webhook`, {
    method: "POST",
    headers: tampered.headers,
    body: tampered.body,
  });
  check("a tampered body is rejected", tamperedResult.status === 401, `status=${tamperedResult.status}`);

  const staleDelivery = signedDelivery(
    statementEvent(caseData.inboxId, { messageId: messageId("msg_stale"), records: STANDARD_RECORDS }),
    { timestamp: String(Math.floor(Date.now() / 1000) - 3600) }
  );
  const staleResult = await deliver(staleDelivery);
  check("a replayed old delivery is rejected", staleResult.status === 401, `status=${staleResult.status}`);

  // --- 3. Delivery + idempotency -------------------------------------------------
  const delivery = signedDelivery(
    statementEvent(caseData.inboxId, { messageId: messageId("msg_statement_1"), records: STANDARD_RECORDS })
  );
  const first = await deliver(delivery);
  check("a signed webhook is accepted", first.status === 200 && first.body.received === true, JSON.stringify(first.body).slice(0, 120));
  check("the message is associated with its case", first.body.associated === true);

  const replay = await deliver(delivery);
  check("replaying the same delivery creates no second email", replay.body.created === false, JSON.stringify(replay.body).slice(0, 120));

  // --- 4. Extraction -------------------------------------------------------------
  await waitFor("the statement is processed", async () => {
    const emails = (await query("emails:listByCase", { caseId, userId })).value;
    return emails?.some((email) => email.processingStatus === "PROCESSED" || email.processingStatus === "FAILED");
  });

  const emails = (await query("emails:listByCase", { caseId, userId })).value ?? [];
  check("exactly one email was stored despite the replay", emails.length === 1, `stored ${emails.length}`);
  check("the email processed successfully", emails[0]?.processingStatus === "PROCESSED", emails[0]?.processingError);

  let deductions = (await query("deductions:listByCase", { caseId, userId })).value ?? [];
  check("four deductions were extracted", deductions.length === 4, String(deductions.length));
  check(
    "the landlord's wording is preserved",
    deductions.some((d) => d.description === "Broken cabinet")
  );
  check(
    "the extracted total is recomputed from the deductions",
    (await query("cases:get", { caseId, userId })).value?.totalDeductions === 1000
  );

  // --- 5. Research ---------------------------------------------------------------
  await waitFor("every deduction finishes research", async () => {
    deductions = (await query("deductions:listByCase", { caseId, userId })).value ?? [];
    return deductions.length === 4 && deductions.every((d) => d.researchStatus === "COMPLETED");
  }, { attempts: 90 });

  check(
    "every deduction has a research question naming the jurisdiction",
    deductions.every((d) => d.researchQuestion?.includes("California")),
    deductions.map((d) => d.researchStatus).join(",")
  );

  const sources = (await query("sources:listByCase", { caseId, userId })).value ?? [];
  check("official sources were stored", sources.length > 0, String(sources.length));
  check(
    "no non-official source was stored",
    sources.every((s) => !s.url.includes("lawfirm-marketing") && !s.url.includes("reddit"))
  );
  check(
    "every stored source is a government host",
    sources.every((s) => /\.gov$|\.gov\./.test(new URL(s.url).hostname) || /state\.[a-z]{2}\.us$/.test(new URL(s.url).hostname)),
    sources.map((s) => s.url).join(" ")
  );
  check("every source is tied to a deduction", sources.every((s) => Boolean(s.deductionId)));
  check("every source carries the case jurisdiction", sources.every((s) => s.jurisdiction === "California"));
  check("every source has a retrieval timestamp", sources.every((s) => typeof s.retrievedAt === "number"));

  // --- 6. Assessment --------------------------------------------------------------
  await waitFor("every deduction finishes assessment", async () => {
    deductions = (await query("deductions:listByCase", { caseId, userId })).value ?? [];
    return deductions.length > 0 && deductions.every((d) => d.assessmentStatus === "COMPLETED");
  }, { attempts: 90 });

  // Always re-read after a poll: if the wait timed out it left `deductions` empty,
  // and every assertion below would silently compare against nothing.
  deductions = (await query("deductions:listByCase", { caseId, userId })).value ?? [];
  check("four deductions survived research and assessment", deductions.length === 4, String(deductions.length));

  const byDescription = Object.fromEntries(deductions.map((d) => [d.description, d]));

  check("painting is POTENTIALLY_DISPUTABLE", byDescription.Painting?.assessment === "POTENTIALLY_DISPUTABLE");
  check(
    "the disputable amount is capped at the stated deduction (mock claimed 9999)",
    byDescription.Painting?.potentiallyDisputableAmount === 300,
    String(byDescription.Painting?.potentiallyDisputableAmount)
  );
  check("broken cabinet is LIKELY_VALID", byDescription["Broken cabinet"]?.assessment === "LIKELY_VALID");
  check(
    "a LIKELY_VALID deduction contributes 0",
    byDescription["Broken cabinet"]?.potentiallyDisputableAmount === 0,
    String(byDescription["Broken cabinet"]?.potentiallyDisputableAmount)
  );
  check(
    "the administrative fee is NEEDS_MORE_INFORMATION",
    byDescription["Administrative fee"]?.assessment === "NEEDS_MORE_INFORMATION"
  );
  check(
    "carpet replacement is POTENTIALLY_DISPUTABLE and capped at 200",
    byDescription["Carpet replacement"]?.assessment === "POTENTIALLY_DISPUTABLE" &&
      byDescription["Carpet replacement"]?.potentiallyDisputableAmount === 200
  );
  check(
    "every assessed deduction cites a stored source unless the evidence was insufficient",
    deductions.every(
      (d) => d.assessment === "NEEDS_MORE_INFORMATION" || (d.assessmentSourceIds ?? []).length > 0
    ),
    deductions.map((d) => `${d.description}:${d.assessment}/${(d.assessmentSourceIds ?? []).length}`).join(",")
  );
  check(
    "a NEEDS_MORE_INFORMATION deduction says what is missing",
    deductions.every(
      (d) => d.assessment !== "NEEDS_MORE_INFORMATION" || (d.assessmentMissingInformation ?? []).length > 0
    )
  );
  check(
    "every source cited by an assessment belongs to that deduction",
    deductions.every((d) => {
      const owned = new Set(sources.filter((s) => s.deductionId === d._id).map((s) => s._id));
      return (d.assessmentSourceIds ?? []).every((id) => owned.has(id));
    })
  );
  check(
    "each assessment carries a reasoning summary",
    deductions.every((d) => (d.assessmentReason ?? "").trim().length > 0)
  );
  check(
    "no assessment claims a deduction is illegal",
    deductions.every((d) => !/\billegal\b|\bunlawful\b|will recover|guarantee/i.test(d.assessmentReason ?? ""))
  );

  // --- 7. Case totals and status ---------------------------------------------------
  caseData = (await query("cases:get", { caseId, userId })).value;
  const expectedDisputable = deductions
    .filter((d) => d.assessment === "POTENTIALLY_DISPUTABLE")
    .reduce((total, d) => total + Math.min(d.potentiallyDisputableAmount ?? 0, d.amount ?? 0), 0);
  check(
    "the case total equals the sum of the stored disputable amounts",
    caseData?.potentiallyDisputableAmount === expectedDisputable,
    `${caseData?.potentiallyDisputableAmount} vs ${expectedDisputable}`
  );
  check(
    "the disputable total never exceeds the total deductions",
    (caseData?.potentiallyDisputableAmount ?? 0) <= (caseData?.totalDeductions ?? 0)
  );
  check("the case reached EVIDENCE_FOUND", caseData?.status === "EVIDENCE_FOUND", caseData?.status);
  check("the case did not jump ahead to DRAFT_READY", caseData?.status !== "DRAFT_READY");

  // --- 8. Timeline ------------------------------------------------------------------
  const timeline = (await query("cases:getTimeline", { caseId, userId })).value ?? [];
  const types = timeline.map((event) => event.type);
  for (const type of [
    "CASE_CREATED",
    "INBOX_READY",
    "EMAIL_RECEIVED",
    "ANALYSIS_STARTED",
    "ANALYSIS_COMPLETED",
    "RESEARCH_STARTED",
    "RESEARCH_COMPLETED",
    "ASSESSMENT_STARTED",
    "ASSESSMENT_COMPLETED",
  ]) {
    check(`the timeline records ${type}`, types.includes(type));
  }
  check(
    "the timeline has exactly one event per deduction per real step",
    types.filter((t) => t === "RESEARCH_COMPLETED").length === 4 &&
      types.filter((t) => t === "ASSESSMENT_COMPLETED").length === 4,
    `research=${types.filter((t) => t === "RESEARCH_COMPLETED").length} assessment=${types.filter((t) => t === "ASSESSMENT_COMPLETED").length}`
  );

  // --- 9. Authorization --------------------------------------------------------------
  const intruder = (await mutation("users:createOrGet", { email: `intruder-${Date.now()}@clawback.local` })).value;

  const forbiddenCase = await query("cases:get", { caseId, userId: intruder });
  check("another user cannot read the case", forbiddenCase.status === "error" || forbiddenCase.value === null);
  check("another user cannot read the deductions", (await query("deductions:listByCase", { caseId, userId: intruder })).status === "error");
  check("another user cannot read the sources", (await query("sources:listByCase", { caseId, userId: intruder })).status === "error");
  check("another user cannot read the timeline", (await query("cases:getTimeline", { caseId, userId: intruder })).status === "error");
  check("another user cannot read the emails", (await query("emails:listByCase", { caseId, userId: intruder })).status === "error");

  // Capture a concrete deduction to attack with. Re-read rather than trusting the
  // loop variable above, which a timed-out wait may have overwritten with [].
  const owned = (await query("deductions:listByCase", { caseId, userId })).value ?? [];
  check("the case still has deductions to attack", owned.length > 0, String(owned.length));
  const targetDeductionId = owned[0]._id;

  const foreignRetry = await mutation("research:retryResearch", { deductionId: targetDeductionId, userId: intruder });
  check("another user cannot re-run research", foreignRetry.status === "error", JSON.stringify(foreignRetry).slice(0, 100));
  const foreignAssess = await mutation("assessments:retryAssessment", { deductionId: targetDeductionId, userId: intruder });
  check("another user cannot re-run an assessment", foreignAssess.status === "error", JSON.stringify(foreignAssess).slice(0, 100));

  // --- 10. Idempotency of re-running research ----------------------------------------
  const countResearchStarts = async () =>
    (
      (await query("cases:getTimeline", { caseId, userId })).value ?? []
    ).filter(
      (e) => e.type === "RESEARCH_STARTED" && e.metadata?.deductionId === targetDeductionId
    ).length;

  const researchEventsBefore = await countResearchStarts();
  await mutation("research:retryResearch", { deductionId: targetDeductionId, userId });

  await waitFor("the re-run research settles", async () => {
    const current = (await query("deductions:listByCase", { caseId, userId })).value ?? [];
    return current.find((d) => d._id === targetDeductionId)?.researchStatus === "COMPLETED";
  }, { attempts: 60 });

  const researchEventsAfter = await countResearchStarts();
  check(
    "re-running research starts exactly one new pass",
    researchEventsAfter === researchEventsBefore + 1,
    `${researchEventsBefore} -> ${researchEventsAfter}`
  );

  const sourcesAfter = (await query("sources:listByCase", { caseId, userId })).value ?? [];
  const ownedAfter = sourcesAfter.filter((s) => s.deductionId === targetDeductionId);
  check(
    "re-running research does not duplicate sources for the deduction",
    ownedAfter.length <= 3,
    String(ownedAfter.length)
  );
  check(
    "every stored source still belongs to exactly one deduction",
    sourcesAfter.every((s) => Boolean(s.deductionId))
  );

  // --- 11. Revised statement rewrites deductions without rewinding the case ----------
  const revision = signedDelivery(
    statementEvent(caseData.inboxId, {
      messageId: messageId("msg_statement_2"),
      records: [
        "Security deposit: $1,500",
        "Painting: $300",
        "Carpet replacement: $200",
        "Broken cabinet: $400",
        "Administrative fee: $100",
        "Blind replacement: $150",
        "Total deductions: $1,150",
      ],
    })
  );

  let sawRegression = false;
  const revisionResult = await deliver(revision);
  check("the revised statement is accepted", revisionResult.status === 200 && revisionResult.body.created === true);

  await waitFor("the revised statement finishes processing", async () => {
    const current = (await query("deductions:listByCase", { caseId, userId })).value ?? [];
    const currentCase = (await query("cases:get", { caseId, userId })).value;
    if (currentCase?.status === "ANALYZING") sawRegression = true;
    return (
      current.length === 5 &&
      current.every((d) => d.assessmentStatus === "COMPLETED" || d.assessmentStatus === "FAILED")
    );
  }, { attempts: 150, delayMs: 1000 });

  check("a revised statement never rewinds the case status", !sawRegression);

  caseData = (await query("cases:get", { caseId, userId })).value;
  check("the revised total deductions is recomputed", caseData?.totalDeductions === 1150, String(caseData?.totalDeductions));
  check(
    "the case stays at EVIDENCE_FOUND after a revision",
    caseData?.status === "EVIDENCE_FOUND",
    caseData?.status
  );

  const finalDeductions = (await query("deductions:listByCase", { caseId, userId })).value ?? [];
  const finalExpected = finalDeductions
    .filter((d) => d.assessment === "POTENTIALLY_DISPUTABLE")
    .reduce((total, d) => total + Math.min(d.potentiallyDisputableAmount ?? 0, d.amount ?? 0), 0);
  check(
    "the disputable total still equals the stored assessments",
    caseData?.potentiallyDisputableAmount === finalExpected,
    `${caseData?.potentiallyDisputableAmount} vs ${finalExpected}`
  );
  check(
    "no deduction was left silently unprocessed",
    finalDeductions.every((d) => d.researchStatus === "COMPLETED" && d.assessmentStatus === "COMPLETED"),
    finalDeductions.map((d) => `${d.description}:${d.researchStatus}/${d.assessmentStatus}`).join(", ")
  );

  // --- 12. Failure handling ------------------------------------------------------------
  const doomedUser = (await mutation("users:createOrGet", { email: `doomed-${Date.now()}@clawback.local` })).value;
  const doomedCase = (await mutation("cases:create", {
    userId: doomedUser,
    jurisdiction: "Nowhere",
    depositAmount: 100,
    totalDeductions: 0,
  })).value;

  const doomedDelivery = signedDelivery({
    event_type: "message.received",
    event_id: "evt_doomed",
    message: {
      message_id: `msg_doomed_${Date.now()}`,
      inbox_id: "no-such-case-inbox@agentmail.to",
      timestamp: new Date().toISOString(),
      from: "someone@example.com",
      to: ["no-such-case-inbox@agentmail.to"],
      subject: "Stray statement",
      text: "Painting: $50",
      attachments: [],
    },
  });
  const doomedResult = await deliver(doomedDelivery);
  check(
    "mail to an unknown inbox is stored for review, not attached by guesswork",
    doomedResult.status === 200 && doomedResult.body.associated === false,
    JSON.stringify(doomedResult.body).slice(0, 120)
  );

  const emptyCase = (await query("cases:get", { caseId: doomedCase, userId: doomedUser })).value;
  check("a case with no findings keeps a zero disputable total", emptyCase?.potentiallyDisputableAmount === 0);
  check("a case with no email stays RECEIVED", emptyCase?.status === "RECEIVED", emptyCase?.status);

  // --- Report ---------------------------------------------------------------------------
  console.log(checks.join("\n"));
  console.log(`\n${checks.length - failed}/${checks.length} e2e checks passed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.log(checks.join("\n"));
  console.error(
    `\nABORTED after ${checks.length} checks (${checks.length - failed} passed) — the harness threw.`
  );
  console.error(error);
  process.exit(1);
});
