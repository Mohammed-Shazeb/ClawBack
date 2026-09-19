"use client";

import { ReactNode } from "react";

import { AppShell } from "./app-shell";
import { useCurrentUser } from "./current-user";
import { SignIn } from "./sign-in";

/**
 * Decides what a visitor may see, and nothing else.
 *
 * Every screen that shows case data sits behind this, so the three states are
 * handled once rather than four times. The order matters: the loading check has
 * to come first, because a signed-in visitor whose row has not arrived yet is
 * `isSignedIn && !userId`, and rendering the sign-in form at that moment would
 * flash a login screen at someone who is already logged in.
 *
 * Children are only rendered once a user exists, so a screen inside this gate
 * can treat `userId` as present for the purposes of its queries — though it
 * still passes `"skip"` while null, because the type is honestly nullable and
 * one render does occur before the row lands.
 */
export function WorkspaceGate({ children }: { children: ReactNode }) {
  const { isLoading, isSignedIn, error } = useCurrentUser();

  if (error) {
    return (
      <AppShell>
        <div className="mx-auto max-w-2xl px-5 py-16 sm:px-8">
          <div className="rounded-md border border-danger-line bg-danger-soft px-4 py-3.5">
            <p className="text-[13px] font-medium text-danger">Clawback is unavailable</p>
            <p className="mt-1 text-xs leading-5 text-danger">{error}</p>
          </div>
        </div>
      </AppShell>
    );
  }

  if (isLoading) {
    return (
      <AppShell>
        <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8 lg:px-10" aria-busy="true">
          <span className="sr-only">Loading your workspace</span>
          <div className="h-7 w-56 animate-pulse rounded-md bg-surface-muted" />
          <div className="mt-7 grid gap-4 lg:grid-cols-2">
            <div className="h-32 animate-pulse rounded-lg bg-surface-muted" />
            <div className="h-32 animate-pulse rounded-lg bg-surface-muted" />
          </div>
        </div>
      </AppShell>
    );
  }

  if (!isSignedIn) return <SignIn />;

  return <>{children}</>;
}
