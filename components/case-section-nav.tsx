"use client";

import { useEffect, useState } from "react";

/**
 * The case's section nav.
 *
 * The reference design puts a tab bar under the case header. This is that bar,
 * but built as **anchor links over one page rather than tabs that swap panels**,
 * for a reason worth recording: the case page carries the money, the deductions,
 * the evidence, the letter, the correspondence, the timeline and the statement,
 * and several of them are read together — you check a citation in the evidence
 * while reading the letter that cites it. Hiding four of the five behind a click
 * would remove working functionality to make the chrome look tidier.
 *
 * So it jumps rather than swaps, and it highlights the section you are actually
 * looking at. Every panel stays rendered, which also keeps the offline UI suite
 * able to assert on the whole page at once.
 *
 * The active section is tracked with an IntersectionObserver rather than scroll
 * offsets, because the page's height changes as assessments land and a scroll
 * threshold would drift out of step with the content.
 */

const SECTIONS = [
  { id: "case-money", label: "Overview" },
  { id: "case-deductions", label: "Evidence" },
  { id: "case-letter", label: "Dispute letter" },
  { id: "case-communication", label: "Communication" },
  { id: "case-timeline", label: "Timeline" },
  { id: "case-statement", label: "Statement" },
] as const;

export function CaseSectionNav() {
  const [activeId, setActiveId] = useState<string>(SECTIONS[0].id);

  useEffect(() => {
    // Static rendering has no observer, and neither does a browser too old to
    // support one. The nav still works as plain links; it just stops tracking.
    if (typeof IntersectionObserver === "undefined") return;

    const elements = SECTIONS.map(({ id }) => document.getElementById(id)).filter(
      (element): element is HTMLElement => element !== null
    );
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // The topmost section currently intersecting wins, so scrolling up does
        // not leave the highlight stuck on the section below.
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible[0]) setActiveId(visible[0].target.id);
      },
      {
        // Discount the sticky chrome at the top, so a section counts as active
        // once its heading clears the header rather than when it first peeks in.
        rootMargin: "-96px 0px -55% 0px",
        threshold: 0,
      }
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  return (
    <nav
      aria-label="Case sections"
      className="sticky top-14 z-20 -mx-5 border-b border-line bg-page/95 px-5 backdrop-blur-sm sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10"
    >
      <ul className="flex gap-1 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {SECTIONS.map(({ id, label }) => {
          const active = id === activeId;
          return (
            <li key={id} className="shrink-0">
              <a
                href={`#${id}`}
                aria-current={active ? "true" : undefined}
                className={`inline-flex h-8 items-center rounded-md px-3 text-[12px] font-medium transition-colors ${
                  active
                    ? "bg-surface text-ink shadow-xs"
                    : "text-ink-secondary hover:bg-surface-muted hover:text-ink"
                }`}
              >
                {label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
