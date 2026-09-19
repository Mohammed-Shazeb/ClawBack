/**
 * Live integration verification.
 *
 * This is the *only* harness in the project that talks to the real providers.
 * Everything else (`verify`, `verify:ui`, `verify:e2e`) runs against mocks and
 * stays that way on purpose — a mocked run can never tell you whether the real
 * model still satisfies the validation boundary that guards persistence.
 *
 * It exercises the real prompts, the real JSON Schemas and the real validators,
 * imported from `convex/`, rather than restating them. A check passes only when
 * a genuine provider response survives the same validation the app applies
 * before storing anything.
 *
 * Deliberately never sends mail: the AgentMail section is a read-only auth and
 * response-shape probe. A real outbound send needs a real recipient address and
 * is a separate, explicit decision.
 *
 * Credentials are read from `.env.local`. Run with `npm run verify:live`.
 * Requires network access.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { requestStructuredJson, type StructuredJsonRequest } from "../convex/openai";
import {
  DEPOSIT_STATEMENT_SCHEMA_NAME,
  EXTRACTION_SYSTEM_PROMPT,
  buildStatementUserPrompt,
  depositStatementJsonSchema,
  parseDepositStatement,
} from "../convex/extraction";
import {
  ASSESSMENT_SCHEMA_NAME,
  ASSESSMENT_SYSTEM_PROMPT,
  assessmentJsonSchema,
  buildAssessmentUserPrompt,
  validateAssessment,
} from "../convex/assessment";
import {
  LETTER_SCHEMA_NAME,
  LETTER_SYSTEM_PROMPT,
  buildLetterUserPrompt,
  letterJsonSchema,
  validateLetter,
} from "../convex/letter";
import {
  RESPONSE_ANALYSIS_SCHEMA_NAME,
  RESPONSE_ANALYSIS_SYSTEM_PROMPT,
  buildResponseAnalysisUserPrompt,
  responseAnalysisJsonSchema,
  validateResponseAnalysis,
} from "../convex/response";
import { DEDUCTION_CATEGORIES } from "../convex/validators";
import { classifyAuthority, searchAuthoritative } from "../convex/firecrawl";

// --- Environment -------------------------------------------------------------

/**
 * Minimal `.env.local` reader. Node does not load it, and the app relies on
 * Next.js to do so at runtime — so the harness has to supply it before the
 * `convex/` modules read `process.env`.
 *
 * Resolved from the repo root, which is where `npm run verify:live` runs. This
 * file is typechecked under CommonJS too, where `import.meta` is not allowed.
 */
function loadEnvLocal(): void {
  let contents = "";
  try {
    contents = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  } catch {
    return;
  }

  for (const line of contents.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.trim().replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvLocal();

// --- Reporting ---------------------------------------------------------------

const lines: string[] = [];
let failed = 0;
let skipped = 0;

function check(name: string, passed: boolean, detail?: string): void {
  lines.push(`${passed ? "ok  " : "FAIL"} ${name}${!passed && detail ? ` — ${detail}` : ""}`);
  if (!passed) failed += 1;
}

function skip(name: string, why: string): void {
  lines.push(`skip ${name} — ${why}`);
  skipped += 1;
}

/** Provider errors can echo credentials back; never print a raw message. */
function safe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\b(sk-|fc-|am_)[A-Za-z0-9_-]{6,}/g, "$1…");
}

/**
 * Whether an error is the *account* being unable to run the request, rather than
 * the model producing something the app rejected.
 *
 * The distinction matters for an honest report: a 402 ("this model needs a
 * subscription") or a 429 ("1 request per minute") says nothing about whether
 * the app's validation boundary is correct, and reporting it as a failed check
 * would overstate the problem.
 */
function providerBlocked(error: unknown): string | null {
  const message = safe(error);
  const status = /\((\d{3})\)/.exec(message)?.[1];
  if (!status) return null;
  if (!["401", "402", "403", "429"].includes(status)) return null;
  return `${status} — ${message.slice(0, 220)}`;
}

