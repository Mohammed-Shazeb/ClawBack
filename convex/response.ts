import { z } from "zod";

import type { ResponseAnalysis } from "./validators";

/**
 * Reading a landlord's reply.
 *
 * This records what the message *says*, not what it means. The model is a
 * transcriber here, not an adviser: it may not infer intentions, add figures
 * that are not written down, or reach any legal conclusion. Everything it
 * returns is validated before it is stored, and the UI presents it as "what the
 * reply appears to say", never as a legal position.
 */

export const responseAnalysisSchema = z.object({
  /** Neutral restatement of the reply's content. */
  summary: z.string(),
  acceptsDispute: z.boolean(),
  rejectsDispute: z.boolean(),
  requestsMoreInformation: z.boolean(),
  offersPartialReimbursement: z.boolean(),
  /** The figure the reply names, or null when it names none. */
  offeredAmount: z.number().nullable(),
  providesNewEvidence: z.boolean(),
  /** What the new material is, or null. */
  newEvidenceSummary: z.string().nullable(),
  followUpQuestions: z.array(z.string()),
  missingInformation: z.array(z.string()),
});

export type ResponseAnalysisOutput = z.infer<typeof responseAnalysisSchema>;

export const RESPONSE_ANALYSIS_SCHEMA_NAME = "landlord_response_analysis";

export const RESPONSE_ANALYSIS_SYSTEM_PROMPT = `You record what a landlord's reply to a security-deposit dispute letter says. You are transcribing the message, not evaluating it.

Rules:
1. Record only what the message actually states. Never infer, assume, or add facts, figures, dates, names, or intentions that are not written in it. If something is not in the message, leave it out.
2. Never state or imply a legal conclusion. Do not say a deduction is illegal or lawful, do not say the renter will win or lose, and do not describe what either party is legally required to do.
3. Do not take sides, do not advise, and do not predict what happens next.
4. Flags reflect explicit content only. A flag is false when the message does not say it. Never set a flag because it seems plausible or helpful.
   - acceptsDispute: the reply concedes the dispute — it agrees that a deduction was not justified. Offering to pay an amount is recorded as offersPartialReimbursement instead, and does not by itself make this true.
   - rejectsDispute: the reply refuses the dispute.
   - requestsMoreInformation: the reply asks the renter for something (documents, details, clarification).
   - offersPartialReimbursement: the reply offers to pay an amount.
   - providesNewEvidence: the reply introduces material that was not in the original statement (photographs, invoices, a new claim).
5. offeredAmount: the figure the reply says it will pay, as a plain number. Use null when the reply names no figure. Never estimate one.
6. newEvidenceSummary: what the new material is, or null when there is none.
7. summary: a neutral, factual restatement in two or three sentences. No judgement, no advice, no legal framing, no recommendation.
8. followUpQuestions: what the reply asks of the renter, in the reply's own terms.
9. missingInformation: what the reply leaves unclear or unanswered.
10. If the message is not about the deposit at all, set every flag to false, use null for both optional fields, return empty lists, and say so plainly in summary.
11. Write plain prose. Do not use markdown.`;

export type ResponsePromptContext = {
  jurisdiction: string;
  depositAmount: number;
  totalDeductions: number;
  potentiallyDisputableAmount: number;
  /** Subject of the dispute letter this reply answers, when there is one. */
  letterSubject?: string;
};

export type ResponseMessageInput = {
  sender?: string;
  subject: string;
  body: string;
};

export function buildResponseAnalysisUserPrompt({
  context,
  message,
}: {
  context: ResponsePromptContext;
  message: ResponseMessageInput;
}): string {
  const lines: Array<string | null> = [
    "The case this reply belongs to:",
    `Jurisdiction: ${context.jurisdiction}`,
    `Security deposit: $${context.depositAmount.toFixed(2)}`,
    `Total deductions claimed by the landlord: $${context.totalDeductions.toFixed(2)}`,
    `Total identified as potentially disputable: $${context.potentiallyDisputableAmount.toFixed(2)}`,
    context.letterSubject ? `Dispute letter subject: ${context.letterSubject}` : null,
    "",
    "The landlord's reply:",
    message.sender ? `From: ${message.sender}` : null,
    message.subject ? `Subject: ${message.subject}` : null,
    "",
    message.body,
    "",
    "Record what this reply says, following your instructions. Use only what the reply contains.",
  ];

  return lines.filter((line) => line !== null).join("\n");
}

/**
 * The JSON Schema handed to the model, generated from the Zod schema so the two
 * cannot drift apart, then trimmed to the subset strict structured outputs
 * allow (no `$schema`).
 */
export const responseAnalysisJsonSchema: Record<string, unknown> = (() => {
  const schema = z.toJSONSchema(responseAnalysisSchema, {
    target: "draft-7",
    io: "output",
  }) as Record<string, unknown>;

  delete schema.$schema;

  return schema;
})();

