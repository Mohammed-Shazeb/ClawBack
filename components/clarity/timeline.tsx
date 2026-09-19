"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { AppShell } from "./app-shell";
import { useCaseData } from "./case-data-provider";
import { NoCase } from "./states";

export function Timeline() {
  const { caseMeta, timeline } = useCaseData();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const timers = timeline.map((_, i) =>
      window.setTimeout(() => setShown((s) => Math.max(s, i + 1)), 160 * i),
    );
    return () => timers.forEach(window.clearTimeout);
  }, [timeline]);

  if (!caseMeta) {
    return (
      <AppShell>
        <NoCase />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="border-b border-border pb-6">
        <p className="label-eyebrow">Case timeline</p>
        <h1 className="mt-2.5 text-[28px] font-semibold tracking-[-0.03em] text-foreground">
          {caseMeta.date}
        </h1>
        <p className="mt-2 text-[13px] text-muted-foreground">{caseMeta.jurisdiction}</p>
      </div>

      <ol className="mt-9 max-w-3xl">
        {timeline.map((event, i) => {
          const visible = i < shown;
          const last = i === timeline.length - 1;
          return (
            <li
              key={`${event.time}-${event.title}`}
              className={cn(
                "relative grid grid-cols-[56px_20px_minmax(0,1fr)] gap-x-4 pb-8 transition-all duration-500 ease-out",
                visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
              )}
            >
              <span className="numeral pt-[3px] text-[12.5px] text-muted-foreground">
                {event.time}
              </span>
              <span className="relative flex justify-center">
                {!last && <span className="absolute top-3 h-full w-px bg-border" />}
                <span
                  className={cn(
                    "relative z-10 mt-[6px] size-[9px] rounded-full border-2 bg-background",
                    last ? "border-foreground" : "border-accent",
                  )}
                />
              </span>
              <div>
                <p className="text-[14.5px] font-medium tracking-tight text-foreground">
                  {event.title}
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                  {event.detail}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="max-w-3xl rounded-xl border border-border bg-card px-5 py-4 shadow-flat">
        <p className="text-[13px] text-foreground">
          Next: your approval sends the letter to the landlord.
        </p>
      </div>
    </AppShell>
  );
}