// --- Fixtures ----------------------------------------------------------------
// Synthetic, and deliberately the same shape as the seeded demo case so the
// live result is directly comparable to the mocked one.

const JURISDICTION = "California";
const DEPOSIT = 1500;
const TOTAL_DEDUCTIONS = 1000;

const STATEMENT_BODY = [
  "Security deposit: $1,500",
  "Carpet replacement: $450",
  "Painting: $300",
  "Cleaning: $100",
  "Broken cabinet: $150",
  "Total deductions: $1,000",
].join("\n");

const SOURCES = [
  {
    label: "S1",
    id: "s1" as never,
    title: "Security Deposits — California Department of Consumer Affairs",
    authority: "Government / Housing Authority",
    jurisdiction: JURISDICTION,
    relevantText:
      "A landlord may deduct from a security deposit only for amounts reasonably necessary to repair damage caused by the tenant, beyond ordinary wear and tear. Repainting and carpet cleaning after a normal tenancy are generally considered ordinary wear and tear rather than damage.",
  },
  {
    label: "S2",
    id: "s2" as never,
    title: "Tenant Rights — California Courts Self-Help Guide",
    authority: "Government / Housing Authority",
    jurisdiction: JURISDICTION,
    relevantText:
      "The landlord must give the tenant an itemized statement of deductions. Deductions must be supported by receipts or invoices, and charges for ordinary wear and tear are not permitted.",
  },
];

const LANDLORD_REPLY = `Thanks for your letter. I have reviewed the itemized statement.

I will refund $450 for the carpet replacement, since the carpet was already
worn when you moved in. I am not going to refund the painting or the cleaning
charges, because I had to repaint and clean the unit after you left.

I can send the $450 by bank transfer this week if you confirm your account
details. If you disagree with the rest, we can discuss it further.`;

// --- Checks ------------------------------------------------------------------

type CallResult = { raw: unknown } | { blocked: string } | { failed: string };

/**
 * One model call, with the account-blocked case separated from a real failure.
 *
 * A 429 is retried once after the delay the provider itself names ("Retry in
 * 59s"), because a per-minute key limit is a property of the account rather than
 * a verdict on the app. The wait is capped so a misconfigured key cannot hang
 * the suite.
 */
