"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useCurrentUser } from "@/components/current-user";

/**
 * `RequireAuth` — the gate behind every case screen.
 *
 * Case data belongs to an account, so an unauthenticated visitor is sent to
 * sign-up instead of being shown an empty workspace they cannot act on. The
 * redirect waits for the auth state to resolve: acting while `isLoading` is true
 * would bounce a visitor who is already signed in.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoading, isSignedIn } = useCurrentUser();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isSignedIn) router.replace("/signup");
  }, [isLoading, isSignedIn, router]);

  if (isLoading || !isSignedIn) return null;

  return <>{children}</>;
}

/**
 * `NoCase` — what a signed-in user with no cases sees.
 *
 * The prototype always had a case to render, so the screens have nothing to fall
 * back to. Rather than show invented figures, they show this.
 */
export function NoCase() {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-border bg-card px-6 py-12 text-center shadow-flat">
      <p className="label-eyebrow">No case yet</p>
      <h1 className="mt-3 text-[22px] font-semibold tracking-[-0.03em] text-foreground">
        Start your first deposit review
      </h1>
      <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
        Create a case and Clawback opens a private address for it. Forward your
        landlord&apos;s deduction statement there to begin.
      </p>
      <Link
        href="/cases/new"
        className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        Create a case
      </Link>
    </div>
  );
}
