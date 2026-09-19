"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUpRight, Quote } from "lucide-react";

import { cn } from "@/lib/utils";
import { AppShell } from "./app-shell";
import { AssessmentTag } from "./assessment-tag";
import { currency } from "./case-data";
import { useCaseData } from "./case-data-provider";
import { NoCase } from "./states";

/**
 * Fields the backend does not store (`tenantEvidence`, `rule`, `whyItMatters`)
 * are shown as "Not recorded" rather than filled with plausible prose. The
 * "Why it matters" block is omitted entirely when there is nothing to say,
 * instead of presenting an empty panel as if it were a finding.
 */
const NOT_RECORDED = "Not recorded";

export function Evidence() {
  const { deductions, sources } = useCaseData();
  const params = useSearchParams();
  const requested = params.get("d") ?? undefined;

  const [selectedId, setSelectedId] = useState(requested ?? deductions[0]?.id ?? "");
  const [openSource, setOpenSource] = useState<string | null>(null);

  if (deductions.length === 0) {
    return (
      <AppShell>
        <NoCase />
      </AppShell>
    );
  }

  const selected = deductions.find((x) => x.id === selectedId) ?? deductions[0]!;
  const linked = sources.filter((s) => selected.sourceIds.includes(s.id));

  const chain = [
    { label: "Landlord claim", body: `${selected.label} — ${currency(selected.amount)}` },
    { label: "Tenant evidence", body: selected.tenantEvidence ?? NOT_RECORDED },
    { label: "Applicable rule", body: selected.rule ?? NOT_RECORDED },
    {
      label: "Official source",
      body: linked.map((s) => s.title).join(" · ") || NOT_RECORDED,
    },
    { label: "Clawback finding", body: selected.summary || "Not yet assessed" },
    {
      label: "Recommended action",
      body:
        selected.assessment === "valid"
          ? "Accept this line. Disputing it would weaken the stronger claims."
          : selected.assessment === "unknown"
            ? "Request the itemized documentation in writing before accepting the charge."
            : "Dispute the full amount and ask for a prorated calculation instead.",
    },
  ];

  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <p className="label-eyebrow">Evidence investigation</p>
          <h1 className="mt-2.5 text-[28px] font-semibold tracking-[-0.03em] text-foreground">
            How each deduction connects to the rules
          </h1>
        </div>
        <p className="max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">
          Select a deduction to follow the chain from the landlord&apos;s claim through to the
          action we recommend. Click a source to read the passage it rests on.
        </p>
      </div>

      <div className="mt-7 flex flex-wrap gap-2">
        {deductions.map((item) => (
          <button
            key={item.id}
            onClick={() => {
              setSelectedId(item.id);
              setOpenSource(null);
            }}
            className={cn(
              "rounded-lg border px-3.5 py-2 text-left text-[12.5px] transition-colors",
              selectedId === item.id
                ? "border-foreground bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:border-border-strong hover:text-foreground",
            )}
          >
            <span className="font-medium">{item.label}</span>
            <span className="numeral ml-2 opacity-70">{currency(item.amount)}</span>
          </button>
        ))}
      </div>

      <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section key={selected.id} className="rise-in">
          <div className="rounded-xl border border-border bg-card shadow-flat">
            {chain.map((node, i) => (
              <div key={node.label} className="relative px-5 py-5">
                <div className="grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-6">
                  <p className="label-eyebrow pt-0.5">{node.label}</p>
                  <div>
                    <p
                      className={cn(
                        "text-[13.5px] leading-relaxed text-foreground",
                        i === 0 && "text-[17px] font-medium tracking-tight",
                      )}
                    >
                      {node.body}
                    </p>
                    {node.label === "Clawback finding" && (
                      <div className="mt-3">
                        <AssessmentTag assessment={selected.assessment} />
                      </div>
                    )}
                    {node.label === "Official source" && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {linked.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => setOpenSource(openSource === s.id ? null : s.id)}
                            className={cn(
                              "numeral rounded-md border px-2 py-1 text-[11px] transition-colors",
                              openSource === s.id
                                ? "border-accent/30 bg-accent-soft text-accent"
                                : "border-border text-muted-foreground hover:text-foreground",
                            )}
                          >
                            Source {s.ref}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {i < chain.length - 1 && (
                  <>
                    <div className="mt-5 h-px w-full bg-border" />
                    <ArrowDown className="absolute -bottom-[7px] left-5 size-3.5 bg-card text-border-strong sm:left-[86px]" />
                  </>
                )}
              </div>
            ))}
          </div>

          {selected.whyItMatters ? (
            <div className="mt-5 rounded-xl border border-border bg-surface-sunken p-5">
              <p className="label-eyebrow">Why it matters</p>
              <p className="mt-2.5 max-w-2xl text-[13.5px] leading-relaxed text-foreground">
                {selected.whyItMatters}
              </p>
            </div>
          ) : null}
        </section>

        <aside className="space-y-3 lg:sticky lg:top-28 lg:self-start">
          <p className="label-eyebrow">Supporting sources</p>
          {sources.map((s) => {
            const isLinked = selected.sourceIds.includes(s.id);
            const isOpen = openSource === s.id;
            return (
              <div
                key={s.id}
                className={cn(
                  "overflow-hidden rounded-xl border bg-card transition-all",
                  isLinked ? "border-border" : "border-border/60 opacity-45",
                  isOpen && "border-accent/35 shadow-raised",
                )}
              >
                <button
                  onClick={() => setOpenSource(isOpen ? null : s.id)}
                  className="flex w-full items-start gap-2.5 px-4 py-3.5 text-left"
                >
                  <span className="numeral mt-0.5 text-[11px] text-muted-foreground">
                    {s.ref}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-medium leading-snug text-foreground">
                      {s.title}
                    </span>
                    <span className="mt-1 block text-[11.5px] text-muted-foreground">
                      {s.citation}
                    </span>
                  </span>
                </button>
                <div
                  className={cn(
                    "grid transition-all duration-300 ease-out",
                    isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                  )}
                >
                  <div className="overflow-hidden">
                    <div className="border-t border-border bg-surface-sunken px-4 py-3.5">
                      <Quote className="size-3 text-muted-foreground" />
                      <p className="mt-2 text-[12.5px] leading-relaxed text-foreground">
                        {s.passage || "No passage was retrieved for this source."}
                      </p>
                      <p className="mt-3 inline-flex items-center gap-1 text-[11.5px] text-muted-foreground">
                        {s.url}
                        <ArrowUpRight className="size-3" />
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </aside>
      </div>
    </AppShell>
  );
}