async function callModel(request: StructuredJsonRequest): Promise<CallResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return { raw: await requestStructuredJson(request) };
    } catch (error) {
      const blocked = providerBlocked(error);
      if (!blocked) return { failed: safe(error) };

      const retryIn = /retry in (\d+)\s*s/i.exec(safe(error))?.[1];
      const waitMs = Math.min(Number(retryIn ?? 0) * 1000 + 1500, 70_000);

      if (!blocked.startsWith("429") || attempt === 1) return { blocked };

      lines.push(`# rate limited by the provider, waiting ${Math.round(waitMs / 1000)}s`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  return { blocked: "429 — rate limited" };
}

async function verifyOpenAI(): Promise<void> {
  lines.push("\n## OpenAI (live)");

  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL) {
    skip("OpenAI extraction", "OPENAI_API_KEY / OPENAI_MODEL not configured");
    return;
  }

  lines.push(
    `# model ${process.env.OPENAI_MODEL} via ${process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}`
  );

  // 1. Extraction — the path a real landlord statement takes.
  const statementCall = await callModel({
    system: EXTRACTION_SYSTEM_PROMPT,
    user: buildStatementUserPrompt({
      subject: "Security Deposit Statement",
      body: STATEMENT_BODY,
    }),
    schemaName: DEPOSIT_STATEMENT_SCHEMA_NAME,
    jsonSchema: depositStatementJsonSchema,
  });

  // If the account cannot run this model at all, the remaining three calls would
  // fail the same way. Report the blocker once and stop rather than spending
  // three more minutes proving the same point.
  if ("blocked" in statementCall) {
    skip("live extraction returned a response", statementCall.blocked);
    skip("a real assessment survives evidence-backed validation", "blocked upstream");
    skip("a real letter survives the claim and evidence checks", "blocked upstream");
    skip("a real landlord reply survives response validation", "blocked upstream");
    lines.push(
      "note the OpenAI live path did not run: the configured model could not be reached",
      "note this says nothing about the app — it never received a response to validate."
    );
    return;
  }

  if ("failed" in statementCall) {
    check("live extraction returned a response", false, statementCall.failed);
    return;
  }

  const statement = parseDepositStatement(statementCall.raw);
  check(
    "a real statement survives the extraction schema",
    statement !== null,
    statement === null ? `raw=${JSON.stringify(statementCall.raw)?.slice(0, 300)}` : undefined
  );

  if (statement) {
    check(
      "the real model reads the deposit amount",
      statement.depositAmount === DEPOSIT,
      String(statement.depositAmount)
    );
    check(
      "the real model finds every itemized deduction",
      statement.deductions.length === 4,
      `${statement.deductions.length}: ${statement.deductions.map((d) => d.description).join(" | ")}`
    );
    check(
      "every category the real model returns is one the app accepts",
      statement.deductions.every((deduction) =>
        (DEDUCTION_CATEGORIES as readonly string[]).includes(deduction.category)
      ),
      statement.deductions.map((deduction) => deduction.category).join(",")
    );
    check(
      "the real model does not judge the deductions",
      statement.deductions.every(
        (deduction) => !/\b(illegal|unlawful|recoverable|disputable|entitled)\b/i.test(deduction.description)
      )
    );
  }

  // 2. Assessment — validated against the evidence it was actually given.
  const assessmentCall = await callModel({
    system: ASSESSMENT_SYSTEM_PROMPT,
    user: buildAssessmentUserPrompt({
      jurisdiction: JURISDICTION,
      depositAmount: DEPOSIT,
      description: "Carpet replacement",
      amount: 450,
      category: "ORDINARY_WEAR",
      researchQuestion: `Under ${JURISDICTION} law, may a landlord deduct from a security deposit for carpet replacement?`,
      sources: SOURCES,
    }),
    schemaName: ASSESSMENT_SCHEMA_NAME,
    jsonSchema: assessmentJsonSchema,
  });

  if ("blocked" in assessmentCall) {
    skip("a real assessment survives evidence-backed validation", assessmentCall.blocked);
  } else if ("failed" in assessmentCall) {
    check("live assessment returned a response", false, assessmentCall.failed);
  } else {
    const assessment = validateAssessment(assessmentCall.raw, {
      deductionAmount: 450,
      sources: SOURCES.map((source) => ({ label: source.label, id: source.id })),
    });
    check(
      "a real assessment survives evidence-backed validation",
      assessment !== null,
      assessment === null ? `raw=${JSON.stringify(assessmentCall.raw)?.slice(0, 300)}` : undefined
    );
    if (assessment) {
      check(
        "a real assessment never exceeds the stated deduction",
        assessment.potentiallyDisputableAmount <= 450,
        String(assessment.potentiallyDisputableAmount)
      );
      check(
        "a non-disputable outcome contributes exactly zero",
        assessment.assessment === "POTENTIALLY_DISPUTABLE" ||
          assessment.potentiallyDisputableAmount === 0,
        `${assessment.assessment} -> ${assessment.potentiallyDisputableAmount}`
      );
      check(
        "the cited source ids are real stored ids, not model-invented labels",
        assessment.assessmentSourceIds.every((id) => id === "s1" || id === "s2"),
        assessment.assessmentSourceIds.join(",")
      );
    }
  }

  // 3. Letter — the strictest boundary: unsupported legal claims are rejected.
  const letterCall = await callModel({
    system: LETTER_SYSTEM_PROMPT,
    user: buildLetterUserPrompt({
      jurisdiction: JURISDICTION,
      depositAmount: DEPOSIT,
      totalDeductions: TOTAL_DEDUCTIONS,
      potentiallyDisputableAmount: 850,
      deductions: [
        {
          description: "Carpet replacement",
          amount: 450,
          category: "ORDINARY_WEAR",
          assessment: "POTENTIALLY_DISPUTABLE",
          assessmentReason:
            "The retrieved sources indicate deductions must be for damage beyond ordinary wear, and this charge appears to be for ordinary wear.",
          potentiallyDisputableAmount: 450,
          missingInformation: [],
          sourceLabels: ["S1"],
        },
        {
          description: "Painting",
          amount: 300,
          category: "ORDINARY_WEAR",
          assessment: "POTENTIALLY_DISPUTABLE",
          assessmentReason:
            "The retrieved sources indicate repainting after a normal tenancy is ordinary wear rather than damage.",
          potentiallyDisputableAmount: 300,
          missingInformation: [],
          sourceLabels: ["S1"],
        },
        {
          description: "Cleaning",
          amount: 100,
          category: "ORDINARY_WEAR",
          assessment: "POTENTIALLY_DISPUTABLE",
          assessmentReason:
            "The retrieved sources indicate cleaning after a normal tenancy is ordinary wear rather than damage.",
          potentiallyDisputableAmount: 100,
          missingInformation: [],
          sourceLabels: ["S2"],
        },
      ],
      sources: SOURCES,
    }),
    schemaName: LETTER_SCHEMA_NAME,
    jsonSchema: letterJsonSchema,
  });

  if ("blocked" in letterCall) {
    skip("a real letter survives the claim and evidence checks", letterCall.blocked);
  } else if ("failed" in letterCall) {
    check("live letter generation returned a response", false, letterCall.failed);
  } else {
    const letter = validateLetter(letterCall.raw, {
      sources: SOURCES.map((source) => ({ label: source.label, id: source.id })),
    });
    check(
      "a real letter survives the claim and evidence checks",
      letter !== null,
      letter === null ? `raw=${JSON.stringify(letterCall.raw)?.slice(0, 300)}` : undefined
    );
    if (letter) {
      check(
        "the real letter asks for the figure the backend computed",
        letter.body.includes("850"),
        "the computed total does not appear in the body"
      );
      check(
        "the real letter rests on a real stored source",
        letter.supportingSourceIds.length > 0,
        letter.supportingSourceIds.join(",")
      );
      check(
        "the real letter makes no statute or case-law citation",
        !/\b\d+\s+U\.?S\.?C\.?\b|\bCal\.\s?(Civ|Code)\b|\bstatute\b|\bcase law\b/i.test(letter.body)
      );
    }
  }

  // 4. Response analysis — what a landlord's reply is read into.
  const readingCall = await callModel({
    system: RESPONSE_ANALYSIS_SYSTEM_PROMPT,
    user: buildResponseAnalysisUserPrompt({
      context: {
        jurisdiction: JURISDICTION,
        depositAmount: DEPOSIT,
        totalDeductions: TOTAL_DEDUCTIONS,
        potentiallyDisputableAmount: 850,
        letterSubject: "Request to review security deposit deductions",
      },
      message: {
        sender: "landlord@example.com",
        subject: "Re: Request to review security deposit deductions",
        body: LANDLORD_REPLY,
      },
    }),
    schemaName: RESPONSE_ANALYSIS_SCHEMA_NAME,
    jsonSchema: responseAnalysisJsonSchema,
  });

  if ("blocked" in readingCall) {
    skip("a real landlord reply survives response validation", readingCall.blocked);
  } else if ("failed" in readingCall) {
    check("live response analysis returned a response", false, readingCall.failed);
  } else {
    const reading = validateResponseAnalysis(readingCall.raw, { depositAmount: DEPOSIT });
    check(
      "a real landlord reply survives response validation",
      reading !== null,
      reading === null ? `raw=${JSON.stringify(readingCall.raw)?.slice(0, 300)}` : undefined
    );
    if (reading) {
      check(
        "the reply is read as an offer of $450, not as invented text",
        reading.offeredAmount === 450,
        String(reading.offeredAmount)
      );
      check(
        "an offer of money is not also recorded as a refusal of the whole dispute",
        !(reading.acceptsDispute && reading.rejectsDispute)
      );
    }
  }
}

