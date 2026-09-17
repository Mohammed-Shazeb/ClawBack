/**
 * Local mock providers for end-to-end pipeline verification.
 *
 * Stands in for Firecrawl (:4590), OpenAI (:4591) and AgentMail (:4592) so the
 * whole pipeline can be exercised without live credentials. Point a Convex
 * deployment at these with:
 *
 *   npx convex env set FIRECRAWL_API_BASE_URL http://127.0.0.1:4590/v1
 *   npx convex env set OPENAI_BASE_URL        http://127.0.0.1:4591/v1
 *   npx convex env set OPENAI_MODEL           mock-gpt
 *   npx convex env set AGENTMAIL_API_BASE_URL http://127.0.0.1:4592/v0
 *
 * Responses are deliberately adversarial: the assessment mock claims an
 * amount larger than the deduction (to prove capping), the search mock mixes
 * official and non-official hosts (to prove filtering), and one deduction gets
 * insufficient evidence (to prove NEEDS_MORE_INFORMATION).
 */
import { createServer } from "node:http";

// --- Firecrawl mock (port 4590) ------------------------------------------------
// Returns a mix of official (.gov) and non-official results so the official
// filter is exercised; only .gov results should be stored.
const firecrawlResults = [
  {
    url: "https://www.dre.ca.gov/consumers/security-deposits.html",
    title: "Security Deposits — California Department of Real Estate",
    description: "Official guidance on security deposit deductions.",
    markdown: `# Security Deposits\n\nThis page describes intake procedures and contact details.\n\nA landlord may use the security deposit for unpaid rent or repair of damage beyond ordinary wear and tear. Deductions must be itemized in writing and returned within 21 days.\n\nCarpet replacement charged for normal wear is generally not deductible.`,
  },
  {
    url: "https://courts.ca.gov/selfhelp-security-deposit.html",
    title: "Security Deposit Self-Help — California Courts",
    description: "Court guidance on deposit disputes.",
    markdown: `A landlord who deducts painting or carpet costs for ordinary wear may be required to return that portion of the deposit.`,
  },
  {
    url: "https://www.lawfirm-marketing.com/blog/security-deposits",
    title: "10 Things About Security Deposits!",
    description: "SEO blog post.",
    markdown: "Deductions everywhere, carpet carpet carpet.",
  },
];

// --- OpenAI mock (port 4591) ---------------------------------------------------
// Serves both extraction and assessment calls, keyed by the system prompt.
//
// Extraction is derived from the statement text rather than fixed, so a revised
// statement genuinely produces a different set of deductions and the
// "a revision replaces the previous deductions" assertion actually tests the
// pipeline instead of a constant.
const KNOWN_CATEGORIES = [
  [/paint/i, "ORDINARY_WEAR"],
  [/carpet/i, "ORDINARY_WEAR"],
  [/cabinet|door|wall|blind/i, "TENANT_DAMAGE"],
  [/fee|administrative|cleaning charge/i, "FEE"],
];

function categoryFor(description) {
  for (const [pattern, category] of KNOWN_CATEGORIES) {
    if (pattern.test(description)) return category;
  }
  return "OTHER";
}

/** Reads `Label: $123` lines out of the statement, exactly like a real model would. */
function extractFromStatement(text) {
  const deductions = [];
  let depositAmount = null;
  let statedTotalDeductions = null;

  for (const rawLine of String(text).split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const money = /\$([0-9][0-9,]*(?:\.[0-9]{1,2})?)/.exec(line);
    const amount = money ? Number(money[1].replace(/,/g, "")) : null;

    if (/^security deposit\b/i.test(line)) {
      depositAmount = amount;
      continue;
    }
    if (/^total deductions\b/i.test(line)) {
      statedTotalDeductions = amount;
      continue;
    }

    const label = line.split(":")[0]?.trim();
    if (!label || amount === null) continue;
    deductions.push({ description: label, amount, category: categoryFor(label) });
  }

  return { depositAmount, statedTotalDeductions, deductions, notes: null };
}

