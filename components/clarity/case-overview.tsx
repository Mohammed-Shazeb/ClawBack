"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpRight, FileText } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { AppShell } from "./app-shell";
import { AssessmentTag } from "./assessment-tag";
import { CountUp } from "./count-up";
import { currency } from "./case-data";
import { useCaseData } from "./case-data-provider";
import { NoCase } from "./states";

export function CaseOverview() {
  const { caseMeta, deductions, sources, letter } = useCaseData();
  const [active, setActive] = useState<string | null>(null);

  if (!caseMeta) {
    return (
      <AppShell>
        <NoCase />
      </AppShell>
    );
  }

  const activeDeduction = deductions.find((d) => d.id === active);
  const highlighted = new Set(activeDeduction?.sourceIds ?? []);

  // Real counts, replacing the prototype's "3 of 4" and fixed source total.
  const inQuestion = deductions.filter((d) => d.disputable > 0).length;
  const validShare = Math.max(0, caseMeta.deductions - caseMeta.disputable);

  return (
    <AppShell>
      <section className="border-b border-border pb-10">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="label-eyebrow">Potentially disputable</p>
            <p className="mt-3 text-[76px] font-semibold leading-[0.92] tracking-[-0.045em] text-foreground sm:text-[104px]">
              <CountUp value={caseMeta.disputable} duration={1100} />
            </p>
            <p className="mt-4 max-w-md text-[13.5px] leading-relaxed text-muted-foreground">
              Across {inQuestion} of {deductions.length} deductions on the
              landlord&apos;s statement. Each assessment below is tied to a{" "}
              {caseMeta.jurisdiction} source you can open and read.
            </p>
          </div>

          <dl className="grid w-full max-w-sm grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:w-auto">
            <Stat label="Security deposit" value={caseMeta.deposit} delay={80} />
            <Stat label="Total deductions" value={caseMeta.deductions} delay={160} />
            <Stat label="Not withheld" value={caseMeta.notWithheld} delay={240} />
            <Stat label="Deductions reviewed" value={deductions.length} prefix="" delay={320} />
          </dl>
        </div>

        <div className="mt-9">
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-accent transition-[width] duration-1000 ease-out"
              style={{ width: `${(caseMeta.disputable / caseMeta.deposit) * 100}%` }}
            />
            <div
              className="h-full bg-border-strong transition-[width] duration-1000 ease-out"
              style={{ width: `${((caseMeta.deductions - caseMeta.disputable) / caseMeta.deposit) * 100}%` }}
            />
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1 text-[11.5px] text-muted-foreground">
            <Legend color="bg-accent" label={`${currency(caseMeta.disputable)} potentially disputable`} />
            <Legend color="bg-border-strong" label={`${currency(validShare)} likely valid deductions`} />
            <Legend color="bg-secondary" label={`${currency(caseMeta.notWithheld)} not withheld`} />
          </div>
        </div>
      </section>

      <section className="grid gap-10 pt-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          <div className="flex items-baseline justify-between">
            <h2 className="label-eyebrow">Deductions</h2>
            <span className="text-[11.5px] text-muted-foreground">
              Hover a line to see its sources
            </span>
          </div>

          <ul className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-flat">
            {deductions.map((d, i) => (
              <li
                key={d.id}
                onMouseEnter={() => setActive(d.id)}
                onMouseLeave={() => setActive(null)}
                className={cn(
                  "group relative rise-in px-5 py-5 transition-colors",
                  active === d.id ? "bg-surface-sunken" : "bg-card",
                )}
                style={{ animationDelay: `${i * 70}ms` }}
              >
                <span
                  className={cn(
                    "absolute inset-y-0 left-0 w-[2px] bg-foreground transition-opacity",
                    active === d.id ? "opacity-100" : "opacity-0",
                  )}
                />
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="text-[15px] font-medium tracking-tight text-foreground">
                        {d.label}
                      </h3>
                      <AssessmentTag assessment={d.assessment} />
                    </div>
                    <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
                      {d.summary}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-4 text-[12px] text-muted-foreground">
                      <span className="numeral">
                        {d.sourceIds.length} supporting{" "}
                        {d.sourceIds.length === 1 ? "source" : "sources"}
                      </span>
                      <Link
                        href={`/evidence?d=${d.id}`}
                        className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
                      >
                        View evidence
                        <ArrowRight className="size-3.5" />
                      </Link>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="numeral text-[22px] font-semibold tracking-tight text-foreground">
                      {currency(d.amount)}
                    </p>
                    {d.disputable > 0 && (
                      <p className="numeral mt-1 text-[11.5px] text-accent">
                        {currency(d.disputable)} in question
                      </p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card px-5 py-4 shadow-flat">
            <div className="flex items-center gap-3">
              <FileText className="size-4 text-muted-foreground" />
              <div>
                <p className="text-[13.5px] font-medium text-foreground">
                  {letter ? "Dispute letter ready for review" : "No dispute letter yet"}
                </p>
                <p className="text-[12px] text-muted-foreground">
                  {letter
                    ? `Drafted with ${sources.length} cited source${
                        sources.length === 1 ? "" : "s"
                      } · ${
                        letter.status === "APPROVED"
                          ? "approved"
                          : "awaiting your approval"
                      }`
                    : "Available once the deductions have been assessed"}
                </p>
              </div>
            </div>
            <Link
              href="/letter"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[12.5px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Open letter
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <h2 className="label-eyebrow">Sources on file</h2>
          <ul className="mt-4 space-y-px overflow-hidden rounded-xl border border-border bg-card">
            {sources.map((s) => {
              const dim = highlighted.size > 0 && !highlighted.has(s.id);
              return (
                <li
                  key={s.id}
                  className={cn(
                    "border-b border-border px-4 py-3.5 transition-all last:border-b-0",
                    dim ? "opacity-35" : "opacity-100",
                    highlighted.has(s.id) && "bg-accent-soft",
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <span className="numeral mt-0.5 text-[11px] text-muted-foreground">
                      {s.ref}
                    </span>
                    <div>
                      <p className="text-[12.5px] font-medium leading-snug text-foreground">
                        {s.title}
                      </p>
                      <p className="mt-1 flex items-center gap-1 text-[11.5px] text-muted-foreground">
                        {s.url}
                        <ArrowUpRight className="size-3" />
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 rounded-xl border border-border bg-surface-sunken px-4 py-3.5">
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              Clawback summarizes public housing rules and your documents. It is not a law
              firm and does not provide legal advice.
            </p>
          </div>
        </aside>
      </section>
    </AppShell>
  );
}

function Stat({
  label,
  value,
  delay,
  prefix = "$",
}: {
  label: string;
  value: number;
  delay: number;
  prefix?: string;
}) {
  return (
    <div className="bg-card px-4 py-3.5">
      <dt className="text-[11.5px] text-muted-foreground">{label}</dt>
      <dd className="numeral mt-1 text-[19px] font-medium tracking-tight text-foreground">
        <CountUp value={value} delay={delay} prefix={prefix} />
      </dd>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className={cn("size-2 rounded-[2px]", color)} />
      {label}
    </span>
  );
}
