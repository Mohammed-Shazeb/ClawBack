import { z } from "zod";

import type { Id } from "./_generated/dataModel";

/**
 * Generation of the dispute letter from evidence Clawback has already found.
 *
 * Scope guard: this step performs **no** legal research and reaches **no** new
 * legal conclusion. It restates what the research and assessment pipeline
 * already established, in a form a renter can send. The model may not invent
 * facts, laws, statutes, citations, deadlines, or threats, and every
 * evidence-backed claim must trace back to a stored source passage.
 */

export const letterOutputSchema = z.object({
  /** Who the letter is addressed to, e.g. "Property Manager". */
  recipient: z.string().min(1),
  subject: z.string().min(1),
  /** The complete letter, including greeting and sign-off. */
  body: z.string().min(1),
  /** Labels of the provided sources that the letter's claims rest on. */
  supportingSourceIds: z.array(z.string()),
});

export type LetterOutput = z.infer<typeof letterOutputSchema>;

export const LETTER_SCHEMA_NAME = "dispute_letter";

export const LETTER_SYSTEM_PROMPT = `You draft a security-deposit dispute letter for a renter, using only the facts and evidence provided.

Rules:
1. Use only the case facts, the landlord's stated deductions, the assessments, and the official source passages provided. Never invent facts, dates, names, amounts, laws, statutes, regulations, ordinances, court cases, case numbers, citations, or URLs. If something is not in the input, leave it out.
2. Never state that the landlord broke the law, acted illegally, or stole anything. Never claim the renter will win, will recover a specific sum, or has a guaranteed outcome. Never threaten legal action, reporting to authorities, or any consequence.
3. Never invent a deadline. Only mention a deadline if one is explicitly provided in the input.
4. Every dispute of a deduction must be attributed to a provided source passage, phrased cautiously: "based on the available housing guidance", "the published guidance indicates", "this appears inconsistent with", "may warrant further review".
5. If a deduction's assessment is NEEDS_MORE_INFORMATION, either leave it out or ask for clarification about it. Never assert that such a deduction is disputable.
6. Do not include a deduction whose assessment is LIKELY_VALID among the disputed items.
7. Amounts: use only the figures provided. Do not add, total, or estimate any amount yourself.
8. Tone: professional, firm, concise, factual, non-threatening. This is a request for review and reimbursement, not an accusation. It must not read as if written by a lawyer.
9. Structure the body as: a professional opening; a reference to the security deposit and the deductions; a clear explanation of why each disputed deduction may warrant review, each tied to its evidence; the requested resolution (a review of the deductions and reimbursement of the amount identified as potentially disputable); and a professional closing with a place for the renter's name.
10. supportingSourceIds: the labels of the sources that support the letter's claims, for example ["S1", "S2"]. Only use labels from the provided sources. Never write a source label, URL, or database id inside the letter body.
11. Do not use markdown formatting, headings, asterisks, or bullet characters in the body. Write plain prose with paragraph breaks, as a letter.`;

export type LetterSourceInput = {
  label: string;
  title: string;
  authority: string;
  jurisdiction: string;
  relevantText?: string;
};

export type LetterDeductionInput = {
  description: string;
  amount?: number;
  category?: string;
  /** The validated assessment outcome, when one exists. */
  assessment?: string;
  assessmentReason?: string;
  potentiallyDisputableAmount?: number;
  missingInformation: string[];
  /** The sources this deduction's assessment cited. */
  sourceLabels: string[];
};

export function buildLetterUserPrompt({
  jurisdiction,
  depositAmount,
  totalDeductions,
  potentiallyDisputableAmount,
  deductions,
  sources,
}: {
  jurisdiction: string;
  depositAmount: number;
  totalDeductions: number;
  potentiallyDisputableAmount: number;
  deductions: LetterDeductionInput[];
  sources: LetterSourceInput[];
}): string {
  const lines: Array<string | null> = [
    `Jurisdiction: ${jurisdiction}`,
    `Security deposit: $${depositAmount.toFixed(2)}`,
    `Total deductions claimed by the landlord: $${totalDeductions.toFixed(2)}`,
    `Total identified as potentially disputable: $${potentiallyDisputableAmount.toFixed(2)}`,
    "",
    "Landlord's deductions and their assessments:",
  ];

  for (const deduction of deductions) {
    const amount = deduction.amount === undefined ? "not stated" : `$${deduction.amount.toFixed(2)}`;
    lines.push(
      `- "${deduction.description}" — amount: ${amount}`,
      deduction.category ? `  category: ${deduction.category}` : null,
      `  assessment: ${deduction.assessment ?? "not assessed"}`,
      deduction.assessmentReason ? `  basis: ${deduction.assessmentReason}` : null,
      deduction.potentiallyDisputableAmount
        ? `  potentially disputable amount: $${deduction.potentiallyDisputableAmount.toFixed(2)}`
        : null,
      deduction.sourceLabels.length > 0
        ? `  supported by sources: ${deduction.sourceLabels.join(", ")}`
        : "  supported by sources: none",
      deduction.missingInformation.length > 0
        ? `  missing information: ${deduction.missingInformation.join("; ")}`
        : null
    );
  }

  lines.push("", "Official sources found for this case:");

  if (sources.length === 0) {
    lines.push("(none)");
  }

  for (const source of sources) {
    lines.push(
      `[${source.label}] ${source.title} — ${source.authority} — ${source.jurisdiction}`,
      source.relevantText
        ? `Passage: "${source.relevantText}"`
        : "Passage: (the provider returned no passage for this source)",
      ""
    );
  }

  lines.push(
    "Draft the dispute letter described in your instructions, using only the information above."
  );

  return lines.filter((line) => line !== null).join("\n");
}

