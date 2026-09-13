"use client";

import { Receipt } from "lucide-react";

import { formatCurrency } from "@/lib/format";
import { DeductionCategoryBadge } from "./deduction-category-badge";

export type DeductionRow = {
  _id: string;
  description: string;
  amount?: number;
  category?: string;
};

export function CaseDeductions({
  deductions,
  isAnalyzing,
}: {
  deductions: DeductionRow[] | undefined;
  isAnalyzing: boolean;
}) {
  const statedTotal = (deductions ?? []).reduce(
    (total, deduction) => total + (deduction.amount ?? 0),
    0
  );
  const unstatedCount = (deductions ?? []).filter(
    (deduction) => deduction.amount === undefined
  ).length;

  return (
    <section className="overflow-hidden rounded-xl border border-[#e4e7eb] bg-white">
      <div className="border-b border-[#edf0f2] px-5 py-4">
        <h2 className="text-sm font-semibold">Deductions</h2>
        <p className="mt-1 text-xs text-[#89929b]">
          What the statement itemized, as the landlord described it.
        </p>
      </div>

      {deductions === undefined ? (
        <LoadingRows />
      ) : deductions.length === 0 ? (
        <EmptyDeductions isAnalyzing={isAnalyzing} />
      ) : (
        <>
          <ul className="divide-y divide-[#edf0f2]">
            {deductions.map((deduction) => (
              <li
                key={deduction._id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{deduction.description}</p>
                  <div className="mt-1.5">
                    <DeductionCategoryBadge category={deduction.category} />
                  </div>
                </div>
                <p
                  className={`text-sm font-semibold tabular-nums ${
                    deduction.amount === undefined ? "text-[#a0a8ae]" : "text-[#18212b]"
                  }`}
                >
                  {formatCurrency(deduction.amount)}
                </p>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-[#edf0f2] bg-[#fbfcfc] px-5 py-3.5">
            <div>
              <p className="text-xs font-semibold text-[#35414b]">Itemized total</p>
              {unstatedCount > 0 ? (
                <p className="mt-1 text-xs text-[#89929b]">
                  {unstatedCount} item{unstatedCount === 1 ? "" : "s"} named without an amount
                </p>
              ) : null}
            </div>
            <p className="text-sm font-semibold tabular-nums">{formatCurrency(statedTotal)}</p>
          </div>
        </>
      )}

      <p className="border-t border-[#edf0f2] px-5 py-3 text-[11px] leading-5 text-[#a0a8ae]">
        Categories describe what the landlord charged for. No legal assessment has been made
        about any of them.
      </p>
    </section>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-3 p-5">
      <div className="h-10 animate-pulse rounded-lg bg-[#f3f5f5]" />
      <div className="h-10 animate-pulse rounded-lg bg-[#f3f5f5]" />
    </div>
  );
}

function EmptyDeductions({ isAnalyzing }: { isAnalyzing: boolean }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-[#edf4f1] text-[#235b4c]">
        <Receipt size={19} />
      </span>
      <h3 className="mt-4 text-sm font-semibold">
        {isAnalyzing ? "Analyzing statement…" : "No deductions yet"}
      </h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-[#89929b]">
        {isAnalyzing
          ? "The statement is being read. Extracted deductions appear here as soon as they are stored."
          : "Once a deposit statement arrives at this case's email address, the deductions it lists appear here."}
      </p>
    </div>
  );
}
