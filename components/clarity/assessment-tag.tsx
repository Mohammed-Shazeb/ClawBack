"use client";

import { cn } from "@/lib/utils";
import { assessmentLabel, type Assessment } from "./case-data";

const styles: Record<Assessment, string> = {
  disputable: "text-signal-open bg-signal-open-soft border-signal-open/20",
  valid: "text-signal-valid bg-signal-valid-soft border-border",
  unknown: "text-signal-unknown bg-signal-unknown-soft border-signal-unknown/20",
};

const dots: Record<Assessment, string> = {
  disputable: "bg-signal-open",
  valid: "bg-signal-valid/50",
  unknown: "bg-signal-unknown",
};

export function AssessmentTag({
  assessment,
  className,
}: {
  assessment: Assessment;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-[3px] text-[11px] font-medium tracking-tight",
        styles[assessment],
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", dots[assessment])} />
      {assessmentLabel[assessment]}
    </span>
  );
}
