"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation } from "convex/react";
import { Check, PenLine, RefreshCw } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { AppShell } from "./app-shell";
import { currency } from "./case-data";
import { useCaseData } from "./case-data-provider";
import { NoCase } from "./states";

/**
 * The letter is the stored document, not a reconstruction.
 *
 * The prototype carried hardcoded paragraphs, addresses and a signature; none of
 * that is real data, so none of it is kept. What renders is the letter the
 * pipeline actually produced, and approval calls the real mutation — the status
 * shown is read back from the database rather than from a local flag.
 */
export function Letter() {
  const { caseMeta, caseId, deductions, sources, letter } = useCaseData();
  const [focus, setFocus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const approve = useMutation(api.letters.approveLetter);

  if (!caseMeta) {
    return (
      <AppShell>
        <NoCase />
      </AppShell>
    );
  }

  const disputed = deductions.filter((d) => d.disputable > 0);
  const approved = letter?.status === "APPROVED";

  const onApprove = async () => {
    if (!caseId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await approve({ caseId });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not approve the letter.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <p className="label-eyebrow">Dispute letter</p>
          <h1 className="mt-2.5 flex items-center gap-3 text-[28px] font-semibold tracking-[-0.03em] text-foreground">
            {!letter ? "Not drafted yet" : approved ? "Approved" : "Ready for review"}
            <span
              className={cn(
                "size-2 rounded-full",
                !letter
                  ? "bg-border-strong"
                  : approved
                    ? "bg-accent"
                    : "pulse-dot bg-signal-unknown",
              )}
            />
          </h1>
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            Case #{caseMeta.id} · {currency(caseMeta.disputable)} in question ·{" "}
            {sources.length} cited source{sources.length === 1 ? "" : "s"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/cases/${caseId}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-[12.5px] text-foreground transition-colors hover:border-border-strong"
          >
            <PenLine className="size-3.5" />
            Edit
          </Link>
          <Link
            href={`/cases/${caseId}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-[12.5px] text-foreground transition-colors hover:border-border-strong"
          >
            <RefreshCw className="size-3.5" />
            Regenerate
          </Link>
          <button
            onClick={onApprove}
            disabled={!letter || approved || busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[12.5px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Check className="size-3.5" />
            {approved ? "Approved" : busy ? "Approving…" : "Approve & continue"}
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <article className="rise-in mx-auto w-full max-w-[720px] rounded-xl border border-border bg-paper px-8 py-10 shadow-paper sm:px-14 sm:py-16">
          {!letter ? (
            <p className="text-[13.5px] leading-relaxed text-muted-foreground">
              No dispute letter has been drafted for this case yet. It becomes available
              once the deductions have been assessed.
            </p>
          ) : (
            <>
              <header className="border-b border-border pb-6">
                <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                  To: {letter.recipient}
                </p>
                <p className="numeral mt-5 text-[12.5px] text-muted-foreground">
                  {caseMeta.date}
                </p>
                <p className="mt-5 text-[12.5px] leading-relaxed text-muted-foreground">
                  Re: {letter.subject}
                </p>
              </header>

              <div className="pt-7 text-[14px] leading-[1.85] text-foreground">
                {letter.paragraphs.map((paragraph, index) => (
                  <p key={index} className="mt-5 first:mt-0">
                    {paragraph}
                  </p>
                ))}
              </div>
            </>
          )}
        </article>

        <aside className="space-y-3 lg:sticky lg:top-28 lg:self-start">
          <p className="label-eyebrow">Supporting evidence</p>
          {disputed.map((d) => {
            const linked = sources.filter((s) => d.sourceIds.includes(s.id));
            return (
              <button
                key={d.id}
                onMouseEnter={() => setFocus(d.id)}
                onMouseLeave={() => setFocus(null)}
                onClick={() => setFocus(focus === d.id ? null : d.id)}
                className={cn(
                  "block w-full rounded-xl border bg-card px-4 py-3.5 text-left transition-all",
                  focus === d.id
                    ? "border-accent/35 shadow-raised"
                    : "border-border hover:border-border-strong",
                )}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[12.5px] font-medium text-foreground">{d.label}</span>
                  <span className="numeral text-[13px] text-foreground">
                    {currency(d.amount)}
                  </span>
                </div>
                <div className="mt-2.5 space-y-1.5">
                  {linked.map((s) => (
                    <p
                      key={s.id}
                      className="flex items-start gap-2 text-[11.5px] leading-snug text-muted-foreground"
                    >
                      <span className="numeral text-accent">→ {s.ref}</span>
                      {s.title}
                    </p>
                  ))}
                </div>
              </button>
            );
          })}

          <div className="rounded-xl border border-border bg-surface-sunken px-4 py-3.5">
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              This letter is a self-advocacy document prepared from public housing rules and
              your records. Clawback is not a law firm.
            </p>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
