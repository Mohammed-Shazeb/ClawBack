import type { DeductionCategory } from "./validators";

/**
 * Turning an extracted deduction into the research question that official
 * sources will be sought for.
 *
 * Scope guard: this asks "what authoritative rule do we need to find?" — it
 * never asserts that the deduction is legal or not. The question is built
 * deterministically from stored case facts, so the same deduction always
 * produces the same question and nothing here can hallucinate.
 */

const CATEGORY_FOCUS: Record<DeductionCategory, string> = {
  ORDINARY_WEAR: "a charge for ordinary wear or normal maintenance",
  TENANT_DAMAGE: "a charge for repair work attributed to tenant damage",
  FEE: "an administrative, processing, or other non-repair fee",
  UNKNOWN: "a charge of this kind",
};

const UNKNOWN_CATEGORY_FOCUS = CATEGORY_FOCUS.UNKNOWN;

export function categoryFocus(category: DeductionCategory | undefined): string {
  return category ? (CATEGORY_FOCUS[category] ?? UNKNOWN_CATEGORY_FOCUS) : UNKNOWN_CATEGORY_FOCUS;
}

export function buildResearchQuestion({
  jurisdiction,
  description,
  category,
}: {
  jurisdiction: string;
  description: string;
  category?: DeductionCategory;
}): string {
  return (
    `What official rules in ${jurisdiction} govern whether a landlord may deduct ` +
    `${categoryFocus(category)} — described on the deposit statement as "${description}" — ` +
    `from a residential security deposit, and what conditions, limits, or documentation ` +
    `requirements apply to that deduction?`
  );
}
