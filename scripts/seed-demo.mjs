/**
 * Seeds one coherent demo case by running it through the *real* pipeline.
 *
 * Nothing here is fabricated: it creates a case, delivers a signed AgentMail
 * webhook exactly as the provider would, and then waits for extraction,
 * research and assessment to finish. Every figure the UI shows is therefore
 * computed by the backend from the stored deduction records — the same path a
 * real statement takes. Re-running it creates a second case rather than
 * mutating the first.
 *
 * The statement is chosen so the resulting figures are round:
 *
 *     Security deposit        $1,500
 *     Total deductions        $1,000   (450 + 300 + 100 + 150)
 *     Potentially disputable    $850   (450 + 300 + 100; the cabinet is valid)
 *
 * Requires the local deployment and the mock providers, as documented in
 * AGENTS.md. Run with `npm run seed`.
 */
import { createHmac } from "node:crypto";

const CONVEX = process.env.CONVEX_URL ?? "http://127.0.0.1:3210";
const SITE = process.env.CONVEX_SITE_URL ?? "http://127.0.0.1:3211";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? "whsec_bW9ja3NlY3JldGZvcnRlc3Rpbmc";

const secretBytes = Buffer.from(WEBHOOK_SECRET.replace(/^whsec_/, ""), "base64");

const STATEMENT = [
  "Security deposit: $1,500",
  "Carpet replacement: $450",
  "Painting: $300",
  "Cleaning: $100",
  "Broken cabinet: $150",
  "Total deductions: $1,000",
];

/** Unique per run: inbound mail is idempotent on the provider's message id. */
const RUN = `seed${Date.now().toString(36)}`;

async function call(kind, path, args) {
  const res = await fetch(`${CONVEX}/api/${kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, args }),
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : {};
  if (parsed.status === "error") {
    throw new Error(`${path}: ${parsed.errorMessage ?? "unknown error"}`);
  }
  return parsed;
}

const query = (path, args) => call("query", path, args);
const mutation = (path, args) => call("mutation", path, args);
const action = (path, args) => call("action", path, args);

function signedDelivery(payload) {
  const body = JSON.stringify(payload);
  const svixId = `msg_${RUN}`;
  const ts = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secretBytes)
    .update(`${svixId}.${ts}.${body}`)
    .digest("base64");

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

async function waitFor(description, predicate, attempts = 90) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (await predicate()) return true;
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`timed out waiting for: ${description}`);
}

const money = (value) => `$${Number(value ?? 0).toFixed(2)}`;

async function main() {
  const version = await fetch(`${CONVEX}/version`).then((r) => r.text()).catch(() => null);
  if (version === null) {
    throw new Error(
      "The local Convex deployment is not reachable on :3210. Start `npx convex dev` first."
    );
  }

  const userId = (await mutation("users:ensureDemo", {})).value;
  console.log("demo user ready");

  const caseId = (
    await action("cases:createWithInbox", {
      userId,
      jurisdiction: "California",
      depositAmount: 1500,
      totalDeductions: 1000,
    })
  ).value;
  console.log(`case created: ${caseId}`);

  await waitFor("the case inbox to be provisioned", async () => {
    const current = (await query("cases:get", { caseId, userId })).value;
    return current?.inboxStatus === "READY";
  });

  const inboxId = (await query("cases:get", { caseId, userId })).value?.inboxId;
  console.log(`inbox ready: ${inboxId}`);

  // Deliver the statement exactly as AgentMail would.
  const delivery = signedDelivery({
    event_type: "message.received",
    event_id: `evt_${RUN}`,
    message: {
      message_id: `msg_${RUN}`,
      inbox_id: inboxId,
      timestamp: new Date().toISOString(),
      from: "landlord@example.com",
      to: [inboxId],
      subject: "Security Deposit Statement",
      text: STATEMENT.join("\n"),
      attachments: [],
    },
  });

  const response = await fetch(`${SITE}/agentmail/webhook`, {
    method: "POST",
    headers: delivery.headers,
    body: delivery.body,
  });

  if (!response.ok) {
    throw new Error(`the webhook was rejected with ${response.status}`);
  }
  console.log("statement delivered");

  await waitFor("the deductions to be extracted", async () => {
    const rows = (await query("deductions:listByCase", { caseId, userId })).value ?? [];
    return rows.length === STATEMENT.length - 2;
  });

  await waitFor("every deduction to be assessed", async () => {
    const rows = (await query("deductions:listByCase", { caseId, userId })).value ?? [];
    return rows.length > 0 && rows.every((row) => row.assessmentStatus === "COMPLETED");
  });

  // The case total is recomputed in its own transaction after each assessment,
  // so wait for the figure rather than for the deductions.
  const deductions = (await query("deductions:listByCase", { caseId, userId })).value ?? [];
  const expected = deductions
    .filter((row) => row.assessment === "POTENTIALLY_DISPUTABLE")
    .reduce((total, row) => total + Math.min(row.potentiallyDisputableAmount ?? 0, row.amount ?? 0), 0);

  await waitFor("the case total to converge", async () => {
    const current = (await query("cases:get", { caseId, userId })).value;
    return current?.potentiallyDisputableAmount === expected;
  });

  const finalCase = (await query("cases:get", { caseId, userId })).value;
  const sources = (await query("sources:listByCase", { caseId, userId })).value ?? [];

  console.log("\nDemo case ready\n");
  console.log(`  case            ${caseId}`);
  console.log(`  status          ${finalCase.status}`);
  console.log(`  deposit         ${money(finalCase.depositAmount)}`);
  console.log(`  deductions      ${money(finalCase.totalDeductions)}`);
  console.log(`  disputable      ${money(finalCase.potentiallyDisputableAmount)}`);
  console.log(`  sources         ${sources.length}`);

  console.log("\n  deductions");
  for (const row of deductions) {
    console.log(
      `    ${String(row.description).padEnd(20)} ${money(row.amount).padStart(10)}  ${row.assessment}`
    );
  }

  console.log(`\n  open http://localhost:3000/cases/${caseId}\n`);
}

main().catch((error) => {
  console.error(`\n${error.message}\n`);
  process.exit(1);
});