function extractionResponse(statementText) {
  return { choices: [{ message: { content: JSON.stringify(extractFromStatement(statementText)) } }] };
}

function assessmentResponse(deductionDescription) {
  const body = {
    choices: [
      {
        message: {
          content: JSON.stringify(
            deductionDescription.includes("Broken cabinet")
              ? {
                  assessmentStatus: "LIKELY_VALID",
                  reasoning:
                    "The available source indicates a landlord may deduct for repair of tenant-caused damage beyond ordinary wear, and the statement attributes the cabinet charge to damage.",
                  potentiallyDisputableAmount: 0,
                  supportingSourceIds: ["S1"],
                  missingInformation: [],
                }
              : deductionDescription.includes("Administrative fee")
                ? {
                    assessmentStatus: "NEEDS_MORE_INFORMATION",
                    reasoning:
                      "The provided passages do not state whether an administrative processing fee may be taken from a security deposit, so more information is needed.",
                    potentiallyDisputableAmount: 0,
                    supportingSourceIds: [],
                    missingInformation: [
                      "Whether the lease allows administrative fees to be taken from the deposit",
                    ],
                  }
                : {
                    assessmentStatus: "POTENTIALLY_DISPUTABLE",
                    reasoning:
                      "The available source indicates deductions must be for damage beyond ordinary wear and tear, and this charge appears to be for ordinary wear, so it may warrant further review.",
                    // Deliberately exceeds the deduction amount to prove capping.
                    potentiallyDisputableAmount: 9999,
                    supportingSourceIds: ["S1", "S2"],
                    missingInformation: [],
                  }
          ),
        },
      },
    ],
  };
  return body;
}

// --- Letter mock ---------------------------------------------------------------
// The dispute letter. Built from the real prompt so the assertions downstream
// test the pipeline (labels resolved to ids, the requested amount, the cited
// passages) rather than a constant.
//
// It is deliberately written to satisfy the same rules the real model is held
// to: cautious warrant phrasing, no statute/case citations, no deadlines, no
// threats, and DISPUTE_SENTINEL never leaking into the stored body.
//
// The prompt format it parses is:
//
//   Total identified as potentially disputable: $500.00
//   - "Painting" — amount: $300.00
//     assessment: POTENTIALLY_DISPUTABLE
//     potentially disputable amount: $300.00
//     supported by sources: S1, S2
//   [S1] Title — Authority — Jurisdiction
//   Passage: "..."
//
// If the prompt format in convex/letter.ts changes, these parsers must change
// with it — they are deliberately reading the real prompt, not a fixture.

/** Reads the `[S1] Title — Authority — Jurisdiction` + `Passage: "..."` pairs. */
function sourcesFromLetterPrompt(userPrompt) {
  const lines = String(userPrompt).split("\n");
  const sources = [];
  for (let i = 0; i < lines.length; i += 1) {
    const header = /^\[(S\d+)\]\s*(.+)$/.exec(lines[i].trim());
    if (!header) continue;
    const [, label, rest] = header;
    const parts = rest.split("—").map((part) => part.trim());
    const passage = /^Passage:\s*"(.*)"\s*$/.exec((lines[i + 1] ?? "").trim())?.[1] ?? "";
    sources.push({
      label,
      title: parts[0] ?? "",
      authority: parts[1] ?? "",
      jurisdiction: parts[2] ?? "",
      passage,
    });
  }
  return sources;
}

