import { z } from "zod";

import type { Id } from "./_generated/dataModel";
import { ASSESSMENT_OUTCOMES, type AssessmentOutcome } from "./validators";

/**
 * Evidence-based assessment of a single deduction.
 *
 * Scope guard: the model is asked whether the deduction *appears potentially
 * disputable* based only on the retrieved sources. It is never asked to declare
 * a deduction illegal, promise recovery, or produce a case-level total — the
 * case total is computed from the stored per-deduction amounts, never taken
 * from the model.
 */

export const assessmentOutputSchema = z.object({
  assessmentStatus: z.enum(ASSESSMENT_OUTCOMES),
  /** A concise, evidence-based explanation for the renter. */
  reasoning: z.string().min(1),
  /** 0 unless the outcome is POTENTIALLY_DISPUTABLE. */
  potentiallyDisputableAmount: z.number().nonnegative(),
  /** Labels of the provided sources that support the reasoning, e.g. ["S1"]. */
  supportingSourceIds: z.array(z.string()),
  /** What additional facts or documents would be needed. */
  missingInformation: z.array(z.string()),
});

export type AssessmentOutput = z.infer<typeof assessmentOutputSchema>;

export const ASSESSMENT_SCHEMA_NAME = "deduction_assessment";

export const ASSESSMENT_SYSTEM_PROMPT = `You assess whether a landlord's security-deposit deduction appears potentially disputable, using only the evidence provided.

Rules:
1. Reason only from the jurisdiction, the case facts, and the official source passages provided. Do not invent laws, statutes, regulations, court cases, citations, URLs, or facts. If a needed rule is not in a provided passage, say information is missing instead of filling it in.
2. Never state that a deduction is illegal, unlawful, or that the renter will recover money. "Potentially disputable" only ever means the available source indicates the charge may not satisfy the applicable conditions.
3. Use cautious wording: "the available source indicates", "appears inconsistent with", "may warrant further review", "more information is needed".
4. assessmentStatus:
   - POTENTIALLY_DISPUTABLE: at least one provided passage states conditions or limits that this deduction may not satisfy.
   - LIKELY_VALID: the provided passages indicate the charge is consistent with the applicable rules.
   - NEEDS_MORE_INFORMATION: the evidence is insufficient to say either way. Prefer this over guessing.
5. reasoning: 1 to 3 sentences a renter can understand, explaining what in the source passage supports the assessment. Write it as the final explanation shown to the renter, not as your private thinking process.
6. potentiallyDisputableAmount: 0 unless assessmentStatus is POTENTIALLY_DISPUTABLE, and never more than the deduction's stated amount. When the deduction has no stated amount, use 0.
7. supportingSourceIds: the labels of the sources that support your reasoning, for example ["S1"]. Only use labels from the provided sources.
8. missingInformation: short list of the specific facts or documents still needed, empty when nothing is missing.`;

export type AssessmentSourceInput = {
  label: string;
  title: string;
  authority: string;
  jurisdiction: string;
  relevantText?: string;
};

export function buildAssessmentUserPrompt({
  jurisdiction,
  depositAmount,
  description,
  amount,
  category,
  researchQuestion,
  sources,
}: {
  jurisdiction: string;
  depositAmount: number;
  description: string;
  amount?: number;
  category?: string;
  researchQuestion?: string;
  sources: AssessmentSourceInput[];
}): string {
  const lines = [
    `Jurisdiction: ${jurisdiction}`,
    `Security deposit: $${depositAmount.toFixed(2)}`,
    "",
    `Landlord's deduction: "${description}"`,
    `Stated amount: ${amount === undefined ? "not stated" : `$${amount.toFixed(2)}`}`,
    category ? `Category: ${category}` : null,
    "",
    researchQuestion ? `Research question: ${researchQuestion}` : null,
    "",
    "Official sources found:",
  ];

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
    "Assess whether this deduction appears potentially disputable based only on the sources above."
  );

  return lines.filter((line) => line !== null).join("\n");
}

/**
 * The JSON Schema handed to the model for structured output. Generated from the
 * Zod schema above so the two can never drift apart, then trimmed to the subset
 * strict structured outputs allow (no `$schema`, every property required).
 */
export const assessmentJsonSchema: Record<string, unknown> = (() => {
  const schema = z.toJSONSchema(assessmentOutputSchema, {
    target: "draft-7",
    io: "output",
  }) as Record<string, unknown>;

  delete schema.$schema;

  return schema;
})();

export type ValidatedAssessment = {
  assessment: AssessmentOutcome;
  assessmentReason: string;
  potentiallyDisputableAmount: number;
  assessmentSourceIds: Id<"sources">[];
  assessmentMissingInformation: string[];
};

/**
 * Validates a model response against the evidence it was given. Returns null
 * when the output does not match the schema or an evidence-backed outcome names
 * no real source.
 *
 * Amount invariants are enforced here rather than trusted: a disputable amount
 * can never exceed the stated deduction amount, and non-disputable outcomes
 * contribute 0.
 */
export function validateAssessment(
  raw: unknown,
  options: {
    deductionAmount?: number;
    sources: Array<{ label: string; id: Id<"sources"> }>;
  }
): ValidatedAssessment | null {
  const parsed = assessmentOutputSchema.safeParse(raw);
  if (!parsed.success) return null;

  const output = parsed.data;

  const labelToId = new Map(options.sources.map((source) => [source.label, source.id]));
  const sourceIds: Id<"sources">[] = [];
  for (const label of output.supportingSourceIds) {
    const id = labelToId.get(label.trim());
    if (id !== undefined && !sourceIds.includes(id)) sourceIds.push(id);
  }

  // An evidence-backed outcome must actually rest on at least one real source.
  if (output.assessmentStatus !== "NEEDS_MORE_INFORMATION" && sourceIds.length === 0) {
    return null;
  }

  const amount =
    output.assessmentStatus === "POTENTIALLY_DISPUTABLE"
      ? roundCurrency(Math.min(output.potentiallyDisputableAmount, options.deductionAmount ?? 0))
      : 0;

  return {
    assessment: output.assessmentStatus,
    assessmentReason: output.reasoning.trim().slice(0, 600),
    potentiallyDisputableAmount: amount,
    assessmentSourceIds: sourceIds,
    assessmentMissingInformation: output.missingInformation
      .map((item) => item.trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 6),
  };
}

/**
 * The case-level disputable total is always recomputed from the stored
 * per-deduction assessments — never taken from the model — and each deduction
 * is capped at its stated amount.
 */
export function computePotentiallyDisputableAmount(
  deductions: Array<{
    amount?: number;
    assessment?: AssessmentOutcome;
    potentiallyDisputableAmount?: number;
  }>
): number {
  return roundCurrency(
    deductions
      .filter((deduction) => deduction.assessment === "POTENTIALLY_DISPUTABLE")
      .reduce(
        (total, deduction) =>
          total + Math.max(0, Math.min(deduction.potentiallyDisputableAmount ?? 0, deduction.amount ?? 0)),
        0
      )
  );
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
