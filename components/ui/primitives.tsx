"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { formatCurrency } from "@/lib/format";

/**
 * Shared surfaces and type primitives.
 *
 * Every visual decision that repeats across screens lives here so the palette
 * and rhythm stay consistent. Components should compose these rather than
 * reaching for raw colour values.
 */

export function Panel({
  children,
  className = "",
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article" | "aside";
}) {
  return (
    <Tag className={`rounded-lg border border-line bg-surface ${className}`}>{children}</Tag>
  );
}

export function PanelHead({
  title,
  description,
  aside,
  icon,
  className = "",
}: {
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  /** An optional leading glyph. Used sparingly — most panels need no icon. */
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5 ${className}`}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        {icon ? (
          <span className="mt-px shrink-0 text-ink-muted" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs leading-5 text-ink-secondary">{description}</p>
          ) : null}
        </div>
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  );
}

/** The small uppercase label that introduces a block of detail. */
export function MicroLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={`text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted ${className}`}
    >
      {children}
    </p>
  );
}

const TONES = {
  neutral: "bg-surface-muted text-ink-secondary",
  accent: "bg-accent-soft text-accent",
  attention: "bg-attention-soft text-attention",
  danger: "bg-danger-soft text-danger",
} as const;

export type Tone = keyof typeof TONES;

export function Badge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** The assessment verdict for one deduction, phrased as a finding, not a verdict. */
export function AssessmentBadge({
  assessment,
  status,
}: {
  assessment?: string;
  status?: string;
}) {
  if (status !== "COMPLETED" || !assessment) return null;

  if (assessment === "POTENTIALLY_DISPUTABLE") {
    return <Badge tone="attention">Potentially disputable</Badge>;
  }
  if (assessment === "LIKELY_VALID") {
    return <Badge tone="accent">Likely valid</Badge>;
  }
  return <Badge tone="neutral">Needs more information</Badge>;
}

/** Currency in tabular figures so columns of money line up. */
export function Money({ value, className = "" }: { value: number; className?: string }) {
  return <span className={`tabular ${className}`}>{formatCurrency(value)}</span>;
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const query = window.matchMedia?.(REDUCED_MOTION_QUERY);
  if (!query) return () => {};

  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false;
}

/** True when the reader has asked their system to reduce motion. */
function useReducedMotion(): boolean {
  // A media query is an external store, so this subscribes rather than
  // mirroring it into state from an effect.
  return useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => false);
}

/**
 * Counts a financial figure to its value when it materially changes.
 *
 * The initial render is always the true value, never zero. Two reasons: the
 * server-rendered HTML must carry the real figure (so it is correct before
 * hydration, with JavaScript disabled, and to anything reading the markup), and
 * a figure that flashes $0.00 before settling would misstate the one number
 * this product exists to establish. The animation is reserved for a genuine
 * change — the figure moving as deductions are assessed — which is exactly the
 * moment it became meaningful.
 *
 * Deliberately short and eased-out, so it draws the eye rather than performing.
 * Under reduced motion it snaps straight to the new value.
 */
export function CountUp({
  value,
  durationMs = 620,
  className = "",
}: {
  value: number;
  durationMs?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;

    if (reduced || from === value) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }

    const start = performance.now();
    const delta = value - from;

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutCubic: quick to commit, gentle to settle.
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + delta * eased);

      if (t < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = value;
        setDisplay(value);
      }
    };

    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      // Whatever was on screen becomes the next animation's starting point, so
      // an interrupted count resumes rather than jumping back.
      fromRef.current = value;
    };
  }, [value, durationMs, reduced]);

  return <span className={`tabular ${className}`}>{formatCurrency(display)}</span>;
}

/** A labelled figure. `emphasis` promotes it in the money hierarchy. */
export function Stat({
  label,
  value,
  note,
  emphasis = false,
  animate = false,
}: {
  label: string;
  value: number;
  note?: ReactNode;
  emphasis?: boolean;
  animate?: boolean;
}) {
  return (
    <div className="min-w-0">
      <MicroLabel>{label}</MicroLabel>
      <p
        className={`mt-1.5 tabular tracking-[-0.02em] ${
          emphasis
            ? "text-[2.5rem] font-semibold leading-none text-ink sm:text-[3rem]"
            : "text-xl font-semibold leading-tight text-ink"
        }`}
      >
        {animate ? <CountUp value={value} /> : formatCurrency(value)}
      </p>
      {note ? (
        <p className={`mt-2 leading-5 ${emphasis ? "text-xs text-ink-secondary" : "text-[11px] text-ink-muted"}`}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

/** A thin horizontal rule used to separate detail blocks inside a panel. */
export function Divider({ className = "" }: { className?: string }) {
  return <div className={`border-t border-line ${className}`} />;
}
