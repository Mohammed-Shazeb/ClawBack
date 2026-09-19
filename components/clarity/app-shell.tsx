"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { useCaseData } from "./case-data-provider";

const nav = [
  { href: "/case", label: "Case overview" },
  { href: "/intelligence", label: "Intelligence" },
  { href: "/evidence", label: "Evidence" },
  { href: "/letter", label: "Dispute letter" },
  { href: "/timeline", label: "Timeline" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  // TanStack's `activeProps` has no Next.js equivalent, so the active state is
  // derived from the pathname. The underline span and its styling are unchanged.
  const pathname = usePathname();
  const { caseMeta } = useCaseData();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3.5 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex size-6 items-center justify-center rounded-[6px] bg-primary">
              <span className="block h-2 w-2 rounded-[2px] bg-accent" />
            </span>
            <span className="text-[13px] font-semibold tracking-[0.16em] text-foreground">
              CLAWBACK
            </span>
          </Link>

          {caseMeta ? (
            <>
              <div className="hidden h-4 w-px bg-border md:block" />

              <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
                <span className="numeral text-foreground">Case #{caseMeta.id}</span>
                <span className="text-border-strong">/</span>
                <span>{caseMeta.jurisdiction}</span>
                <span className="text-border-strong">/</span>
                <span>{caseMeta.date}</span>
              </div>
            </>
          ) : null}

          <nav className="-mb-3.5 order-last flex w-full items-center gap-1 overflow-x-auto md:order-none md:mb-0 md:ml-auto md:w-auto">
            {nav.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "relative shrink-0 rounded-md px-2.5 py-2 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground md:py-1.5",
                    isActive && "font-medium text-foreground",
                  )}
                >
                  {item.label}
                  <span
                    className={cn(
                      "absolute inset-x-2 -bottom-[14px] h-px bg-foreground transition-opacity md:-bottom-[13px]",
                      isActive ? "opacity-100" : "opacity-0",
                    )}
                  />
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1240px] px-5 pb-24 pt-8 lg:px-8">{children}</main>
    </div>
  );
}
