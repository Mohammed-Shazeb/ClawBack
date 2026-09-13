"use client";

const CATEGORY_STYLES: Record<string, { label: string; className: string }> = {
  ORDINARY_WEAR: { label: "Ordinary wear", className: "bg-[#edf4f1] text-[#235b4c]" },
  TENANT_DAMAGE: { label: "Tenant damage", className: "bg-[#fbf0e9] text-[#8a5230]" },
  FEE: { label: "Fee", className: "bg-[#eef2f6] text-[#3d5a75]" },
  UNKNOWN: { label: "Unclassified", className: "bg-[#f3f5f5] text-[#69737d]" },
};

/**
 * Shows what the landlord charged for. This label is descriptive only — it
 * carries no judgement about whether the charge is allowed.
 */
export function DeductionCategoryBadge({ category }: { category?: string }) {
  const style = (category && CATEGORY_STYLES[category]) || CATEGORY_STYLES.UNKNOWN;

  return (
    <span
      className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${style.className}`}
    >
      {style.label}
    </span>
  );
}
