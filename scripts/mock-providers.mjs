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
    const deductionDescription = isAssessment
      ? /deduction: "([^"]+)"/i.exec(userPrompt)?.[1] ?? ""
      : "";
    const body_ = JSON.stringify(
      isAssessment ? assessmentResponse(deductionDescription) : extractionResponse(userPrompt)
    );
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(body_);
  });
});

// --- AgentMail mock (port 4592) ------------------------------------------------
const agentmailCalls = [];
const inboxes = new Map();
const agentmail = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    agentmailCalls.push({ method: req.method, url: req.url });
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
