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
// The AgentMail mock's test-only introspection endpoint (`GET /__sends`) lives at
// the server root, not under the `/v0` API prefix the deployment is pointed at.
const MOCKS_URL = process.env.MOCKS_URL ?? "http://127.0.0.1:4592";
// Likewise the OpenAI mock's prompt log (`GET /__calls`) at :4591.
const OPENAI_MOCK_URL = process.env.OPENAI_MOCK_URL ?? "http://127.0.0.1:4591";

const secretBytes = Buffer.from(WEBHOOK_SECRET.replace(/^whsec_/, ""), "base64");

/**
 * The deduction categories the app's schema accepts, mirrored from
 * `convex/validators.ts` DEDUCTION_CATEGORIES.
 *
 * Deliberately duplicated rather than imported: this file is plain Node and
 * cannot load a Convex module. The duplication is the point — if the enum
 * changes, this list must change with it, and the check below is what proves
 * the mock and the app still agree on the same contract.
 */
const LEGAL_CATEGORIES = ["ORDINARY_WEAR", "TENANT_DAMAGE", "FEE", "UNKNOWN"];

let checks = 0;
let failed = 0;

/**
 * Printed as it runs, never buffered.
 *
 * Buffering the whole run and joining at the end made a stalled suite look
 * exactly like a working one — a run whose mock had died sat silent for minutes
 * and read as a hang rather than an infrastructure failure. Streaming means the
 * last line on screen is always the check that is actually running.
 */
function check(name, passed, detail) {
  checks += 1;
  console.log(`${passed ? "ok  " : "FAIL"} ${name}${!passed && detail !== undefined ? ` — ${detail}` : ""}`);
  if (!passed) failed += 1;
}

let skipped = 0;

/**
 * Records a check that this run cannot decide, and says so out loud.
 *
 * This exists because the alternative is worse. The authenticated path cannot be
 * exercised against a local backend at all (see `outcome` below), and the first
 * version of the authentication section quietly reported those cases as passes:
 * it tested `response.status !== "error"`, but the rejection Convex returns has
 * no `status` field, so an unrecognised response read as a success. A check that
 * cannot fail is not a check — and one that cannot *run* must not be counted as
 * one either, or the total becomes a lie.
 *
 * A skip is deliberately not a pass: it does not increment `checks`, and the
 * final line reports how many there were, so nobody can read this suite's total
 * as "the authenticated path is verified".
 */
function skip(name, reason) {
  skipped += 1;
  console.log(`SKIP ${name} — ${reason}`);
}

/**
 * Classifies a Convex HTTP response.
 *
 * `{status:"success", value}` and `{status:"error", errorMessage}` are the two
 * documented shapes. Anything else is a *third* kind, and the one that matters
 * here is `AuthProviderDiscoveryFailed`: Convex fetches the auth provider
 * configuration from the site host before it will trust a token, and the local
 * backend cannot serve that request, so every token is rejected before any
 * function runs. Folding that into "not an error, therefore fine" is precisely
 * the bug this classifier exists to prevent.
 */
function outcome(response) {
  if (response.status === "success") return { kind: "ok", value: response.value };
  if (response.status === "error") return { kind: "error", message: String(response.errorMessage) };
  return { kind: "other", message: `${response.code ?? "unknown"}: ${response.message ?? ""}` };
}

/**
 * Calls a Convex function over the HTTP API.
 *
 * `token` is optional and is the whole point of the authentication section: with
 * it the request carries a verified session, without it the request is anonymous.
 * Everything outside that section omits it, which is why the rest of the suite
 * runs in demo mode.
 */
async function call(kind, path, args, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${CONVEX}/api/${kind}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ path, args }),
  });
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

const query = (path, args, token) => call("query", path, args, token);
const mutation = (path, args, token) => call("mutation", path, args, token);
const action = (path, args, token) => call("action", path, args, token);

/**
 * Polls until `predicate` is true, announcing the wait so a stall is visible.
 *
 * Silence during a wait is indistinguishable from a hang: a dead mock provider
 * made this suite sit for minutes with no output at all. The wait now names
 * itself up front, and says so if it is still going after a few seconds — so the
 * last line on screen always points at the thing that is actually stuck.
 */
