"use client";

import { Info } from "lucide-react";

import { CountUp, MicroLabel, Money } from "./ui/primitives";

/**
 * The case's money, in one block.
 *
 * The hierarchy is deliberate and matches how the product thinks: the amount
 * that may be recoverable is the headline, and the deposit and the landlord's
 * claim are the context it sits against.
 *
 * The bar at the foot decomposes the *whole deposit* into its three parts —
 * what is in dispute, what the evidence supports, and what was never deducted —
 * so the headline figure has somewhere to sit. It replaced a bar that showed the
 * disputable share alone, because that answered "how much of the claim" without
 * ever answering "how much of my deposit", which is the question a renter
 * actually arrives with.
 *
 * One naming decision worth keeping: the third part is **not withheld**, not
 * "returned to you". The app knows the deposit was not deducted; it has no way to
 * know whether that money has reached the renter. Calling it returned would
 * assert something the data cannot support, which is the same failure the
 * product already refuses everywhere else.
 *
 * Nothing here is ever presented as money already recovered.
 */
export function CaseFinances({
  depositAmount,
  totalDeductions,
  potentiallyDisputableAmount,
  likelyValidAmount,
  deductionCount,
  assessedCount,
  assessed,
}: {
  depositAmount: number;
  totalDeductions: number;
  potentiallyDisputableAmount: number;
  /** Sum of the deductions the evidence supported. Derived from stored rows. */
  likelyValidAmount: number;
  /** Every deduction on the statement. */
  deductionCount: number;
  /** How many of them have a completed assessment. */
  assessedCount: number;
  assessed: boolean;
}) {
  const share =
    totalDeductions > 0 ? Math.round((potentiallyDisputableAmount / totalDeductions) * 100) : 0;

  /*
   * Deposit minus what was deducted. Clamped at zero because a statement can
   * claim more than the deposit held, and a negative "not withheld" would be
   * nonsense rather than an error worth surfacing here.
   */
  const notWithheld = Math.max(0, depositAmount - totalDeductions);

  /*
   * Percentages for the stacked bar. Computed against the deposit, so the three
   * parts always add to the bar's full width — except when the deductions exceed
   * the deposit, in which case the parts are scaled down proportionally rather
   * than allowed to overflow.
   */
  const base = Math.max(depositAmount, totalDeductions) || 1;
  const pct = (value: number) => Math.max(0, (value / base) * 100);
  const disputablePct = pct(potentiallyDisputableAmount);
  const validPct = pct(likelyValidAmount);
  const notWithheldPct = pct(notWithheld);

  return (
    <section
      className="overflow-hidden rounded-lg border border-line bg-surface"
      aria-label="Case finances"
    >
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
        {/* Headline: the figure the whole product exists to establish. */}
        <div className="border-b border-line px-6 py-7 lg:border-b-0 lg:border-r">
          <MicroLabel>Potentially disputable</MicroLabel>

          <p className="mt-3 text-[3.25rem] font-semibold leading-none tracking-[-0.035em] text-ink sm:text-[3.75rem]">
            <CountUp value={potentiallyDisputableAmount} />
          </p>

          <p className="mt-4 max-w-md text-xs leading-5 text-ink-secondary">
            {assessed
              ? "The sum of the deductions the retrieved official sources indicate may be disputable. This is not a legal conclusion, and it is not money recovered."
              : "Assessment has not finished, so Clawback is not claiming any amount as disputable yet."}
          </p>
        </div>

        {/* Context: what the renter paid in, and what the landlord kept. */}
        <div className="grid grid-cols-2 divide-line max-lg:divide-x lg:grid-cols-2 lg:divide-x">
          <div className="border-b border-line px-6 py-6">
            <MicroLabel>Security deposit</MicroLabel>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-ink">
              <Money value={depositAmount} />
            </p>
            <p className="mt-2 text-[11px] leading-5 text-ink-muted">Held by the landlord.</p>
          </div>

          <div className="border-b border-line px-6 py-6">
            <MicroLabel>Total deductions</MicroLabel>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-ink">
              <Money value={totalDeductions} />
            </p>
            <p className="mt-2 text-[11px] leading-5 text-ink-muted">
              Sum of the deductions itemized on the statement.
            </p>
          </div>

          <div className="border-b border-line px-6 py-6 lg:border-b-0">
            <MicroLabel>Not withheld</MicroLabel>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-ink">
              <Money value={notWithheld} />
            </p>
            <p className="mt-2 text-[11px] leading-5 text-ink-muted">
              Deposit less the deductions. Clawback cannot tell whether this has been returned.
            </p>
          </div>

          <div className="px-6 py-6">
            <MicroLabel>Deductions reviewed</MicroLabel>
            <p className="tabular mt-2 text-2xl font-semibold tracking-[-0.02em] text-ink">
              {assessedCount}
              <span className="text-ink-muted"> / {deductionCount}</span>
            </p>
            <p className="mt-2 text-[11px] leading-5 text-ink-muted">
              {assessedCount === deductionCount && deductionCount > 0
                ? "Every deduction has an assessment."
                : "Assessments still running."}
            </p>
          </div>
        </div>
      </div>

      {/* --- Where the deposit went, as one bar --- */}
      {assessed && totalDeductions > 0 ? (
        <div className="border-t border-line px-6 py-5">
          <div
            className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken"
            role="img"
            aria-label={
              `Of a ${depositAmount} deposit: ${potentiallyDisputableAmount} potentially disputable, ` +
              `${likelyValidAmount} likely valid, ${notWithheld} not withheld.`
            }
          >
            <div
              className="h-full bg-attention transition-[width] duration-700 ease-out"
              style={{ width: `${disputablePct}%` }}
            />
            <div
              className="h-full bg-line-strong transition-[width] duration-700 ease-out"
              style={{ width: `${validPct}%` }}
            />
            <div
              className="h-full bg-accent transition-[width] duration-700 ease-out"
              style={{ width: `${notWithheldPct}%` }}
            />
          </div>

          <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[11px] leading-5">
            <li className="flex items-center gap-2">
              <span className="size-2 shrink-0 rounded-full bg-attention" aria-hidden="true" />
              <span className="tabular font-medium text-ink">
                <Money value={potentiallyDisputableAmount} />
              </span>
              <span className="text-ink-muted">
                potentially disputable · {share}% of the deductions claimed
              </span>
            </li>
            <li className="flex items-center gap-2">
              <span className="size-2 shrink-0 rounded-full bg-line-strong" aria-hidden="true" />
              <span className="tabular font-medium text-ink">
                <Money value={likelyValidAmount} />
              </span>
              <span className="text-ink-muted">likely valid</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="size-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
              <span className="tabular font-medium text-ink">
                <Money value={notWithheld} />
              </span>
              <span className="text-ink-muted">not withheld</span>
            </li>
          </ul>
        </div>
      ) : null}

      <p className="flex items-start gap-2 border-t border-line bg-surface-muted px-6 py-3 text-[11px] leading-5 text-ink-muted">
        <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          Figures are computed on the server from the stored deduction records. Clawback never
          states that an amount has been recovered.
        </span>
      </p>
    </section>
  );
}
