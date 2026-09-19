"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { AppShell } from "./app-shell";
import { useCaseData } from "./case-data-provider";
import { NoCase } from "./states";

const humanize = (value: string) =>
  value
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word, i) => (i === 0 ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(" ");

export function Intelligence() {
  const { caseMeta, caseStatus, activitySteps, counts } = useCaseData();
  const [revealed, setRevealed] = useState(0);

  useEffect(() => {
    const timers = activitySteps.map((_, i) =>
      window.setTimeout(() => setRevealed((r) => Math.max(r, i + 1)), 140 * i),
    );
    return () => timers.forEach(window.clearTimeout);
  }, [activitySteps]);

  if (!caseMeta) {
    return (
      <AppShell>
        <NoCase />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section>
          <p className="label-eyebrow">Clawback intelligence</p>
          <h1 className="mt-3 max-w-lg text-[30px] font-semibold leading-tight tracking-[-0.03em] text-foreground">
            Everything performed on Case #{caseMeta.id}, in order.
          </h1>
          <p className="mt-3 max-w-lg text-[13.5px] leading-relaxed text-muted-foreground">
            Only actions and outcomes are recorded here. Each completed step names the
            document or source it produced, so the case can be checked line by line.
          </p>

          <ol className="mt-10">
            {activitySteps.map((step, i) => {
              const shown = i < revealed;
              return (
                <li
                  key={step.label}
                  className={cn(
                    "relative grid grid-cols-[24px_minmax(0,1fr)] gap-4 pb-7 transition-all duration-500",
                    shown ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-0",
                  )}
                >
                  {i < activitySteps.length - 1 && (
                    <span className="absolute left-[11px] top-6 h-full w-px bg-border" />
                  )}
                  <span
                    className={cn(
                      "relative z-10 flex size-[23px] items-center justify-center rounded-full border bg-card",
                      step.state === "done" && "border-accent/30 text-accent",
                      step.state === "active" && "border-foreground text-foreground",
                      step.state === "pending" && "border-border text-muted-foreground",
                    )}
                  >
                    {step.state === "done" && <Check className="size-3" strokeWidth={2.5} />}
                    {step.state === "active" && (
                      <span className="pulse-dot size-1.5 rounded-full bg-foreground" />
                    )}
                  </span>
                  <div className="pt-0.5">
                    <p
                      className={cn(
                        "text-[14px] tracking-tight",
                        step.state === "pending"
                          ? "text-muted-foreground"
                          : "font-medium text-foreground",
                      )}
                    >
                      {step.label}
                    </p>
                    <p className="mt-1 text-[12.5px] text-muted-foreground">{step.detail}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-xl border border-border bg-card p-5 shadow-flat">
            <p className="label-eyebrow">Current status</p>
            <p className="mt-3 text-[15px] font-medium tracking-tight text-foreground">
              {caseStatus ? humanize(caseStatus) : "No case activity yet"}
            </p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
              {counts.deductions} deduction{counts.deductions === 1 ? "" : "s"} recorded ·{" "}
              {counts.sources} source{counts.sources === 1 ? "" : "s"} retrieved
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border">
            {[
              ["Deductions reviewed", String(counts.deductions)],
              ["Sources cited", String(counts.sources)],
              ["Documents read", String(counts.documents)],
              ["Open questions", String(counts.openQuestions)],
            ].map(([k, v]) => (
              <div key={k} className="bg-card px-4 py-3.5">
                <dt className="text-[11.5px] text-muted-foreground">{k}</dt>
                <dd className="numeral mt-1 text-[18px] font-medium text-foreground">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="rounded-xl border border-border bg-surface-sunken px-4 py-3.5">
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              Every step above is recorded with a timestamp and the exact file or citation it
              used. Nothing is added to your case without a source.
            </p>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