/** The deductions the prompt marks as POTENTIALLY_DISPUTABLE, in prompt order. */
function disputableFromLetterPrompt(userPrompt) {
  const lines = String(userPrompt).split("\n");
  const blocks = [];
  let current = null;

  for (const line of lines) {
    const item = /^-\s*"(.+?)"\s*—\s*amount:\s*(.+)$/.exec(line.trim());
    if (item) {
      if (current) blocks.push(current);
      current = { description: item[1], amount: item[2], details: [] };
      continue;
    }
    if (current && /^\s{2}\S/.test(line) && !/^Official sources/.test(line.trim())) {
      current.details.push(line.trim());
      continue;
    }
    if (/^Official sources found/.test(line.trim()) && current) {
      blocks.push(current);
      current = null;
    }
  }
  if (current) blocks.push(current);

  const disputable = [];
  for (const block of blocks) {
    const detail = block.details.join("\n");
    if (!/assessment:\s*POTENTIALLY_DISPUTABLE\b/i.test(detail)) continue;
    const amount = /potentially disputable amount:\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i.exec(detail)?.[1];
    const labels = /supported by sources:\s*(.+)$/im.exec(detail)?.[1]?.match(/\bS\d+\b/g) ?? [];
    disputable.push({
      description: block.description,
      amount: block.amount,
      // Capped the same way the assessment pipeline caps: never claim more than
      // the deduction itself.
      disputableAmount: amount,
      labels: Array.from(new Set(labels)),
    });
  }
  return disputable;
}

/**
 * Picks the passage that best fits a disputed deduction, restricted to the
 * sources its assessment actually cited. Prefers a passage that mentions a
 * distinctive word from the deduction, so the letter does not quote an
 * unrelated passage from a source that happens to be cited first.
 */
function passageFor(item, byLabel, fallback) {
  const cited = item.labels.map((label) => byLabel.get(label)).filter(Boolean);
  const candidates = cited.length > 0 ? cited : fallback ? [fallback] : [];
  if (candidates.length === 0) return { passage: "", authority: "relevant housing authority" };

  const words = item.description
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length > 3);

  let best = candidates[0];
  let bestScore = -1;
  for (const candidate of candidates) {
    const text = String(candidate.passage ?? "").toLowerCase();
    const score = words.reduce((total, word) => total + (text.includes(word) ? 1 : 0), 0);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return { passage: best.passage ?? "", authority: best.authority || "relevant housing authority" };
}

function money(value) {
  return `$${Number(String(value).replace(/[^0-9.]/g, "") || 0).toFixed(2)}`;
}

function letterResponse(userPrompt) {
  const sources = sourcesFromLetterPrompt(userPrompt);
  const disputable = disputableFromLetterPrompt(userPrompt);
  const byLabel = new Map(sources.map((source) => [source.label, source]));

  const requestedIn = /Total identified as potentially disputable:\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i.exec(
    userPrompt
  )?.[1];
  const depositIn = /Security deposit:\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i.exec(userPrompt)?.[1];
  const deductionsIn = /Total deductions claimed by the landlord:\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i.exec(
    userPrompt
  )?.[1];

  const paragraphs = [
    `I am writing about the security deposit of ${money(depositIn)} held for my tenancy. The itemized statement I received lists ${money(
      deductionsIn
    )} in deductions. DISPUTE_SENTINEL I am requesting that the charges described below be reviewed and that ${money(
      requestedIn
    )} of the deposit be reimbursed to me.`,
    `Based on the available housing guidance, I am requesting clarification and reimbursement for the deductions described below. I am not asserting that any deduction was unlawful; I am asking that these charges be reviewed against the standards published for this jurisdiction.`,
  ];

  for (const item of disputable) {
    const { passage, authority } = passageFor(item, byLabel, sources[0]);
    paragraphs.push(
      `The statement includes "${item.description}" at ${money(
        item.amount
      )}. The guidance published by the ${authority} indicates: "${
        passage
      }" Based on that guidance, this charge may include an amount attributable to ordinary wear rather than to damage caused during the tenancy. I am requesting that this deduction be reviewed and that the ${money(
        item.disputableAmount ?? 0
      )} identified as potentially disputable be reimbursed.`
    );
  }

  paragraphs.push(
    `If any of these charges were based on information I have not seen, I would welcome the supporting documentation so I can review it. I am happy to discuss this directly and reach a resolution without further steps. Thank you for your time and for reviewing this request.`
  );

  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            recipient: "landlord@example.com",
            subject: "Request for review of security deposit deductions",
            body: paragraphs.join("\n\n"),
            supportingSourceIds: Array.from(new Set(disputable.flatMap((item) => item.labels))),
          }),
        },
      },
    ],
  };
}

