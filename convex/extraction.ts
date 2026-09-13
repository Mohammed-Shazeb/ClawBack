import { z } from "zod";

import { DEDUCTION_CATEGORIES } from "./validators";

/**
 * Reading a landlord's deposit statement into structured data.
 *
 * Scope guard: this only records what the landlord stated. It draws no legal
 * conclusion, assigns no confidence, and never invents an amount, a law or a
 * citation. Legal analysis is a later milestone.
 */

export const depositStatementSchema = z.object({
  /** The deposit amount the statement itself states. */
  depositAmount: z.number().nonnegative().nullable(),
  /** The total the statement claims for deductions, when it states one. */
  statedTotalDeductions: z.number().nonnegative().nullable(),
  deductions: z.array(
    z.object({
      /** The landlord's own wording, kept as written. */
      description: z.string().min(1),
      /** The amount stated for this deduction; null when none is stated. */
      amount: z.number().nonnegative().nullable(),
      category: z.enum(DEDUCTION_CATEGORIES),
    })
  ),
  /** Ambiguity and skipped items, preserved instead of guessed at. */
  notes: z.string().nullable(),
});

export type DepositStatement = z.infer<typeof depositStatementSchema>;

export const DEPOSIT_STATEMENT_SCHEMA_NAME = "deposit_statement";

export const EXTRACTION_SYSTEM_PROMPT = `You read security deposit statements that landlords send to renters and record what they state as structured data.

Rules:
1. Record only what the statement actually says. Never estimate, assume, or fill in a value that is not written in the email.
2. depositAmount: the security deposit amount the statement states, in US dollars (for example 1500 or 1499.5). Use null when the statement does not state it.
3. statedTotalDeductions: the total deductions amount the statement itself states, if it states one. Use null when it does not. Never add the deductions up yourself for this field.
4. deductions: one entry for every deduction the statement itemizes.
   - description: the landlord's own wording for the charge, trimmed of extra whitespace. Keep their phrasing; do not translate, soften, or reinterpret it.
   - amount: the dollar amount stated for that deduction. Use null when the statement names a deduction without stating an amount. Never guess an amount.
   - category: what the landlord is charging for, as one of:
     - TENANT_DAMAGE: damage beyond ordinary use, such as a broken cabinet, holes in a wall, burns, or pet damage.
     - ORDINARY_WEAR: deterioration from normal living, such as repainting after a normal tenancy, carpet cleaning, or worn finishes.
     - FEE: a charge that is not payment for repair or cleaning work, such as an administrative, processing, or listing fee.
     - UNKNOWN: there is not enough information to classify the charge.
5. Classify only what the landlord charged for. Never judge whether a deduction is legal, fair, valid, excessive, or recoverable, and never imply such a conclusion. Do not mention laws, statutes, or courts.
6. Ignore conditional, vague, or forward-looking statements that state no amount, for example "we may deduct additional cleaning costs". Never turn them into a deduction and never invent an amount for them.
7. notes: short factual notes about anything ambiguous, any deduction named without an amount, and anything you deliberately skipped. Use null when there is nothing to note.
8. The email may contain quoted replies, signatures, or unrelated content. Extract the deposit statement only, and treat quoted statements from other people as content only if they are part of what the landlord is telling the renter.
9. Return numbers only: no currency symbols, no thousands separators, no text in numeric fields.`;

export function buildStatementUserPrompt({
  subject,
  body,
}: {
  subject: string;
  body: string;
}): string {
  return `Subject: ${subject || "(no subject)"}\n\n${body}`;
}

/**
 * The JSON Schema handed to the model for structured output. Generated from the
 * Zod schema above so the two can never drift apart, then trimmed to the subset
 * strict structured outputs allow (no `$schema`, every property required).
 */
export const depositStatementJsonSchema: Record<string, unknown> = (() => {
  const schema = z.toJSONSchema(depositStatementSchema, {
    target: "draft-7",
    io: "output",
  }) as Record<string, unknown>;

  delete schema.$schema;

  return schema;
})();

/** Validates a model response. Returns null when it does not match. */
export function parseDepositStatement(raw: unknown): DepositStatement | null {
  const parsed = depositStatementSchema.safeParse(raw);

  return parsed.success ? parsed.data : null;
}

/**
 * Converts a validated extraction into the value stored on the case: absent
 * values become `undefined` so Convex stores "unknown" rather than null.
 */
export function toExtractionResult(statement: DepositStatement): {
  depositAmount?: number;
  statedTotalDeductions?: number;
  deductions: Array<{
    description: string;
    amount?: number;
    category: (typeof DEDUCTION_CATEGORIES)[number];
  }>;
  notes?: string;
} {
  return {
    depositAmount: statement.depositAmount ?? undefined,
    statedTotalDeductions: statement.statedTotalDeductions ?? undefined,
    deductions: statement.deductions.map((deduction) => ({
      description: deduction.description.trim(),
      amount: deduction.amount ?? undefined,
      category: deduction.category,
    })),
    notes: statement.notes ?? undefined,
  };
}