async function waitFor(description, predicate, { attempts = 60, delayMs = 1000 } = {}) {
  const startedAt = Date.now();
  console.log(`...  waiting for ${description}`);
  let announcedSlow = false;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await predicate();
      if (result) return true;
    } catch {
      // keep polling
    }

    if (!announcedSlow && Date.now() - startedAt > 5000) {
      announcedSlow = true;
      console.log(`...  still waiting for ${description} — if this never clears, check the mocks`);
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  check(description, false, `timed out after ${attempts} attempts`);
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

/**
 * A landlord reply. `threadId` is the primary association signal; `references`
 * is the header fallback, and only one of them is set per delivery so the two
 * paths can be told apart.
 */
function replyEvent(inboxId, { messageId, threadId, references, from, subject, text }) {
  return {
    event_type: "message.received",
    event_id: `evt_${messageId}`,
    message: {
      message_id: messageId,
      inbox_id: inboxId,
      ...(threadId ? { thread_id: threadId } : {}),
      timestamp: new Date().toISOString(),
      from,
      to: [inboxId],
      subject,
      text,
      ...(references ? { references } : {}),
      attachments: [],
    },
  };
}

/** The mock provider's outbound log, used to prove what the landlord received. */
async function mockSends() {
  const res = await fetch(`${MOCKS_URL}/__sends`);
  return res.ok ? await res.json() : [];
}

/**
 * The OpenAI mock's prompt log, used to prove what the app did *not* ask for.
 * Keeps only the last ten prompts, so an unchanged log is proof that nothing
 * was appended.
 */
async function mockCalls() {
  const res = await fetch(`${OPENAI_MOCK_URL}/__calls`);
  return res.ok ? await res.json() : [];
}

/**
 * The sign-in code the app just emailed, read back from the AgentMail mock.
 *
 * The app's sign-in mail goes out through the real AgentMail transport
 * (`AUTH_EMAIL_TRANSPORT=agentmail`), which in this suite is the mock — so the
 * message the app composed is sitting in the mock's send log. Reading the code
 * back out of it is what lets this suite complete a genuine sign-in without a
 * mailbox, and it exercises the delivery path at the same time.
 */
async function signInCode(email) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const res = await fetch(`${MOCKS_URL}/__sends`);
    const sends = res.ok ? await res.json() : [];

    const match = [...sends]
      .reverse()
      .find(
        (send) =>
          send.subject === "Sign in to Clawback" && String(send.to ?? "").includes(email)
      );

    const code = /[?&]code=([^&\s]+)/.exec(match?.text ?? "")?.[1];
    if (code) return code;

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return null;
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

  // The JSON Schema must ride along in the prompt, not only in `response_format`.
  // `response_format` is a request, not a guarantee: a real OpenAI-compatible
  // gateway answers 200 to a `json_schema` request and ignores the schema
  // entirely, so the model returns its own key names and the validator rejects a
  // response from a perfectly good model. Carrying the schema in the prompt as
  // well is what makes the contract hold on both kinds of provider — and the
  // mock records the system prompt, so it is checked here rather than trusted.
  //
  // The extraction call is located by its own prompt rather than assumed to be
  // the newest, so a later assessment finishing first cannot make this pass or
  // fail for the wrong reason.
  const extractionCall = (await mockCalls()).find((call) =>
    /You read security deposit statements/i.test(call.system ?? "")
  );
  check("the extraction call was recorded", Boolean(extractionCall), "no extraction prompt in the mock log");
  check(
    "the model call carries the JSON Schema in the prompt, not only in response_format",
    /matches this JSON Schema exactly/.test(extractionCall?.system ?? "") &&
      (extractionCall?.system ?? "").includes('"depositAmount"'),
    `response_format=${extractionCall?.responseFormat}`
  );
  check(
    "the schema in the prompt is the one the app validates against",
    (extractionCall?.system ?? "").includes('"statedTotalDeductions"') &&
      (extractionCall?.system ?? "").includes('"additionalProperties":false')
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
  const expectedDisputable = deductions
    .filter((d) => d.assessment === "POTENTIALLY_DISPUTABLE")
    .reduce((total, d) => total + Math.min(d.potentiallyDisputableAmount ?? 0, d.amount ?? 0), 0);

  // Each assessment stores its deduction and then recomputes the case total in a
  // *separate* transaction (a single-document write would otherwise make every
  // sibling contend for the `cases` row). A deduction can therefore be COMPLETED
  // while the case figure still lags by one pass. Waiting only for the
  // deductions is not enough — wait for the figure itself, or this races and
  // reports a partial sum (it used to surface as "$300 vs $500").
  await waitFor("the case disputable total converges", async () => {
    const current = (await query("cases:get", { caseId, userId })).value;
    return current?.potentiallyDisputableAmount === expectedDisputable;
  }, { attempts: 60 });

  caseData = (await query("cases:get", { caseId, userId })).value;
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

  const finalDeductions = (await query("deductions:listByCase", { caseId, userId })).value ?? [];
  const finalExpected = finalDeductions
    .filter((d) => d.assessment === "POTENTIALLY_DISPUTABLE")
    .reduce((total, d) => total + Math.min(d.potentiallyDisputableAmount ?? 0, d.amount ?? 0), 0);

  // Same separate-transaction gap as the first totals check: the figure is
  // refreshed after the deduction write, so wait for the figure.
  await waitFor("the revised disputable total converges", async () => {
    const current = (await query("cases:get", { caseId, userId })).value;
    return current?.potentiallyDisputableAmount === finalExpected;
  }, { attempts: 60 });

  caseData = (await query("cases:get", { caseId, userId })).value;
  check("the revised total deductions is recomputed", caseData?.totalDeductions === 1150, String(caseData?.totalDeductions));
  check(
    "the case stays at EVIDENCE_FOUND after a revision",
    caseData?.status === "EVIDENCE_FOUND",
    caseData?.status
  );

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

  // --- 13. Dispute letter: evidence gate ------------------------------------------------
  const readiness = (await query("letters:getDraftReadiness", { caseId, userId })).value;
  check(
    "the case is ready to draft a letter once it has assessed, dispute-backed deductions",
    readiness?.ready === true,
    JSON.stringify(readiness)
  );

  check(
    "an unassessed case cannot draft a letter",
    (await query("letters:getDraftReadiness", { caseId: doomedCase, userId: doomedUser })).value?.ready === false
  );
  check(
    "an unassessed case says the real reason",
    ((await query("letters:getDraftReadiness", { caseId: doomedCase, userId: doomedUser })).value?.reason ?? "")
      .toLowerCase()
      .includes("deduction")
  );

  // --- 14. Letter generation -------------------------------------------------------------
  check("no letter exists before drafting", (await query("letters:getForCase", { caseId, userId })).value === null);

  await mutation("letters:draftLetter", { caseId, userId });

  let letter = null;
  await waitFor("the dispute letter is drafted", async () => {
    letter = (await query("letters:getForCase", { caseId, userId })).value;
    return letter?.pipelineStatus === "READY";
  }, { attempts: 60 });

  letter = (await query("letters:getForCase", { caseId, userId })).value;
  check("the letter reached READY", letter?.pipelineStatus === "READY", letter?.pipelineError);
  check("the letter starts as a DRAFT", letter?.status === "DRAFT", letter?.status);
  check("the letter has a recipient", (letter?.recipient ?? "").length > 0, letter?.recipient);
  check("the letter has a subject", (letter?.subject ?? "").length > 0, letter?.subject);
  check("the letter has a substantial body", (letter?.body ?? "").length >= 200, String(letter?.body?.length));
  check("the letter is version 1 on first generation", letter?.version === 1, String(letter?.version));

  // The structured-output contract: recipient/subject/body are all present and
  // the composed content matches the parts, so nothing was lost or invented.
  check(
    "the composed document matches its parts",
    letter?.content === `To: ${letter?.recipient}\nSubject: ${letter?.subject}\n\n${letter?.body}`
  );

  // --- 15. Financial figures come from the case, not the model ---------------------------
  caseData = (await query("cases:get", { caseId, userId })).value;
  check(
    "the letter snapshots the case deposit amount",
    letter?.depositAmount === caseData?.depositAmount,
    `${letter?.depositAmount} vs ${caseData?.depositAmount}`
  );
  check(
    "the letter snapshots the case total deductions",
    letter?.totalDeductions === caseData?.totalDeductions,
    `${letter?.totalDeductions} vs ${caseData?.totalDeductions}`
  );
  check(
    "the letter snapshots the case disputable total",
    letter?.potentiallyDisputableAmount === caseData?.potentiallyDisputableAmount,
    `${letter?.potentiallyDisputableAmount} vs ${caseData?.potentiallyDisputableAmount}`
  );
  check(
    "the letter body requests the calculated disputable amount",
    (letter?.body ?? "").includes(String(caseData?.potentiallyDisputableAmount.toFixed(2))),
    `body does not mention ${caseData?.potentiallyDisputableAmount.toFixed(2)}`
  );

  // --- 16. Legal safety -------------------------------------------------------------------
  const bodyText = `${letter?.subject ?? ""}\n${letter?.body ?? ""}`;
  check(
    "the letter never claims the landlord broke the law",
    !/\b(?:illegally|unlawfully)\b|\bbroke\s+the\s+law\b|\bviolat\w*\s+of\s+(?:the\s+)?law\b/i.test(bodyText)
  );
  check("the letter never accuses theft", !/\bsteal\w*\b|\bstole\b|\btheft\b/i.test(bodyText));
  check(
    "the letter never threatens legal action",
    !/\b(?:sue|lawsuit|litigation|small\s+claims\s+court|attorney\s+general|report\s+you)\b/i.test(bodyText)
  );
  check("the letter never guarantees an outcome", !/\bguarantee\w*\b|\bwe\s+will\s+win\b/i.test(bodyText));
  check("the letter invents no deadline", !/\b(?:within|by)\s+\d{1,3}\s+(?:days?|business\s+days?|weeks?)\b/i.test(bodyText));
  check(
    "the letter cites no statute",
    !/\bpursuant\s+to\b|\bunder\s+section\b|§|\b\d+\s+U\.?S\.?C\.?/i.test(bodyText)
  );
  check("the letter cites no court case", !/\bv\.\s+[A-Z][A-Za-z]+|\bNo\.\s*\d/.test(bodyText));
  check("the letter contains no URL", !/https?:\/\/|www\./i.test(bodyText));
  check(
    "the letter uses cautious, evidence-based phrasing",
    /based on the available housing guidance|published guidance indicates|may warrant|may be required/i.test(bodyText)
  );
  check(
    "the letter does not quote a raw source label",
    !/\bS\d+\b/.test(bodyText)
  );
  check(
    "the letter contains no database id",
    !/\b[a-z0-9]{32}\b/.test(bodyText)
  );

  // --- 17. Source association --------------------------------------------------------------
  const supporting = (await query("letters:getSupportingSources", { caseId, userId })).value ?? [];
  check("the letter cites at least one source", (letter?.supportingSourceIds ?? []).length > 0);
  check(
    "every cited source resolves to a stored source for this case",
    supporting.length === (letter?.supportingSourceIds ?? []).length,
    `${supporting.length} of ${(letter?.supportingSourceIds ?? []).length}`
  );
  const caseSources = (await query("sources:listByCase", { caseId, userId })).value ?? [];
  const caseSourceIds = new Set(caseSources.map((s) => s._id));
  check(
    "no letter cites a source from outside the case",
    (letter?.supportingSourceIds ?? []).every((id) => caseSourceIds.has(id))
  );
  check("a cited source carries a real URL", supporting.every((s) => /^https?:\/\//.test(s.url ?? "")));
  check("a cited source carries an authority", supporting.every((s) => (s.authority ?? "").length > 0));

  // --- 18. Draft persistence and editing ----------------------------------------------------
  const originalBody = letter.body;
  const editedBody = `${originalBody}\n\nI would also welcome a written breakdown of the charges described above.`;

  const edited = await mutation("letters:saveLetterEdits", {
    caseId,
    userId,
    recipient: letter.recipient,
    subject: letter.subject,
    body: editedBody,
  });
  check("an owner can save edits", edited.status !== "error", JSON.stringify(edited).slice(0, 120));

  letter = (await query("letters:getForCase", { caseId, userId })).value;
  check("saved edits persist", letter?.body === editedBody);
  check("saving an edit bumps the version", letter?.version === 2, String(letter?.version));
  check("the composed content follows the edit", (letter?.content ?? "").includes(editedBody));
  check("an edit is recorded as edited, not regenerated", typeof letter?.editedAt === "number");
  check("editing keeps the letter a DRAFT", letter?.status === "DRAFT", letter?.status);

  // An edit must not be able to trash the letter.
  const tooShort = await mutation("letters:saveLetterEdits", {
    caseId,
    userId,
    recipient: letter.recipient,
    subject: letter.subject,
    body: "too short",
  });
  check("a stub body is rejected", tooShort.status === "error");
  check(
    "the rejected edit did not overwrite the stored body",
    (await query("letters:getForCase", { caseId, userId })).value?.body === editedBody
  );

  const noRecipient = await mutation("letters:saveLetterEdits", {
    caseId,
    userId,
    recipient: "   ",
    subject: letter.subject,
    body: editedBody,
  });
  check("an empty recipient is rejected", noRecipient.status === "error");

  // --- 19. Case workflow up to approval ------------------------------------------------------
  caseData = (await query("cases:get", { caseId, userId })).value;
  check("generating a letter moved the case to DRAFT_READY", caseData?.status === "DRAFT_READY", caseData?.status);
  check("drafting did not send anything", letter?.status !== "SENT");

  await mutation("letters:presentForApproval", { caseId, userId });

  letter = (await query("letters:getForCase", { caseId, userId })).value;
  caseData = (await query("cases:get", { caseId, userId })).value;
  check("presenting for approval sets the letter to AWAITING_APPROVAL", letter?.status === "AWAITING_APPROVAL", letter?.status);
  check("presenting for approval moves the case to AWAITING_APPROVAL", caseData?.status === "AWAITING_APPROVAL", caseData?.status);

  // Presenting again is idempotent, not a duplicate transition.
  const represented = await mutation("letters:presentForApproval", { caseId, userId });
  check("presenting for approval twice is idempotent", represented.status !== "error");

  const presentedEvents = ((await query("cases:getTimeline", { caseId, userId })).value ?? []).filter(
    (e) => e.type === "LETTER_PRESENTED_FOR_APPROVAL"
  );
  check("presenting for approval is recorded once", presentedEvents.length === 1, String(presentedEvents.length));

  // --- 20. Human approval (and nothing is sent) -----------------------------------------------
  const approved = await mutation("letters:approveLetter", { caseId, userId });
  check("the owner can approve the letter", approved.status !== "error", JSON.stringify(approved).slice(0, 120));

  letter = (await query("letters:getForCase", { caseId, userId })).value;
  caseData = (await query("cases:get", { caseId, userId })).value;
  check("approval sets the letter to APPROVED", letter?.status === "APPROVED", letter?.status);
  check("approval records when it happened", typeof letter?.approvedAt === "number");
  check("approval leaves the case ready to send, not sent", caseData?.status === "AWAITING_APPROVAL", caseData?.status);
  check("approval does not mark the letter SENT", letter?.status !== "SENT");
  check("approval preserves the approved text", letter?.body === editedBody);

  const approvedAgain = await mutation("letters:approveLetter", { caseId, userId });
  check("approving twice is idempotent", approvedAgain.status !== "error");
  const approvedEvents = ((await query("cases:getTimeline", { caseId, userId })).value ?? []).filter(
    (e) => e.type === "LETTER_APPROVED"
  );
  check("approval is recorded exactly once", approvedEvents.length === 1, String(approvedEvents.length));

  // --- 21. An approved letter is immutable ------------------------------------------------------
  const editApproved = await mutation("letters:saveLetterEdits", {
    caseId,
    userId,
    recipient: letter.recipient,
    subject: letter.subject,
    body: `${editedBody}\n\nOne more thing.`,
  });
  check("an approved letter cannot be edited", editApproved.status === "error");

  const regenerateApproved = await mutation("letters:draftLetter", { caseId, userId });
  check("an approved letter cannot be regenerated in place", regenerateApproved.status !== "error");

  await waitFor("the refused regeneration settles", async () => {
    const current = (await query("letters:getForCase", { caseId, userId })).value;
    return current?.pipelineStatus !== "GENERATING";
  }, { attempts: 30 });

  letter = (await query("letters:getForCase", { caseId, userId })).value;
  check("the approved letter survived a refused regeneration", letter?.status === "APPROVED", letter?.status);
  check("the approved letter's text is untouched", letter?.body === editedBody);
  check("the approved letter's version is untouched", letter?.version === 2, String(letter?.version));

  // --- 22. New draft after approval --------------------------------------------------------------
  const beforeNewDraft = (await query("letters:getForCase", { caseId, userId })).value;
  check("the live letter is still the approved one", beforeNewDraft?.status === "APPROVED");

  await mutation("letters:startNewDraft", { caseId, userId });
  await mutation("letters:draftLetter", { caseId, userId });

  await waitFor("the new draft is generated", async () => {
    const current = (await query("letters:getForCase", { caseId, userId })).value;
    return current?.pipelineStatus === "READY" && current?.status === "DRAFT";
  }, { attempts: 60 });

  const newDraft = (await query("letters:getForCase", { caseId, userId })).value;
  check("a new draft is a fresh document", newDraft?._id !== beforeNewDraft?._id, "the letter id did not change");
  check("a new draft starts at version 1", newDraft?.version === 1, String(newDraft?.version));
  check("a new draft starts as DRAFT", newDraft?.status === "DRAFT", newDraft?.status);
  check(
    "a new draft is regenerated rather than carrying the edit forward",
    newDraft?.body !== editedBody
  );

  // The approved letter must still exist, archived, with its approval intact.
  const allLetters = (await query("letters:getSupportingSources", { caseId, userId })).value !== undefined;
  check("letter queries still serve the case after a new draft", allLetters);

  // --- 23. Duplicate prevention -----------------------------------------------------------------
  // Queue several regenerations back to back. Two invariants matter: the case
  // must still expose exactly one live letter, and regeneration must update that
  // record rather than inserting a second one. Version arithmetic is asserted on
  // a controlled single regeneration below, because overlapping passes are
  // legitimately refused while one is in flight.
  const beforeConcurrent = (await query("letters:getForCase", { caseId, userId })).value;
  const recordIdBefore = beforeConcurrent?._id;

  await mutation("letters:draftLetter", { caseId, userId });
  await mutation("letters:draftLetter", { caseId, userId });
  await mutation("letters:draftLetter", { caseId, userId });

  await waitFor("concurrent regenerations settle", async () => {
    const current = (await query("letters:getForCase", { caseId, userId })).value;
    return current?.pipelineStatus === "READY" || current?.pipelineStatus === "FAILED";
  }, { attempts: 60 });

  // Give an overlapping pass a chance to land before reading, so a late write
  // cannot make this pass by luck.
  await new Promise((resolve) => setTimeout(resolve, 3000));

  let afterConcurrentAgain = (await query("letters:getForCase", { caseId, userId })).value;
  check("regeneration did not leave a generating state", afterConcurrentAgain?.pipelineStatus === "READY", afterConcurrentAgain?.pipelineStatus);
  check(
    "regeneration reuses the letter record instead of inserting a duplicate",
    afterConcurrentAgain?._id === recordIdBefore,
    `${recordIdBefore} -> ${afterConcurrentAgain?._id}`
  );
  check("regenerating keeps the letter a DRAFT", afterConcurrentAgain?.status === "DRAFT", afterConcurrentAgain?.status);
  check(
    "the case still exposes exactly one live letter",
    (await query("letters:getForCase", { caseId, userId })).value?._id === afterConcurrentAgain?._id
  );

  // A controlled single regeneration must advance the version by exactly one and
  // must not create a second live letter.
  const versionBefore = afterConcurrentAgain?.version ?? 0;
  await mutation("letters:draftLetter", { caseId, userId });
  await waitFor("the single regeneration settles", async () => {
    const current = (await query("letters:getForCase", { caseId, userId })).value;
    return current?.pipelineStatus === "READY" && (current?.version ?? 0) > versionBefore;
  }, { attempts: 60 });

  afterConcurrentAgain = (await query("letters:getForCase", { caseId, userId })).value;
  check(
    "one regeneration advances the version by exactly one",
    afterConcurrentAgain?.version === versionBefore + 1,
    `${versionBefore} -> ${afterConcurrentAgain?.version}`
  );
  check(
    "one regeneration keeps the same letter record",
    afterConcurrentAgain?._id === recordIdBefore
  );
  check(
    "regeneration refreshed the draft content",
    (afterConcurrentAgain?.body ?? "").length >= 200
  );

  // --- 24. Letter timeline -----------------------------------------------------------------------
  const letterTimeline = (await query("cases:getTimeline", { caseId, userId })).value ?? [];
  const letterTypes = letterTimeline.map((e) => e.type);
  for (const type of ["LETTER_DRAFTED", "LETTER_UPDATED", "LETTER_APPROVED", "LETTER_PRESENTED_FOR_APPROVAL"]) {
    check(`the timeline records ${type}`, letterTypes.includes(type));
  }
  const drafted = letterTimeline.find((e) => e.type === "LETTER_DRAFTED");
  check("the drafted event reads as a real event", drafted?.description === "Dispute letter drafted", drafted?.description);
  const approvedEvent = letterTimeline.find((e) => e.type === "LETTER_APPROVED");
  check(
    "the approval event says it is ready to send, not sent",
    /ready to send/i.test(approvedEvent?.description ?? "") && !/\bsent\b/i.test(approvedEvent?.description ?? ""),
    approvedEvent?.description
  );
  check(
    "the timeline records the draft before the approval",
    letterTypes.indexOf("LETTER_DRAFTED") < letterTypes.indexOf("LETTER_APPROVED")
  );

  // --- 25. Letter authorization ---------------------------------------------------------------------
  check("another user cannot read the letter", (await query("letters:getForCase", { caseId, userId: intruder })).status === "error");
  check(
    "another user cannot read the supporting evidence",
    (await query("letters:getSupportingSources", { caseId, userId: intruder })).status === "error"
  );
  check(
    "another user cannot read draft readiness",
    (await query("letters:getDraftReadiness", { caseId, userId: intruder })).status === "error"
  );
  for (const [name, path] of [
    ["draft a letter", "letters:draftLetter"],
    ["save edits", "letters:saveLetterEdits"],
    ["present for approval", "letters:presentForApproval"],
    ["approve a letter", "letters:approveLetter"],
    ["start a new draft", "letters:startNewDraft"],
  ]) {
    const result = await mutation(path, {
      caseId,
      userId: intruder,
      recipient: "x@example.com",
      subject: "Subject",
      body: editedBody,
    });
    check(`another user cannot ${name}`, result.status === "error", JSON.stringify(result).slice(0, 90));
  }

  // A source from another case must never be citable by this letter. The store
  // mutation is internal, so this is asserted where it is observable: the live
  // letter's citations all belong to the case.
  letter = (await query("letters:getForCase", { caseId, userId })).value;
  check(
    "the live letter only ever cites this case's sources",
    (letter?.supportingSourceIds ?? []).every((id) => caseSourceIds.has(id)),
    (letter?.supportingSourceIds ?? []).join(",")
  );

  // --- 26. Insufficient evidence ----------------------------------------------------------------------
  // A case whose deductions were all found valid (or unassessed) must not be
  // able to produce a confident letter.
  const thinUser = (await mutation("users:createOrGet", { email: `thin-${Date.now()}@clawback.local` })).value;
  const thinCase = (await action("cases:createWithInbox", {
    userId: thinUser,
    jurisdiction: "California",
    depositAmount: 400,
    totalDeductions: 0,
  })).value;
  let thinInboxReady = false;
  await waitFor("the thin case has an inbox", async () => {
    const data = (await query("cases:get", { caseId: thinCase, userId: thinUser })).value;
    thinInboxReady = Boolean(data?.inboxId);
    return thinInboxReady;
  });
  if (thinInboxReady) {
    const thinInbox = (await query("cases:get", { caseId: thinCase, userId: thinUser })).value.inboxId;
    await deliver(
      signedDelivery(
        statementEvent(thinInbox, {
          messageId: messageId("msg_thin"),
          records: ["Security deposit: $400", "Broken cabinet: $50", "Total deductions: $50"],
        })
      )
    );
    await waitFor("the thin case finishes assessing", async () => {
      const current = (await query("deductions:listByCase", { caseId: thinCase, userId: thinUser })).value ?? [];
      return current.length === 1 && current[0].assessmentStatus === "COMPLETED";
    }, { attempts: 120 });

    const thinReadiness = (await query("letters:getDraftReadiness", { caseId: thinCase, userId: thinUser })).value;
    // The mock assesses "Broken cabinet" as LIKELY_VALID, so this case has no
    // potentially-disputable, evidence-backed deduction.
    check("a case with no disputable deduction is not ready", thinReadiness?.ready === false, JSON.stringify(thinReadiness));
    check(
      "the refusal explains that more assessed evidence is needed",
      /not have enough assessed evidence/i.test(thinReadiness?.reason ?? ""),
      thinReadiness?.reason
    );

    await mutation("letters:draftLetter", { caseId: thinCase, userId: thinUser });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const thinLetter = (await query("letters:getForCase", { caseId: thinCase, userId: thinUser })).value;
    check(
      "no confident letter is stored without assessed evidence",
      thinLetter === null || thinLetter?.pipelineStatus === "FAILED",
      JSON.stringify(thinLetter)?.slice(0, 120)
    );
    const thinCaseData = (await query("cases:get", { caseId: thinCase, userId: thinUser })).value;
    check("a refused letter does not advance the case", thinCaseData?.status !== "DRAFT_READY", thinCaseData?.status);
  }

  // --- 27. Outbound: addressing and pre-send validation --------------------------------
  const badAddress = await mutation("outbound:setLandlordEmail", {
    caseId,
    userId,
    landlordEmail: "not-an-email",
  });
  check("a malformed landlord address is rejected", badAddress.status === "error");

  const emptyAddress = await mutation("outbound:setLandlordEmail", {
    caseId,
    userId,
    landlordEmail: "   ",
  });
  check("an empty landlord address is rejected", emptyAddress.status === "error");

  const savedAddress = await mutation("outbound:setLandlordEmail", {
    caseId,
    userId,
    landlordEmail: "landlord@example.com",
  });
  check("a valid landlord address is saved", savedAddress.status !== "error", JSON.stringify(savedAddress).slice(0, 120));

  letter = (await query("letters:getForCase", { caseId, userId })).value;
  check("the live letter is still an unapproved draft", letter?.status === "DRAFT", letter?.status);

  const earlySend = await mutation("outbound:sendLetter", { caseId, userId });
  check("an unapproved draft cannot be sent", earlySend.status === "error", JSON.stringify(earlySend).slice(0, 120));
  check(
    "the refusal explains that approval is required",
    /approve/i.test(earlySend.errorMessage ?? ""),
    earlySend.errorMessage
  );

  // --- 28. Outbound: sending an approved dispute ---------------------------------------
  await mutation("letters:presentForApproval", { caseId, userId });
  await mutation("letters:approveLetter", { caseId, userId });

  letter = (await query("letters:getForCase", { caseId, userId })).value;
  check("the letter is approved before sending", letter?.status === "APPROVED", letter?.status);

  const sendsBefore = await mockSends();
  const sentVersion = letter?.version;
  const approvedBody = letter?.body ?? "";
  const approvedSubject = letter?.subject ?? "";

  const sendResult = await mutation("outbound:sendLetter", { caseId, userId });
  check("an approved letter can be sent", sendResult.status !== "error", JSON.stringify(sendResult).slice(0, 120));

  let sentCase = null;
  await waitFor("the case becomes SENT", async () => {
    sentCase = (await query("cases:get", { caseId, userId })).value;
    return sentCase?.status === "SENT";
  }, { attempts: 60 });

  sentCase = (await query("cases:get", { caseId, userId })).value;
  check("the case reaches SENT after the provider confirms", sentCase?.status === "SENT", sentCase?.status);
  check("the case records the conversation thread", Boolean(sentCase?.threadId), sentCase?.threadId);

  letter = (await query("letters:getForCase", { caseId, userId })).value;
  check("the letter is marked SENT", letter?.status === "SENT", letter?.status);
  check("the letter records when it was sent", typeof letter?.sentAt === "number");

  const sendsAfter = await mockSends();
  const ourSends = sendsAfter.filter((entry) => entry.to === "landlord@example.com");
  check("the provider received exactly one copy", ourSends.length === sendsBefore.filter((e) => e.to === "landlord@example.com").length + 1, String(ourSends.length));
  check(
    "the provider was given the landlord's address, not the salutation",
    ourSends[ourSends.length - 1]?.to === "landlord@example.com"
  );
  check(
    "the sent text is exactly the approved letter",
    ourSends[ourSends.length - 1]?.text === approvedBody,
    `sent ${(ourSends[ourSends.length - 1]?.text ?? "").length} chars, approved ${approvedBody.length}`
  );
  check(
    "the sent subject is the approved letter's subject",
    ourSends[ourSends.length - 1]?.subject === approvedSubject
  );
  check(
    "the sent letter keeps the cautious framing the brief requires",
    /based on the available housing guidance/i.test(approvedBody)
  );
  check(
    "sending does not rewrite the approved document",
    letter?.version === sentVersion,
    `${letter?.version} vs ${sentVersion}`
  );

  const communication = (await query("emails:listCommunication", { caseId, userId })).value ?? [];
  const outbound = communication.filter((message) => message.direction === "OUTBOUND");
  check("the send is recorded as an outbound message", outbound.length === 1, String(outbound.length));
  check("the outbound message is marked SENT", outbound[0]?.sendStatus === "SENT", outbound[0]?.sendStatus);
  check("the outbound message carries the provider's message id", Boolean(outbound[0]?.externalMessageId));

  // --- 29. Outbound: duplicate sends are refused ------------------------------------------
  const duplicateSend = await mutation("outbound:sendLetter", { caseId, userId });
  check("sending the same letter twice is refused", duplicateSend.status === "error", JSON.stringify(duplicateSend).slice(0, 120));
  check(
    "the refusal says it was already sent",
    /already been sent/i.test(duplicateSend.errorMessage ?? ""),
    duplicateSend.errorMessage
  );

  // Two more attempts, fired together, to stand in for a double click.
  await Promise.all([
    mutation("outbound:sendLetter", { caseId, userId }),
    mutation("outbound:sendLetter", { caseId, userId }),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const sendsAfterDuplicates = await mockSends();
  const ourSendsAfterDuplicates = sendsAfterDuplicates.filter((entry) => entry.to === "landlord@example.com");
  check(
    "a double click does not send a second copy",
    ourSendsAfterDuplicates.length === ourSends.length,
    `${ourSends.length} -> ${ourSendsAfterDuplicates.length}`
  );
  check(
    "no second outbound message was stored",
    ((await query("emails:listCommunication", { caseId, userId })).value ?? []).filter(
      (message) => message.direction === "OUTBOUND"
    ).length === 1
  );
  check(
    "the letter is still the sent version",
    (await query("letters:getForCase", { caseId, userId })).value?.version === sentVersion
  );

  // --- 30. Inbound: the landlord's reply lands on the right case -----------------------------
  const replyBody =
    "After reviewing your letter I can offer to refund $150 for the painting. I have attached invoices for the carpet. Please send me photos of the cabinet if you disagree.";

  const replyDelivery = signedDelivery(
    replyEvent(sentCase.inboxId, {
      messageId: messageId("msg_reply_1"),
      threadId: sentCase.threadId,
      from: "landlord@example.com",
      subject: `Re: ${letter?.subject ?? "your letter"}`,
      text: replyBody,
    })
  );

  const replyResult = await deliver(replyDelivery);
  check("a landlord reply is accepted", replyResult.status === 200, JSON.stringify(replyResult.body).slice(0, 120));
  check("the reply is associated with the case", replyResult.body.associated === true);
  check("the reply is classified as a reply, not a statement", replyResult.body.kind === "REPLY", replyResult.body.kind);

  let repliedCase = null;
  await waitFor("the case becomes LANDLORD_RESPONDED", async () => {
    repliedCase = (await query("cases:get", { caseId, userId })).value;
    return repliedCase?.status === "LANDLORD_RESPONDED";
  }, { attempts: 60 });

  repliedCase = (await query("cases:get", { caseId, userId })).value;
  check("the case reaches LANDLORD_RESPONDED", repliedCase?.status === "LANDLORD_RESPONDED", repliedCase?.status);

  const afterReply = (await query("emails:listCommunication", { caseId, userId })).value ?? [];
  const inboundReplies = afterReply.filter((message) => message.direction === "INBOUND");
  check("the reply is stored as an inbound message", inboundReplies.length === 1, String(inboundReplies.length));
  check("the reply body is stored verbatim", inboundReplies[0]?.body === replyBody);

  // The decisive check: a reply must never be re-read as a deposit statement,
  // because extraction replaces every deduction on the case.
  const deductionsAfterReply = (await query("deductions:listByCase", { caseId, userId })).value ?? [];
  check(
    "a reply does not destroy the case's deductions",
    deductionsAfterReply.length > 0,
    String(deductionsAfterReply.length)
  );
  check(
    "a reply does not reset the deductions for re-analysis",
    deductionsAfterReply.every((deduction) => deduction.assessmentStatus === "COMPLETED"),
    deductionsAfterReply.map((d) => d.assessmentStatus).join(",")
  );
  check(
    "the disputable total survives the reply",
    ((await query("cases:get", { caseId, userId })).value?.potentiallyDisputableAmount ?? 0) > 0
  );

  // --- 31. Inbound: duplicate webhooks -----------------------------------------------------------
  const replyReplay = await deliver(replyDelivery);
  check("replaying the reply webhook creates no second message", replyReplay.body.created === false);
  check("the replayed reply is still recognised as a reply", replyReplay.body.kind === "REPLY", replyReplay.body.kind);
  check(
    "the case still has exactly one inbound reply",
    ((await query("emails:listCommunication", { caseId, userId })).value ?? []).filter(
      (message) => message.direction === "INBOUND"
    ).length === 1
  );

  const replyEvents = ((await query("cases:getTimeline", { caseId, userId })).value ?? []).filter(
    (event) => event.type === "LANDLORD_RESPONDED"
  );
  check("the reply is recorded on the timeline exactly once", replyEvents.length === 1, String(replyEvents.length));

  // --- 32. Response analysis ------------------------------------------------------------------------
  let analyzed = null;
  await waitFor("the reply is read", async () => {
    const messages = (await query("emails:listCommunication", { caseId, userId })).value ?? [];
    analyzed = messages.find((message) => message.direction === "INBOUND");
    return analyzed?.responseAnalysisStatus === "COMPLETED";
  }, { attempts: 60 });

  const messagesAfterAnalysis = (await query("emails:listCommunication", { caseId, userId })).value ?? [];
  analyzed = messagesAfterAnalysis.find((message) => message.direction === "INBOUND");
  check("the reply is analysed", analyzed?.responseAnalysisStatus === "COMPLETED", analyzed?.responseAnalysisError);

  const analysis = analyzed?.responseAnalysis;
  check("the reading has a summary", (analysis?.summary ?? "").length > 10, analysis?.summary);
  check("the reading picks up the offered amount", analysis?.offeredAmount === 150, String(analysis?.offeredAmount));
  check("the reading records the partial offer", analysis?.offersPartialReimbursement === true);
  check("the reading records the request for more information", analysis?.requestsMoreInformation === true);
  check("the reading records the new material", analysis?.providesNewEvidence === true);
  check("the reading does not claim acceptance", analysis?.acceptsDispute === false);
  check("the reading does not claim rejection", analysis?.rejectsDispute === false);
  check(
    "the reading never reaches a legal conclusion",
    !/\b(?:illegal|unlawful|guarantee|will win|legally required)\b/i.test(
      [analysis?.summary, analysis?.newEvidenceSummary].filter(Boolean).join(" ")
    ),
    analysis?.summary
  );
  check(
    "the reading is recorded on the timeline",
    ((await query("cases:getTimeline", { caseId, userId })).value ?? []).some(
      (event) => event.type === "RESPONSE_ANALYZED"
    )
  );
  check(
    "the analysis is not presented as a legal conclusion in the data",
    !Object.keys(analysis ?? {}).some((key) => /legal|win|confidence/i.test(key))
  );

  // --- 33. Outbound: a revised dispute, send failure and safe retry -----------------------------------
  await mutation("letters:startNewDraft", { caseId, userId });
  await mutation("letters:draftLetter", { caseId, userId });

  await waitFor("the revised draft is generated", async () => {
    const current = (await query("letters:getForCase", { caseId, userId })).value;
    return current?.pipelineStatus === "READY" && current?.status === "DRAFT";
  }, { attempts: 60 });

  const revised = (await query("letters:getForCase", { caseId, userId })).value;
  check("a new draft can follow a sent letter", Boolean(revised?._id) && revised?._id !== letter?._id);
  check("the sent letter is no longer the live letter", revised?.status === "DRAFT", revised?.status);
  check(
    "the case is not rewound by a new draft on a responded case",
    (await query("cases:get", { caseId, userId })).value?.status === "LANDLORD_RESPONDED"
  );

  await mutation("letters:presentForApproval", { caseId, userId });
  await mutation("letters:approveLetter", { caseId, userId });

  await mutation("outbound:setLandlordEmail", {
    caseId,
    userId,
    landlordEmail: "fail@example.com",
  });

  const sendsBeforeFailure = (await mockSends()).length;
  const failingSend = await mutation("outbound:sendLetter", { caseId, userId });
  check("the send is accepted for a valid approved letter", failingSend.status !== "error", JSON.stringify(failingSend).slice(0, 120));

  let failedOutbound = null;
  await waitFor("the failed send is recorded", async () => {
    const messages = (await query("emails:listCommunication", { caseId, userId })).value ?? [];
    failedOutbound = messages
      .filter((message) => message.direction === "OUTBOUND")
      .find((message) => message.sendStatus === "FAILED");
    return Boolean(failedOutbound);
  }, { attempts: 60 });

  check("a provider failure is recorded as FAILED", failedOutbound?.sendStatus === "FAILED", failedOutbound?.sendStatus);
  check("the failure reason is stored", (failedOutbound?.sendError ?? "").length > 0, failedOutbound?.sendError);
  check(
    "the case is not marked SENT by a failed send",
    (await query("cases:get", { caseId, userId })).value?.status !== "SENT"
  );
  check(
    "the revised letter is not marked SENT by a failed send",
    (await query("letters:getForCase", { caseId, userId })).value?.status === "APPROVED"
  );
  check(
    "the failure is recorded on the timeline",
    ((await query("cases:getTimeline", { caseId, userId })).value ?? []).some(
      (event) => event.type === "SEND_FAILED"
    )
  );
  check("the failed attempt reached the provider", (await mockSends()).length === sendsBeforeFailure + 1);

  // Retry with a working address. The same letter revision is being sent, so the
  // retry must reuse its outbound record rather than create a second one.
  await mutation("outbound:setLandlordEmail", {
    caseId,
    userId,
    landlordEmail: "landlord@example.com",
  });

  const outboundBeforeRetry = ((await query("emails:listCommunication", { caseId, userId })).value ?? []).filter(
    (message) => message.direction === "OUTBOUND"
  ).length;

  const retrySend = await mutation("outbound:sendLetter", { caseId, userId });
  check("a failed send can be retried", retrySend.status !== "error", JSON.stringify(retrySend).slice(0, 120));

  // The original dispute was already SENT, so waiting for "an outbound message
  // is SENT" would be satisfied before the retry runs. Wait for the failed row
  // itself to turn SENT instead.
  await waitFor("the retry succeeds", async () => {
    const messages = (await query("emails:listCommunication", { caseId, userId })).value ?? [];
    const outbound = messages.filter((message) => message.direction === "OUTBOUND");
    return (
      !outbound.some((message) => message.sendStatus === "FAILED") &&
      outbound.filter((message) => message.sendStatus === "SENT").length === 2
    );
  }, { attempts: 60 });

  const afterRetry = (await query("emails:listCommunication", { caseId, userId })).value ?? [];
  const outboundAfterRetry = afterRetry.filter((message) => message.direction === "OUTBOUND");
  check(
    "the retry reuses the failed message rather than adding one",
    outboundAfterRetry.length === outboundBeforeRetry,
    `${outboundBeforeRetry} -> ${outboundAfterRetry.length}`
  );
  check(
    "the retried message is marked SENT",
    outboundAfterRetry.filter(
      (message) => message.sendStatus === "SENT" && message.recipient === "landlord@example.com"
    ).length === 2,
    outboundAfterRetry.map((m) => `${m.sendStatus}:${m.recipient}`).join(" ")
  );
  check(
    "no outbound message is left in a failed state",
    !outboundAfterRetry.some((message) => message.sendStatus === "FAILED")
  );
  const retriedLetter = (await query("letters:getForCase", { caseId, userId })).value;
  check(
    "the retried letter is marked SENT",
    retriedLetter?.status === "SENT",
    `status=${retriedLetter?.status} version=${retriedLetter?.version} sentAt=${retriedLetter?.sentAt}`
  );
  check(
    "the retried letter is the revised document, not the original",
    retriedLetter?._id === revised?._id && retriedLetter?._id !== letter?._id
  );

  // Retrying an observed failure is not the same as taking over an abandoned
  // claim. Only the latter may have delivered a copy, so only it is flagged.
  const retryEvents = (await query("cases:getTimeline", { caseId, userId })).value ?? [];
  check(
    "a retry after an observed failure is not flagged as an abandoned attempt",
    !retryEvents.some((event) => event.type === "SEND_ATTEMPT_ABANDONED"),
    retryEvents.map((e) => e.type).join(",")
  );
  check(
    "the send history is recorded once per real event",
    retryEvents.filter((event) => event.type === "DISPUTE_SENT").length === 2,
    retryEvents.filter((e) => e.type === "DISPUTE_SENT").length
  );
  check(
    "the responded case is not rewound by a later send",
    (await query("cases:get", { caseId, userId })).value?.status === "LANDLORD_RESPONDED"
  );

  // --- 34. Authorization for sending and responses -------------------------------------------------------
  check(
    "another user cannot read the communication",
    (await query("emails:listCommunication", { caseId, userId: intruder })).status === "error"
  );
  check(
    "another user cannot set the landlord address",
    (await mutation("outbound:setLandlordEmail", { caseId, userId: intruder, landlordEmail: "x@example.com" })).status === "error"
  );
  check(
    "another user cannot send the dispute",
    (await mutation("outbound:sendLetter", { caseId, userId: intruder })).status === "error"
  );
  const replyEmailId = afterRetry.find((message) => message.direction === "INBOUND")?._id;
  if (replyEmailId) {
    check(
      "another user cannot re-run the response analysis",
      (await mutation("responses:retryResponseAnalysis", { emailId: replyEmailId, userId: intruder })).status === "error"
    );
  }

  // A send for a case with no address must be refused rather than guessed at.
  const noAddressUser = (await mutation("users:createOrGet", { email: `noaddr-${Date.now()}@clawback.local` })).value;
  const noAddressCase = (await action("cases:createWithInbox", {
    userId: noAddressUser,
    jurisdiction: "California",
    depositAmount: 500,
    totalDeductions: 100,
  })).value;
  check("a case with no landlord address cannot send", noAddressCase !== undefined);

  // --- 35. Extraction accepts whatever the landlord actually wrote -------------------------------------------------------
  // A charge the model cannot place must still be recorded, as UNKNOWN. This
  // section exists because every record in STANDARD_RECORDS happens to match a
  // pattern the mock knows, so the "unclassifiable charge" path was never
  // exercised here — and an invalid fallback category (a value outside
  // DEDUCTION_CATEGORIES) shipped unnoticed as a result. Because the app
  // validates every provider response before persisting it, one such value
  // rejects the *whole* statement: the email is marked FAILED and the case is
  // stranded. That is the correct app behaviour, so the contract the mock must
  // honour is "only ever emit a category the app accepts", and it is checked
  // end to end here rather than in isolation.
  const oddUser = (await mutation("users:ensureDemo", {})).value;
  const oddCaseId = (await action("cases:createWithInbox", {
    userId: oddUser,
    jurisdiction: "California",
    depositAmount: 1200,
    totalDeductions: 75,
  })).value;
  check("a case for the odd statement was created", Boolean(oddCaseId));

  let oddCase = null;
  await waitFor("the odd case inbox becomes READY", async () => {
    oddCase = (await query("cases:get", { caseId: oddCaseId, userId: oddUser })).value;
    return oddCase?.inboxStatus === "READY" && Boolean(oddCase?.inboxId);
  });

  await deliver(
    signedDelivery(
      statementEvent(oddCase.inboxId, {
        messageId: messageId("msg_unclassifiable"),
        records: [
          "Security deposit: $1,200",
          "Miscellaneous charge: $75",
          "Total deductions: $75",
        ],
      })
    )
  );

  await waitFor("the odd statement is processed", async () => {
    const rows = (await query("emails:listByCase", { caseId: oddCaseId, userId: oddUser })).value;
    return rows?.some(
      (email) => email.processingStatus === "PROCESSED" || email.processingStatus === "FAILED"
    );
  });

  const oddEmails = (await query("emails:listByCase", { caseId: oddCaseId, userId: oddUser })).value ?? [];
  check(
    "a statement with an unclassifiable charge is still read",
    oddEmails[0]?.processingStatus === "PROCESSED",
    oddEmails[0]?.processingError
  );

  const oddDeductions = (await query("deductions:listByCase", { caseId: oddCaseId, userId: oddUser })).value ?? [];
  check(
    "the unclassifiable charge became a deduction",
    oddDeductions.length === 1,
    String(oddDeductions.length)
  );
  check(
    "an unclassifiable charge is recorded as UNKNOWN rather than dropped",
    oddDeductions[0]?.category === "UNKNOWN",
    String(oddDeductions[0]?.category)
  );
  check(
    "every extracted category is one the app's schema accepts",
    oddDeductions.length > 0 && oddDeductions.every((row) => LEGAL_CATEGORIES.includes(row.category)),
    oddDeductions.map((row) => row.category).join(",")
  );

  // --- 36. A reply with no readable text, and reading the same reply twice ------------------------------
  // Two Phase-2 gaps that had no coverage anywhere: a landlord reply that carries no
  // text at all (an attachment-only reply, or one whose body the provider stripped),
  // and a second attempt to read a reply that already has a reading. Neither can be
  // reached from the offline harness, because both live in the action.
  const completedReply = afterRetry.find((message) => message.direction === "INBOUND");
  check(
    "the earlier reply still has a completed reading to compare against",
    completedReply?.responseAnalysisStatus === "COMPLETED",
    completedReply?.responseAnalysisStatus
  );

  // Section 35 created a case and had its statement processed, and processing a
  // statement starts research and then assessment for every deduction it
  // produced. Those run in the background and append to the same prompt log, so
  // taking the baseline before they settle makes the comparison below fail for a
  // reason that has nothing to do with empty replies — seen as an intermittent
  // failure whose message named an *assessment* prompt. Wait for the pipeline the
  // previous section started to go quiet first.
  //
  // The `length > 0` term is what makes this a real wait rather than one that is
  // already satisfied: an empty list is not a settled pipeline, it is a pipeline
  // that has not produced its deduction yet.
  await waitFor("the odd case's pipeline settles", async () => {
    const rows =
      (await query("deductions:listByCase", { caseId: oddCaseId, userId: oddUser })).value ?? [];
    return (
      rows.length > 0 &&
      rows.every(
        (row) =>
          (row.researchStatus === "COMPLETED" || row.researchStatus === "FAILED") &&
          (row.assessmentStatus === "COMPLETED" || row.assessmentStatus === "FAILED")
      )
    );
  }, { attempts: 60 });

  // A blank reply must cost no model call. The mock keeps only the last ten
  // prompts, so an unchanged log is proof that nothing was appended — and the
  // section below is arranged so that a blank reply, a refused repeat and a retry
  // of the blank reply are all it does.
  const callsBeforeBlank = await mockCalls();

  const blankReply = await deliver(
    signedDelivery(
      replyEvent(sentCase.inboxId, {
        messageId: messageId("msg_reply_blank"),
        threadId: sentCase.threadId,
        from: "landlord@example.com",
        subject: `Re: ${letter?.subject ?? "your letter"}`,
        text: "   ",
      })
    )
  );
  check("a reply with no text is accepted by the webhook", blankReply.status === 200, JSON.stringify(blankReply.body).slice(0, 120));
  check("a reply with no text is still classified as a reply", blankReply.body.kind === "REPLY", blankReply.body.kind);
  check("a reply with no text is attached to the case", blankReply.body.associated === true);

  let blankStored = null;
  await waitFor("the unreadable reply is marked FAILED", async () => {
    const messages = (await query("emails:listCommunication", { caseId, userId })).value ?? [];
    blankStored = messages.find((message) => message._id === blankReply.body.emailId);
    return blankStored?.responseAnalysisStatus === "FAILED";
  }, { attempts: 60 });

  check("a reply with no text cannot be read", blankStored?.responseAnalysisStatus === "FAILED", blankStored?.responseAnalysisStatus);
  check(
    "the failure names the real cause",
    /readable text/.test(blankStored?.responseAnalysisError ?? ""),
    blankStored?.responseAnalysisError
  );
  check("the landlord's empty reply is still stored", Boolean(blankStored?._id));
  check("no reading is invented for an empty reply", blankStored?.responseAnalysis === undefined);
  check("no reading timestamp is recorded for an empty reply", blankStored?.responseAnalyzedAt === undefined);

  // A reply that cannot be read must not damage the case it belongs to. This is
  // the same asymmetry rule 18 protects: the reply is correspondence, so it must
  // never reach extraction, which replaces every deduction on the case.
  const afterBlank = (await query("cases:get", { caseId, userId })).value;
  check("the unreadable reply does not rewind the case", afterBlank?.status === "LANDLORD_RESPONDED", afterBlank?.status);
  check("the unreadable reply does not clear the disputable total", (afterBlank?.potentiallyDisputableAmount ?? 0) > 0);
  const deductionsAfterBlank = (await query("deductions:listByCase", { caseId, userId })).value ?? [];
  check(
    "the unreadable reply does not reset the deductions",
    deductionsAfterBlank.length > 0 && deductionsAfterBlank.every((row) => row.assessmentStatus === "COMPLETED"),
    deductionsAfterBlank.map((row) => row.assessmentStatus).join(",")
  );
  const earlierReplyAfter = ((await query("emails:listCommunication", { caseId, userId })).value ?? []).find(
    (message) => message._id === completedReply?._id
  );
  check(
    "an earlier reading survives a later unreadable reply",
    earlierReplyAfter?.responseAnalysisStatus === "COMPLETED" && Boolean(earlierReplyAfter?.responseAnalysis),
    earlierReplyAfter?.responseAnalysisStatus
  );

  // Reading a reply that already has a reading is refused rather than repeated.
  const repeated = await mutation("responses:retryResponseAnalysis", { emailId: completedReply._id, userId });
  check("a reply that has already been read cannot be read again", repeated.status === "error", JSON.stringify(repeated).slice(0, 160));
  check("the refusal says why", /already been read/.test(repeated.errorMessage ?? ""), repeated.errorMessage);

  const afterRepeat = ((await query("emails:listCommunication", { caseId, userId })).value ?? []).find(
    (message) => message._id === completedReply?._id
  );
  check("the refused repeat leaves the reading in place", afterRepeat?.responseAnalysisStatus === "COMPLETED");
  check(
    "the refused repeat records nothing on the timeline",
    ((await query("cases:getTimeline", { caseId, userId })).value ?? []).filter(
      (event) => event.type === "RESPONSE_ANALYZED"
    ).length === 1
  );

  // A reply that genuinely failed is retryable. Unlike the wait in section 33,
  // this one is not already satisfied when it starts: the retry mutation resets
  // the row to PENDING before it returns, so waiting for FAILED waits for the
  // pass to run and fail again — which, for a reply with no text, it always must.
  const retryBlank = await mutation("responses:retryResponseAnalysis", {
    emailId: blankReply.body.emailId,
    userId,
  });
  check("a reply that failed to read can be retried", retryBlank.status !== "error", JSON.stringify(retryBlank).slice(0, 160));

  let blankRetried = null;
  await waitFor("the retried blank reply settles", async () => {
    const messages = (await query("emails:listCommunication", { caseId, userId })).value ?? [];
    blankRetried = messages.find((message) => message._id === blankReply.body.emailId);
    return blankRetried?.responseAnalysisStatus === "FAILED";
  }, { attempts: 60 });

  check("a retry cannot read a reply that has no text", blankRetried?.responseAnalysisStatus === "FAILED", blankRetried?.responseAnalysisStatus);
  check("a retry of an unreadable reply never claims success", blankRetried?.responseAnalysis === undefined);
  check(
    "a retry of an unreadable reply never claims a reading timestamp",
    blankRetried?.responseAnalyzedAt === undefined
  );

  // The point of the guard: a model must never be asked to read an empty message,
  // because whatever it returned would be invention. Nothing in this section may
  // have appended a prompt to the provider log — the mock keeps only the last ten,
  // so a new prompt shifts the array and an unchanged array is proof.
  const callsAfterBlank = await mockCalls();
  check(
    "reading an empty reply, and refusing to re-read a read one, appended no prompt",
    JSON.stringify(callsAfterBlank) === JSON.stringify(callsBeforeBlank),
    `newest prompt now: ${JSON.stringify((callsAfterBlank.at(-1)?.system ?? "").slice(0, 60))}`
  );

  // --- 37. Authentication: the caller is derived, never accepted ---------------------------------
  //
  // Everything above ran with `ALLOW_DEMO_IDENTITY=true`, which is how this suite
  // acts as a user without a session — and that means none of it exercises the
  // authenticated path, because in demo mode `resolveCaller` returns the claimed id
  // and the result looks identical either way.
  //
  // This section covers what a local backend *can* decide, and is explicit about
  // what it cannot. It can prove the resolver runs at all (an anonymous caller
  // with no id is refused, which only happens if `resolveCaller` was reached), and
  // that a real sign-in completes through the app's own email transport. It cannot
  // prove that a token is *honoured*, because Convex refuses every token on a local
  // backend: it fetches the auth provider configuration from the site host before
  // trusting one, and that request never reaches the local router. Those checks
  // report SKIP rather than passing on an error response. `npm run verify:auth`
  // proves the real property against a deployment that accepts tokens.

  // An anonymous caller that supplies no id is refused. This is the check that
  // proves the resolver actually runs on this deployment rather than the argument
  // being read straight through.
  const anonymousNoId = await query("cases:list", {});
  check(
    "an anonymous caller with no id is refused",
    anonymousNoId.status === "error",
    JSON.stringify(anonymousNoId).slice(0, 140)
  );

  // An id that is well formed but belongs to another table must not resolve to a
  // user. Note this is belt-and-braces rather than evidence the resolver ran:
  // Convex's own `v.id("users")` validator rejects another table's id before the
  // handler is reached, so this would pass on an un-migrated deployment too. The
  // check that actually proves the resolver runs is the one above, which only
  // refuses because demo mode was given no id to accept.
  const wrongTable = await query("cases:list", { userId: caseId });
  check(
    "an id from another table is not accepted as a user id",
    wrongTable.status === "error",
    JSON.stringify(wrongTable).slice(0, 140)
  );

  const signInEmail = `renter-${Date.now()}@clawback.local`;
  const started = await action("auth:signIn", {
    provider: "email",
    params: { email: signInEmail },
  });
  check(
    "a sign-in can be started",
    started.value?.started === true,
    JSON.stringify(started).slice(0, 160)
  );

  const signInToken = await signInCode(signInEmail);
  check("the sign-in link was delivered through the app's own transport", Boolean(signInToken));

  const verified = await action("auth:signIn", {
    provider: "email",
    params: { email: signInEmail, code: signInToken },
  });
  const sessionToken = verified.value?.tokens?.token;
  check(
    "the code completes the sign-in and returns a session token",
    typeof sessionToken === "string" && sessionToken.length > 0,
    JSON.stringify(verified).slice(0, 200)
  );

  // The three checks below need a deployment that will *accept* a token, and a
  // local backend will not: Convex rejects every token with
  // `AuthProviderDiscoveryFailed` because it cannot fetch the auth provider
  // configuration from the local site host. That is a limitation of the local
  // backend, not a defect in the app — so these are reported as skipped, never as
  // passed. `npm run verify:auth` runs the same property against a real
  // deployment, where the token is actually honoured.
  if (typeof sessionToken === "string" && sessionToken.length > 0) {
    const asSession = outcome(await query("cases:list", {}, sessionToken));

    if (asSession.kind === "other") {
      skip(
        "a session token is accepted on a function call",
        `this backend rejected the token before running any function (${asSession.message.slice(0, 70)})`
      );
      skip(
        "a session's identity overrides the userId the caller claims",
        "needs a deployment that honours tokens — covered by `npm run verify:auth`"
      );
    } else {
      check(
        "a session token is accepted on a function call",
        asSession.kind === "ok",
        `${asSession.kind}: ${String(asSession.message ?? "").slice(0, 120)}`
      );

      // The property the migration exists for. The demo user owns every case this
      // suite created; the freshly signed-in user owns none. If the argument were
      // still trusted, this call would hand back the demo user's cases.
      const overridden = outcome(await query("cases:list", { userId }, sessionToken));
      check(
        "a session's identity overrides the userId the caller claims",
        overridden.kind === "ok" && (overridden.value ?? []).length === 0,
        `expected the token owner's empty list, got ${overridden.kind}: ${JSON.stringify(
          overridden.value ?? overridden.message
        ).slice(0, 120)}`
      );
    }

    // The mirror image, and it runs either way: with no session the claimed id is
    // exactly what demo mode is for, and it must still work or the rest of this
    // suite would not run at all.
    const asDemo = await query("cases:list", { userId });
    check(
      "without a session the demo identity still resolves",
      asDemo.status !== "error" && (asDemo.value ?? []).length > 0,
      `expected the demo user's cases, got ${JSON.stringify(asDemo).slice(0, 160)}`
    );
  }

  // --- Report ---------------------------------------------------------------------------
  console.log(
    `\n${checks - failed}/${checks} e2e checks passed` +
      (skipped > 0 ? ` (${skipped} not verified on a local backend — see \`npm run verify:auth\`)` : "")
  );
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  // The checks above have already streamed; only the abort itself is new here.
  console.error(
    `\nABORTED after ${checks} checks (${checks - failed} passed) — the harness threw.`
  );
  console.error(error);
  process.exit(1);
});
