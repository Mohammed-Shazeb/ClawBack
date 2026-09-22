"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { LogOut, Plus } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/components/current-user";
import { Logo } from "@/components/logo";
import { useCaseData } from "./case-data-provider";

const nav = [
  { href: "/case", label: "Case overview" },
  { href: "/intelligence", label: "Intelligence" },
  { href: "/evidence", label: "Evidence" },
  { href: "/letter", label: "Dispute letter" },
  { href: "/timeline", label: "Timeline" },
] as const;

/**
 * The frame every case screen sits in.
 *
 * Two things the ported design had no room for, added at the right of the bar:
 * a way to start another case, and a way out of the account.
 *
 * Both were genuinely missing. Case creation lived only inside the `/cases`
 * workspace and the empty state, so a renter who already had one case had no
 * route to a second; and there was no sign-out anywhere in this UI at all.
 *
 * The account cluster renders nothing when signed out rather than inventing a
 * placeholder. These screens sit behind `RequireAuth`, so a signed-out render
 * is not a state a visitor should ever see — and if one does slip through, the
 * navigation links already send them to sign-up.
 */
export function AppShell({ children }: { children: ReactNode }) {
  // TanStack's `activeProps` has no Next.js equivalent, so the active state is
  // derived from the pathname. The underline span and its styling are unchanged.
  const pathname = usePathname();
  const { caseMeta } = useCaseData();
  const { isSignedIn, email } = useCurrentUser();
  const { signOut } = useAuthActions();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3.5 lg:px-8">
          <Link
            href={isSignedIn ? "/cases" : "/"}
            aria-label={isSignedIn ? "Your cases" : "Clawback home"}
          >
            <Logo size="sm" />
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

          {isSignedIn ? (
            <div className="ml-auto flex shrink-0 items-center gap-1 md:ml-0">
              <Link
                href="/cases/new"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-secondary"
              >
                <Plus size={13} aria-hidden="true" />
                New case
              </Link>
              <button
                type="button"
                onClick={() => void signOut()}
                title={email ? `Signed in as ${email}` : undefined}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <LogOut size={13} aria-hidden="true" />
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-[1240px] px-5 pb-24 pt-8 lg:px-8">{children}</main>
    </div>
  );
}