// --- Landlord response analysis -------------------------------------------------
// Reads the reply out of the real prompt and derives the flags from what the
// reply actually says, so the assertions test the pipeline rather than a fixture.
// The result must satisfy the same validation the real model is held to.

/** Pulls the landlord's message out of the response-analysis prompt. */
function replyBodyFromPrompt(userPrompt) {
  const marker = "The landlord's reply:";
  const index = String(userPrompt).indexOf(marker);
  let body = index >= 0 ? String(userPrompt).slice(index + marker.length) : String(userPrompt);

  body = body
    .split("\n")
    .filter((line) => !/^\s*(?:From|Subject):/.test(line))
    .join("\n");

  return body.split("Record what this reply says")[0].trim();
}

function responseAnalysisResponse(userPrompt) {
  const body = replyBodyFromPrompt(userPrompt);

  // A refusal and an acceptance are mutually exclusive by construction, so the
  // reading can never contradict itself.
  const rejectsDispute =
    /\b(?:decline|declines|declined|reject|rejects|rejected|refuse|refuses|refused|deny|denies|denied|will not|won't|not going to)\b/i.test(
      body
    );
  // Conceding the dispute is a distinct act from offering money. "I can refund
  // $150" is a partial offer, not an admission that the deduction was wrong, so
  // it is recorded through offersPartialReimbursement and not here.
  const acceptsDispute =
    !rejectsDispute &&
    /\b(?:accept|accepts|accepted|agree|agrees|agreed|concede|concedes|conceded|acknowledge|acknowledges|acknowledged)\b/i.test(
      body
    );

  const amountMatch = /\$\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)/.exec(body);
  const offeredAmount = amountMatch ? Number(amountMatch[1].replace(/,/g, "")) : null;
  const offersPartialReimbursement = offeredAmount !== null;

  const requestsMoreInformation =
    /\b(?:send me|provide|providing|need|needs|please send|let me know|clarify|documentation of|proof)\b/i.test(
      body
    );

  const evidenceMatch = /\b(?:attached|enclosed|invoices?|receipts?|photographs?|photos?|pictures?)\b/i.exec(
    body
  );
  const providesNewEvidence = Boolean(evidenceMatch);

  // A short, neutral restatement assembled from the flags, never from opinion.
  const parts = [];
  if (rejectsDispute) parts.push("The landlord declines the dispute.");
  else if (acceptsDispute) parts.push("The landlord indicates agreement with the dispute.");
  else parts.push("The reply does not clearly accept or refuse the dispute.");

  if (offeredAmount !== null) {
    parts.push(`The reply names a figure of $${offeredAmount.toFixed(2)}.`);
  }
  if (requestsMoreInformation) parts.push("The reply asks the renter for more information.");
  if (providesNewEvidence) parts.push("The reply refers to material not in the original statement.");

  const summary = parts.join(" ");

  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            summary,
            acceptsDispute,
            rejectsDispute,
            requestsMoreInformation,
            offersPartialReimbursement,
            offeredAmount,
            providesNewEvidence,
            newEvidenceSummary: providesNewEvidence
              ? `The reply refers to ${evidenceMatch[0].toLowerCase()}.`
              : null,
            followUpQuestions: requestsMoreInformation
              ? ["The reply asks the renter for further information."]
              : [],
            missingInformation:
              !acceptsDispute && !rejectsDispute
                ? ["The reply does not state whether the dispute is accepted or refused."]
                : [],
          }),
        },
      },
    ],
  };
}