/**
 * Phrases that would turn a transcription into a legal opinion or a prediction.
 * The prompt forbids them; this is the enforcement.
 *
 * Deliberately narrow: it targets conclusions and promises, not the ordinary
 * appearance of the word "legal" in a harmless context.
 */
const FORBIDDEN_ANALYSIS_PATTERNS: RegExp[] = [
  /\billegal\b|\bunlawful\b/i,
  /\bbroke\s+the\s+law\b|\bviolat(?:e|ed|es|ion)\s+of\s+(?:the\s+)?law\b/i,
  /\byou\s+will\s+(?:win|lose|recover)\b|\bthe\s+renter\s+will\s+(?:win|lose|recover)\b/i,
  /\bguarantee(?:d|s)?\b/i,
  // Matches the assertion wherever the subject falls, e.g. "is legally required",
  // "you are legally entitled", "legally obligated".
  /\blegally\s+(?:required|obligated|obliged|entitled|liable|bound)\b/i,
  /\bno\s+legal\s+(?:obligation|right|duty)\b/i,
  /\bwe\s+recommend\b|\byou\s+should\s+(?:sue|take|file)\b/i,
  /\b\d{1,3}\s?%\s*(?:chance|likely|sure|certain)/i,
];

const MAX_SUMMARY_LENGTH = 2_000;
const MAX_LIST_ITEMS = 20;
const MAX_LIST_ITEM_LENGTH = 500;

/**
 * Validates a reading of a reply. Returns null when the output does not match
 * the schema, contradicts itself, or reaches a conclusion the model is not
 * entitled to draw.
 *
 * `depositAmount` bounds `offeredAmount`: a figure larger than the deposit held
 * is not something the model could have read off a real reply, so it is treated
 * as a fabrication rather than stored.
 */
export function validateResponseAnalysis(
  raw: unknown,
  options: { depositAmount: number }
): ResponseAnalysis | null {
  const parsed = responseAnalysisSchema.safeParse(raw);
  if (!parsed.success) return null;

  const output = parsed.data;

  const summary = output.summary.trim();
  if (summary.length < 10 || summary.length > MAX_SUMMARY_LENGTH) return null;

  // A reply cannot both accept and refuse the dispute.
  if (output.acceptsDispute && output.rejectsDispute) return null;

  if (output.offeredAmount !== null) {
    if (!Number.isFinite(output.offeredAmount) || output.offeredAmount < 0) return null;

    // Nothing the landlord holds can exceed the deposit by any ordinary
    // reading, so a larger figure means the model invented it.
    if (options.depositAmount > 0 && output.offeredAmount > options.depositAmount) {
      return null;
    }
  }

  const newEvidenceSummary = output.newEvidenceSummary?.trim() ?? "";
  if (output.providesNewEvidence && newEvidenceSummary.length === 0) return null;

  // The reading must not editorialise.
  const haystack = [summary, newEvidenceSummary, ...output.followUpQuestions, ...output.missingInformation].join(
    "\n"
  );
  for (const pattern of FORBIDDEN_ANALYSIS_PATTERNS) {
    if (pattern.test(haystack)) return null;
  }

  const cleanList = (items: string[]): string[] =>
    items
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .slice(0, MAX_LIST_ITEMS)
      .map((item) => item.slice(0, MAX_LIST_ITEM_LENGTH));

  return {
    summary: summary.slice(0, MAX_SUMMARY_LENGTH),
    acceptsDispute: output.acceptsDispute,
    rejectsDispute: output.rejectsDispute,
    requestsMoreInformation: output.requestsMoreInformation,
    offersPartialReimbursement: output.offersPartialReimbursement,
    offeredAmount: output.offeredAmount ?? undefined,
    providesNewEvidence: output.providesNewEvidence,
    newEvidenceSummary: newEvidenceSummary.length > 0 ? newEvidenceSummary : undefined,
    followUpQuestions: cleanList(output.followUpQuestions),
    missingInformation: cleanList(output.missingInformation),
  };
}

/** The one-line gist of a reading, for a compact UI row. */
export function summarizeReading(analysis: ResponseAnalysis): string {
  const parts: string[] = [];

  if (analysis.acceptsDispute) parts.push("accepts the dispute");
  if (analysis.rejectsDispute) parts.push("rejects the dispute");
  if (analysis.offersPartialReimbursement) {
    parts.push(
      analysis.offeredAmount !== undefined
        ? `offers $${analysis.offeredAmount.toFixed(2)}`
        : "offers to pay"
    );
  }
  if (analysis.requestsMoreInformation) parts.push("asks for more information");
  if (analysis.providesNewEvidence) parts.push("provides new material");

  return parts.length > 0 ? parts.join(", ") : "no clear position stated";
}
