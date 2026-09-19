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

/** Short keyword phrasing of the same category, for a search-engine query. */
const CATEGORY_KEYWORDS: Record<DeductionCategory, string> = {
  ORDINARY_WEAR: "ordinary wear and tear",
  TENANT_DAMAGE: "tenant damage",
  FEE: "administrative fee",
  UNKNOWN: "",
};

/**
 * A short keyword query over exactly the same stored facts as
 * `buildResearchQuestion`.
 *
 * The prose question above is precise and auditable, but a real search engine
 * returns very few results for it — and often none on an official host.
 * Measured against the live provider on one California deduction: the prose form
 * returned 4 results with no government host at all, while this keyword form
 * returned 10 including `selfhelp.courts.ca.gov`. The mock never showed this
 * because it answers any query with official sources.
 *
 * Both queries are filtered by the same `classifyAuthority` rule, so this
 * improves recall of official sources without moving the OFFICIAL guarantee:
 * a non-government host is still non-official, whichever query surfaced it.
 */
export function buildResearchKeywordQuery({
  jurisdiction,
  description,
  category,
}: {
  jurisdiction: string;
  description: string;
  category?: DeductionCategory;
}): string {
  const keyword = category ? (CATEGORY_KEYWORDS[category] ?? "") : "";
  return [
    jurisdiction,
    "security deposit",
    description,
    "deduction",
    keyword,
    "official rules",
  ]
    .filter((part) => part.trim() !== "")
    .join(" ");
}