const openaiCalls = [];
const openai = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const payload = JSON.parse(body || "{}");
    openaiCalls.push({ system: payload.messages?.[0]?.content ?? "", user: payload.messages?.[1]?.content ?? "" });
    const systemPrompt = payload.messages?.[0]?.content ?? "";
    const userPrompt = payload.messages?.[1]?.content ?? "";
    const isAssessment = systemPrompt.includes("potentially disputable");
    // The letter system prompt is the only one that talks about the renter's
    // own letter; the assessment prompt also contains "potentially disputable",
    // so this is checked separately rather than as an else-branch.
    const isLetter = /You draft a security-deposit dispute letter/i.test(systemPrompt);
    const isResponseAnalysis = /You record what a landlord's reply/i.test(systemPrompt);
    const deductionDescription = isAssessment
      ? /deduction: "([^"]+)"/i.exec(userPrompt)?.[1] ?? ""
      : "";
    const body_ = JSON.stringify(
      isResponseAnalysis
        ? responseAnalysisResponse(userPrompt)
        : isLetter
          ? letterResponse(userPrompt)
          : isAssessment
            ? assessmentResponse(deductionDescription)
            : extractionResponse(userPrompt)
    );    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(body_);
  });
});

// --- AgentMail mock (port 4592) ------------------------------------------------
// Covers inbox provisioning plus outbound sending, so the send path is exercised
// against a provider that behaves like the real one.
//
// Two deliberate behaviours:
//   * a thread is created on the first send to an inbox and reused afterwards,
//     exactly as a mail provider threads a conversation;
//   * a recipient starting with `fail@` is rejected with a 500, which is how the
//     send-failure path is tested without pretending it cannot happen.
//
// `GET /__sends` exposes the send log so a test can prove the landlord received
// exactly one copy.
const agentmailCalls = [];
const inboxes = new Map();
const sends = [];
const threads = new Map();
let messageCounter = 0;

const agentmail = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    agentmailCalls.push({ method: req.method, url: req.url });

    // Test-only introspection: what has actually been sent.
    if (req.method === "GET" && req.url === "/__sends") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(sends));
      return;
    }

    if (req.method === "POST" && /\/inboxes\/?$/.test(req.url)) {
      const payload = JSON.parse(body || "{}");
      const inboxId = `${payload.username}@agentmail.to`;
      inboxes.set(inboxId, payload);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ inbox_id: inboxId, display_name: payload.display_name, client_id: payload.client_id }));
      return;
    }

    if (req.method === "GET" && /\/inboxes\/?$/.test(req.url)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(Array.from(inboxes.values())));
      return;
    }

    // Outbound send: POST {base}/inboxes/{inbox_id}/messages/send. The base URL
    // already carries the API version, so the path is matched from `/inboxes`.
    const sendMatch = /\/inboxes\/([^/]+)\/messages\/send\/?$/.exec(req.url ?? "");
    if (req.method === "POST" && sendMatch) {
      const payload = JSON.parse(body || "{}");
      const inboxId = decodeURIComponent(sendMatch[1]);

      sends.push({
        inboxId,
        to: payload.to,
        subject: payload.subject,
        text: payload.text,
        threadId: payload.thread_id ?? null,
        headers: payload.headers ?? null,
      });

      if (String(payload.to ?? "").toLowerCase().startsWith("fail@")) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "simulated provider failure" }));
        return;
      }

      messageCounter += 1;
      const messageId = `msg_out_${messageCounter}_${Date.now().toString(36)}`;
      const threadId = payload.thread_id ?? threads.get(inboxId) ?? `thr_${inboxId.split("@")[0]}`;
      threads.set(inboxId, threadId);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          inbox_id: inboxId,
          thread_id: threadId,
          message_id: messageId,
          to: payload.to,
          from: inboxId,
          subject: payload.subject,
          text: payload.text,
          labels: ["sent"],
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
});

const firecrawlCalls = [];
const firecrawl = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    firecrawlCalls.push({ url: req.url, query: JSON.parse(body || "{}").query });
    if (req.method === "POST" && /\/search\/?$/.test(req.url)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, data: firecrawlResults }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
});

await new Promise((resolve) => firecrawl.listen(4590, resolve));
await new Promise((resolve) => openai.listen(4591, resolve));
await new Promise((resolve) => agentmail.listen(4592, resolve));
console.log(JSON.stringify({ status: "mocks up", ports: [4590, 4591, 4592] }));

// Keep the process alive; logs a heartbeat so the parent knows it's alive.
setInterval(() => {}, 60000);
