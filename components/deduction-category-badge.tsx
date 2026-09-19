"use client";

/**
 * Shows what the landlord charged for. This label is descriptive only — it
 * carries no judgement about whether the charge is allowed, which is why the
 * categories are quiet and never use the accent reserved for findings.
 */
const CATEGORY_LABELS: Record<string, string> = {
  ORDINARY_WEAR: "Ordinary wear",
  TENANT_DAMAGE: "Tenant damage",
  FEE: "Fee",
  UNKNOWN: "Unclassified",
};

export function DeductionCategoryBadge({ category }: { category?: string }) {
  const label = (category && CATEGORY_LABELS[category]) || CATEGORY_LABELS.UNKNOWN;

  return (
    <span className="inline-flex w-fit items-center rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-muted">
      {label}
    </span>
  );
}
