"use client";

import { formatCurrency } from "@/lib/format";

export function CaseFinances({
  depositAmount,
  totalDeductions,
  potentiallyDisputableAmount,
}: {
  depositAmount: number;
  totalDeductions: number;
  potentiallyDisputableAmount: number;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <MoneyCard label="Security deposit" value={formatCurrency(depositAmount)} />
      <MoneyCard
        label="Total deductions"
        value={formatCurrency(totalDeductions)}
        note="Sum of the deductions extracted from the statement."
      />
      <MoneyCard
        label="Potentially disputable"
        value={formatCurrency(potentiallyDisputableAmount)}
        note="Legal analysis has not run yet, so nothing is claimed as recoverable."
      />
    </div>
  );
}

function MoneyCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-xl border border-[#e4e7eb] bg-white p-5">
      <p className="text-xs text-[#89929b]">{label}</p>
      <p className="mt-3 text-xl font-semibold tracking-[-0.03em]">{value}</p>
      {note ? <p className="mt-2 text-xs leading-5 text-[#a0a8ae]">{note}</p> : null}
    </div>
  );
}
