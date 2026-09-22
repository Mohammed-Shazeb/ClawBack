"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { BriefcaseBusiness, LogOut, Plus } from "lucide-react";
import type { ReactNode } from "react";

import { Logo } from "./logo";
import { useCurrentUser } from "./current-user";

/*
 * Only routes that exist. The product is case-centric — evidence, the timeline
 * and the dispute letter all live inside a case — so there is no separate
 * top-level Evidence or Settings destination to link to.
 *
 * "Dashboard" used to point at `/`, which is now the marketing landing page, so
 * clicking it threw a signed-in renter out of the app and onto the hero. `/`
 * stopped being a dashboard when the landing page took that route over and the
 * link was never updated. Both entries now stay inside the workspace.
 */
const navigation = [
  { href: "/cases", label: "Your cases", icon: BriefcaseBusiness },
  { href: "/cases/new", label: "New case", icon: Plus },
];

/**
 * The frame every screen sits in.
 *
 * Deliberately quiet: a warm neutral page, one white surface per region and a
 * single restrained accent. The navigation is furniture — the case itself is
 * what should carry the weight.
 *
 * The account block names the signed-in address rather than a placeholder. It
 * used to read "Demo workspace — cases here are shared by everyone using this
 * deployment", which was true when every visitor resolved to one shared row and
 * is a false claim now that cases belong to an account.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { email, isSignedIn } = useCurrentUser();
  const { signOut } = useAuthActions();

  return (
    <div className="min-h-screen bg-page text-ink">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-line bg-surface px-4 py-6 lg:flex">
        <Link
          href={isSignedIn ? "/cases" : "/"}
          className="px-2"
          aria-label={isSignedIn ? "Your cases" : "Clawback home"}
        >
          <Logo />
        </Link>

        <nav className="mt-9 space-y-0.5" aria-label="Workspace">
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
            Workspace
          </p>
          {navigation.map(({ href, label, icon: Icon }) => {
            // `/cases/new` must not also light up "Your cases", so the case list
            // matches its own path plus a case deep-link — but not the form.
            const active =
              href === "/cases"
                ? pathname === "/cases" ||
                  (pathname.startsWith("/cases/") && pathname !== "/cases/new")
                : pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors ${
                  active
                    ? "bg-accent-soft text-accent"
                    : "text-ink-secondary hover:bg-surface-muted hover:text-ink"
                }`}
              >
                <Icon size={16} aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </nav>

        {isSignedIn ? (
          <div className="mt-auto rounded-md border border-line bg-surface-muted px-3.5 py-3">
            <p className="truncate text-[11px] font-semibold text-ink" title={email ?? undefined}>
              {email ?? "Signed in"}
            </p>
            <p className="mt-1 text-[11px] leading-5 text-ink-muted">
              Your cases are visible only to this account.
            </p>
            <button
              type="button"
              onClick={() => void signOut()}
              className="mt-2.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-secondary transition-colors hover:text-ink"
            >
              <LogOut size={12} aria-hidden="true" />
              Sign out
            </button>
          </div>
        ) : (
          <div className="mt-auto rounded-md border border-line bg-surface-muted px-3.5 py-3">
            <p className="text-[11px] font-semibold text-ink">Not signed in</p>
            <p className="mt-1 text-[11px] leading-5 text-ink-muted">
              Sign in to open your deposit cases.
            </p>
          </div>
        )}
      </aside>

      <main className="min-h-screen lg:pl-64">
        <header className="flex h-14 items-center justify-between border-b border-line bg-surface px-5 sm:px-8 lg:px-10">
          <Link
            href={isSignedIn ? "/cases" : "/"}
            className="lg:hidden"
            aria-label={isSignedIn ? "Your cases" : "Clawback home"}
          >
            <Logo />
          </Link>
          <div className="ml-auto flex items-center gap-3 text-xs text-ink-secondary">
            {isSignedIn && email ? (
              <>
                <span className="hidden max-w-[16rem] truncate sm:inline" title={email}>
                  {email}
                </span>
                <span
                  className="flex size-7 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold uppercase text-accent"
                  aria-hidden="true"
                >
                  {email.slice(0, 2)}
                </span>
              </>
            ) : null}
          </div>
        </header>

        <div className="border-b border-line bg-surface px-5 py-2 lg:hidden">
          <nav className="flex gap-1 overflow-x-auto" aria-label="Workspace">
            {navigation.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink"
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>

        {children}
      </main>
    </div>
  );
}