/**
 * The JSON Schema handed to the model for structured output. Generated from the
 * Zod schema above so the two can never drift apart, then trimmed to the subset
 * strict structured outputs allow (no `$schema`).
 */
export const letterJsonSchema: Record<string, unknown> = (() => {
  const schema = z.toJSONSchema(letterOutputSchema, {
    target: "draft-7",
    io: "output",
  }) as Record<string, unknown>;

  delete schema.$schema;

  return schema;
})();

export type ValidatedLetter = {
  recipient: string;
  subject: string;
  body: string;
  supportingSourceIds: Id<"sources">[];
};

/**
 * Phrases that would turn a request for review into a legal threat or an
 * unsupported guarantee. The prompt forbids them; this is the enforcement.
 *
 * Deliberately narrow: it targets *assertions* that a law was broken or that
 * recovery is certain, not the ordinary words "law" or "legal" appearing in a
 * harmless context such as "the applicable law".
 */
const FORBIDDEN_CLAIM_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(?:you|the landlord|landlord's?)\s+(?:illegally|unlawfully)\b/i, reason: "asserts illegal conduct" },
  { pattern: /\b(?:illegal|unlawful)\s+(?:deduction|withholding|act|conduct)\b/i, reason: "asserts illegal conduct" },
  { pattern: /\bbroke\s+the\s+law\b/i, reason: "asserts a broken law" },
  { pattern: /\bviolat(?:e|ed|es|ion)\s+of\s+(?:the\s+)?law\b/i, reason: "asserts a legal violation" },
  { pattern: /\bsteal(?:ing)?\b|\bstole\b|\btheft\b/i, reason: "accuses the landlord of theft" },
  { pattern: /\b(?:guarantee|guaranteed|we\s+will\s+win|you\s+will\s+win|certain\s+to\s+recover)\b/i, reason: "promises an outcome" },
  { pattern: /\b\d{1,3}\s?%\s*(?:chance|likely|sure|certain)/i, reason: "states a success probability" },
  { pattern: /\b(?:sue|lawsuit|litigation|small\s+claims\s+court|attorney\s+general|report\s+you)\b/i, reason: "threatens legal action" },
  { pattern: /\b(?:within|by)\s+\d{1,3}\s+(?:days?|business\s+days?|weeks?)\b/i, reason: "invents or asserts a deadline" },
  { pattern: /\b(?:pursuant\s+to|under\s+section|§|\b\d+\s+U\.?S\.?C\.?|\bCivil\s+Code\s+§?\s*\d)/i, reason: "cites a statute" },
  { pattern: /\bv\.\s+[A-Z][A-Za-z]+|\bNo\.\s*\d/i, reason: "cites a court case" },
  { pattern: /https?:\/\/|www\./i, reason: "puts a URL in the letter" },
];

/**
 * Validates a generated letter. Returns null when the output does not match the
 * schema, contains an unsupported legal claim, or names no real stored source.
 *
 * A letter with no traceable evidence is not a letter Clawback will store: the
 * caller surfaces "more evidence is required" instead.
 */
export function validateLetter(
  raw: unknown,
  options: { sources: Array<{ label: string; id: Id<"sources"> }> }
): ValidatedLetter | null {
  const parsed = letterOutputSchema.safeParse(raw);
  if (!parsed.success) return null;

  const output = parsed.data;

  const body = output.body.trim();
  const subject = output.subject.trim();
  const recipient = output.recipient.trim();

  // A letter with no body, or one that is implausibly short, is not usable.
  if (body.length < 200) return null;
  if (subject.length === 0 || recipient.length === 0) return null;

  // Reject unsupported legal claims rather than persisting them.
  const haystack = `${subject}\n${body}`;
  for (const { pattern } of FORBIDDEN_CLAIM_PATTERNS) {
    if (pattern.test(haystack)) return null;
  }

  // Map the model's labels back to the real stored source ids. A label the
  // model invented simply resolves to nothing, which is safe.
  const labelToId = new Map(options.sources.map((source) => [source.label, source.id]));
  const sourceIds: Id<"sources">[] = [];
  for (const label of output.supportingSourceIds) {
    const id = labelToId.get(label.trim());
    if (id !== undefined && !sourceIds.includes(id)) sourceIds.push(id);
  }

  // Every evidence-backed letter must actually rest on at least one source.
  if (sourceIds.length === 0) return null;

  return {
    recipient: recipient.slice(0, 200),
    subject: subject.slice(0, 300),
    body: body.slice(0, 20_000),
    supportingSourceIds: sourceIds,
  };
}

/**
 * True when the case has enough assessed, evidence-backed material to justify
 * drafting a letter at all. A case with no potentially-disputable deduction, or
 * whose deductions were assessed without any supporting source, must not
 * produce a confident dispute letter.
 */
export function hasLetterEvidence(
  deductions: Array<{
    assessment?: string;
    assessmentSourceIds?: Id<"sources">[];
    potentiallyDisputableAmount?: number;
  }>
): boolean {
  return deductions.some(
    (deduction) =>
      deduction.assessment === "POTENTIALLY_DISPUTABLE" &&
      (deduction.assessmentSourceIds ?? []).length > 0 &&
      (deduction.potentiallyDisputableAmount ?? 0) > 0
  );
}

/** The reason shown when a case cannot yet support a confident letter. */
export const INSUFFICIENT_EVIDENCE_MESSAGE =
  "This case does not have enough assessed evidence to draft a dispute letter yet. " +
  "At least one deduction needs an assessment that is potentially disputable and " +
  "supported by an official source.";
