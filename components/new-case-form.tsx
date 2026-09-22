"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "convex/react";
import { ArrowLeft, ArrowRight, Inbox, Loader2, ScanText, ShieldCheck } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { AppShell } from "./app-shell";
import { useCurrentUser } from "./current-user";
import { MicroLabel, Panel, PanelHead } from "./ui/primitives";

/**
 * How a case actually progresses. Every stage below is a real step in the
 * pipeline — nothing here describes work the product does not do.
 */
const STAGES = [
  {
    icon: Inbox,
    title: "Send the statement to your case address",
    body: "Clawback opens a private email address for the case. Forward the deposit statement there — nothing is uploaded to this app.",
  },
  {
    icon: ScanText,
    title: "Clawback reads the statement",
    body: "Each deduction is itemized, then checked against the housing guidance published for your jurisdiction.",
  },
  {
    icon: ShieldCheck,
    title: "You review and decide",
    body: "Clawback drafts a dispute letter from the evidence. Nothing is sent to the landlord until you approve it.",
  },
];

export function NewCaseForm() {
  const router = useRouter();
  const { userId, error: userError } = useCurrentUser();
  const createCase = useAction(api.cases.createWithInbox);

  const [jurisdiction, setJurisdiction] = useState("");
  const [deposit, setDeposit] = useState("");
  const [deductions, setDeductions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** Field-level messages, so a mistake is attached to the field it belongs to. */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const depositAmount = Number(deposit);
    const totalDeductions = Number(deductions);

    // Still a real guard even though the gate guarantees a user: this fires on a
    // *click*, and a submit can be dispatched in the window before the row lands.
    if (!userId) {
      setError(userError ?? "Your workspace is still loading. Try again in a moment.");
      return;
    }

    const problems: Record<string, string> = {};
    if (!jurisdiction.trim()) problems.jurisdiction = "Enter the state or jurisdiction for this case.";
    if (deposit.trim() === "" || !Number.isFinite(depositAmount) || depositAmount < 0) {
      problems.deposit = "Enter the security deposit as a number of 0 or more.";
    }
    if (deductions.trim() === "" || !Number.isFinite(totalDeductions) || totalDeductions < 0) {
      problems.deductions = "Enter the total withheld as a number of 0 or more.";
    }

    setFieldErrors(problems);
    if (Object.keys(problems).length > 0) {
      setError("Check the highlighted fields before creating the case.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await createCase({
        userId,
        jurisdiction: jurisdiction.trim(),
        depositAmount,
        totalDeductions,
      });

      // Land in the main UI, not the older `/cases` workspace. The renter is
      // about to be told to forward their statement to the case address, and
      // that address lives on the case screen.
      router.push("/case");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The case could not be created.");
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <Link
          href="/cases"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-secondary transition-colors hover:text-ink"
        >
          <ArrowLeft size={14} aria-hidden="true" /> All cases
        </Link>

        <header className="mt-7">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted">New case</p>
          <h1 className="mt-2 text-[1.75rem] font-semibold leading-tight tracking-[-0.03em] text-ink">
            Start a deposit dispute
          </h1>
          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-ink-secondary">
            Add the figures from your security-deposit statement. Clawback opens a private email
            address for the case so the statement can be read automatically.
          </p>
        </header>

        <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          {/* --- The figures --- */}
          <Panel as="section" aria-label="Case details">
            <PanelHead
              title="Case details"
              description="These are the figures the statement is checked against."
            />

            <form onSubmit={submit} className="px-5 py-5">
              <Field
                label="Jurisdiction"
                hint="The state or local jurisdiction that governs this tenancy."
                error={fieldErrors.jurisdiction}
              >
                <input
                  value={jurisdiction}
                  onChange={(event) => setJurisdiction(event.target.value)}
                  placeholder="e.g. California"
                  autoComplete="off"
                  aria-invalid={Boolean(fieldErrors.jurisdiction)}
                  className="h-10 w-full rounded-md border border-line bg-surface px-3.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-accent"
                />
              </Field>

              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <Field
                  label="Security deposit"
                  hint="The deposit originally held."
                  error={fieldErrors.deposit}
                >
                  <div className="relative">
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[13px] text-ink-muted"
                    >
                      $
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={deposit}
                      onChange={(event) => setDeposit(event.target.value)}
                      placeholder="0.00"
                      aria-invalid={Boolean(fieldErrors.deposit)}
                      className="tabular h-10 w-full rounded-md border border-line bg-surface pl-7 pr-3.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-accent"
                    />
                  </div>
                </Field>

                <Field
                  label="Total deductions"
                  hint="The amount withheld on the statement."
                  error={fieldErrors.deductions}
                >
                  <div className="relative">
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[13px] text-ink-muted"
                    >
                      $
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={deductions}
                      onChange={(event) => setDeductions(event.target.value)}
                      placeholder="0.00"
                      aria-invalid={Boolean(fieldErrors.deductions)}
                      className="tabular h-10 w-full rounded-md border border-line bg-surface pl-7 pr-3.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-accent"
                    />
                  </div>
                </Field>
              </div>

              {error ? (
                <p
                  role="alert"
                  className="mt-5 rounded-md border border-danger-line bg-danger-soft px-3.5 py-3 text-xs leading-5 text-danger"
                >
                  {error}
                </p>
              ) : null}

              <div className="mt-6 flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-end">
                <Link
                  href="/cases"
                  className="inline-flex h-9 items-center justify-center rounded-md px-3.5 text-[13px] font-medium text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink"
                >
                  Cancel
                </Link>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-accent px-4 text-[13px] font-semibold text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? (
                    <>
                      <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                      Creating the case…
                    </>
                  ) : (
                    <>
                      Create case
                      <ArrowRight size={14} aria-hidden="true" />
                    </>
                  )}
                </button>
              </div>
            </form>
          </Panel>

          {/* --- What actually happens next --- */}
          <Panel as="section" aria-label="What happens next">
            <PanelHead title="What happens next" description="Three steps, in this order." />
            <ol className="px-5 py-5">
              {STAGES.map(({ icon: Icon, title, body }, index) => (
                <li key={title} className="relative flex gap-3 pb-5 last:pb-0">
                  {index < STAGES.length - 1 ? (
                    <span aria-hidden="true" className="absolute left-[13px] top-7 h-full w-px bg-line" />
                  ) : null}
                  <span
                    aria-hidden="true"
                    className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-surface-muted text-ink-muted"
                  >
                    <Icon size={13} />
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <p className="text-[13px] font-medium leading-5 text-ink">
                      <span className="sr-only">Step {index + 1}. </span>
                      {title}
                    </p>
                    <p className="mt-1 text-[11px] leading-5 text-ink-secondary">{body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="border-t border-line px-5 py-4">
              <MicroLabel>What Clawback will not do</MicroLabel>
              <p className="mt-1.5 text-[11px] leading-5 text-ink-muted">
                It will not contact the landlord, state that a deduction was unlawful, or claim an
                amount has been recovered. The disputable amount is only calculated after the
                deductions have been assessed against retrieved official sources.
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
        {label}
      </span>
      <span className="mt-1 block text-[11px] leading-5 text-ink-secondary">{hint}</span>
      <span className="mt-2 block">{children}</span>
      {error ? (
        <span className="mt-1.5 block text-[11px] leading-5 text-danger">{error}</span>
      ) : null}
    </label>
  );
}