async function verifyFirecrawl(): Promise<void> {
  lines.push("\n## Firecrawl (live)");

  if (!process.env.FIRECRAWL_API_KEY) {
    skip("Firecrawl search", "FIRECRAWL_API_KEY not configured");
    return;
  }

  let results: Awaited<ReturnType<typeof searchAuthoritative>> = [];
  try {
    results = await searchAuthoritative(
      `California security deposit deduction carpet replacement ordinary wear and tear`
    );
  } catch (error) {
    check("live search returned results", false, safe(error));
    return;
  }

  check("live search returned at least one result", results.length > 0, String(results.length));

  const official = results.filter((result) => classifyAuthority(result.url) === "OFFICIAL");
  check(
    "the official-source filter keeps government hosts",
    official.length > 0,
    results.map((result) => new URL(result.url).hostname).join(" ")
  );
  check(
    "no law-firm or forum host is classified as official",
    results
      .filter((result) => /lawfirm|reddit|quora|medium\.com|blog/i.test(result.url))
      .every((result) => classifyAuthority(result.url) === "NON_OFFICIAL"),
    results.map((result) => new URL(result.url).hostname).join(" ")
  );
}

async function verifyAgentMail(): Promise<void> {
  lines.push("\n## AgentMail (live, read-only)");

  const apiKey = process.env.AGENTMAIL_API_KEY;
  if (!apiKey) {
    skip("AgentMail auth probe", "AGENTMAIL_API_KEY not configured");
    return;
  }

  const baseUrl = (process.env.AGENTMAIL_API_BASE_URL ?? "https://api.agentmail.to/v0").replace(
    /\/+$/,
    ""
  );

  // Read-only: proves the credential is accepted and the API version path is
  // right. No inbox is created and no message is sent.
  //
  // The body is read exactly once, up front. Reading it eagerly inside the
  // check's detail argument (as this harness first did) consumes the stream and
  // makes the later `json()` call throw "Body has already been read" — which
  // then looked like an auth failure when the credential was in fact accepted.
  try {
    const response = await fetch(`${baseUrl}/inboxes`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();

    check(
      "the AgentMail credential is accepted",
      response.ok,
      response.ok ? undefined : `status=${response.status} ${safe(text).slice(0, 200)}`
    );

    if (response.ok) {
      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }

      const list = Array.isArray(body)
        ? body
        : Array.isArray((body as { inboxes?: unknown[] })?.inboxes)
          ? (body as { inboxes: unknown[] }).inboxes
          : null;
      check(
        "the AgentMail inbox list has the documented shape",
        list !== null,
        text.slice(0, 200)
      );
      if (list) lines.push(`# ${list.length} inbox(es) visible to this key`);
    }
  } catch (error) {
    check("the AgentMail credential is accepted", false, safe(error));
  }

  lines.push(
    "note a real outbound send and a real inbound reply are NOT exercised here:",
    "note both need a real recipient address, which this harness must not invent."
  );
}

async function main(): Promise<void> {
  lines.push("LIVE INTEGRATION VERIFICATION — real providers, real credentials");
  lines.push("This is not the mocked suite. Network calls leave this machine.");

  await verifyOpenAI();
  await verifyFirecrawl();
  await verifyAgentMail();

  console.log(lines.join("\n"));

  const total = lines.filter((line) => /^(ok|FAIL) /.test(line)).length;
  console.log(
    `\n${total - failed}/${total} live checks passed${skipped > 0 ? `, ${skipped} skipped` : ""}`
  );

  if (failed > 0) {
    console.log("\nLIVE VERIFICATION FAILED — a real provider response was rejected by the app.");
    process.exit(1);
  }

  if (skipped > 0) {
    console.log(
      "\nLIVE VERIFICATION INCOMPLETE — some integrations could not be exercised.",
      "\nReport those as LIVE VERIFICATION PENDING rather than passing."
    );
  }
}

main().catch((error) => {
  console.log(lines.join("\n"));
  console.error(`\nLive verification aborted: ${safe(error)}`);
  process.exit(1);
});
