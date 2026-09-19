"use client";

import { useEffect, useState } from "react";
import { useConvexAuth } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * How long to wait for the backend before telling the user it is unreachable.
 * A healthy deployment answers in well under a second.
 */
const REACHABILITY_TIMEOUT_MS = 8000;

export type CurrentUser = {
  /** The signed-in user's id, or null when nobody is signed in. */
  userId: Id<"users"> | null;
  /** The signed-in user's address, for the account chip. Null when signed out. */
  email: string | null;
  /** True while the session or the user row is still being resolved. */
  isLoading: boolean;
  /** True once a session exists. Distinct from `userId !== null`, see below. */
  isSignedIn: boolean;
  /** A real failure to report: the backend is unreachable. */
  error: string | null;
};

/**
 * Resolves who the caller is.
 *
 * This replaces the old `useDemoUser`, which asked the server to *create* a
 * shared user for every visitor. There is nothing to create now: the session
 * token is the identity, and the server reads it. So this hook only reports what
 * the server already decided.
 *
 * The three states are deliberately separate, because conflating them is how a
 * signed-out visitor ends up staring at a loading skeleton forever:
 *
 *   isLoading   — the session or the row is still in flight.
 *   isSignedIn  — a session exists. `userId` may still be null for one render
 *                 while the row arrives, which is why the two are not the same
 *                 question and the UI must ask the right one.
 *   userId      — the row is here and the app can act.
 *
 * The timeout is not defensive padding. When the deployment is not running the
 * client queues work against a socket that never connects, so neither the
 * session nor the query ever settles — `isLoading` stays true and every screen
 * shows a skeleton with no hint that the backend is simply down. A timeout is
 * the only thing that turns that silence into a diagnosable message.
 */
export function useCurrentUser(): CurrentUser {
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth();
  const user = useQuery(api.users.current);

  const waiting = authLoading || (isAuthenticated && user === undefined);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    if (!waiting) return;

    const timer = setTimeout(() => setUnreachable(true), REACHABILITY_TIMEOUT_MS);

    return () => {
      clearTimeout(timer);
      // Reset when the wait ends or restarts, so a later wait runs its own clock
      // rather than inheriting the previous one's verdict. This matters because
      // `waiting` legitimately flickers true during a sign-in transition, and a
      // stale verdict would flash "backend unreachable" at someone who is simply
      // signing in.
      setUnreachable(false);
    };
  }, [waiting]);

  return {
    userId: (user?._id ?? null) as Id<"users"> | null,
    email: user?.email ?? null,
    isLoading: waiting,
    isSignedIn: isAuthenticated,
    error: unreachable
      ? "Clawback cannot reach its backend, so this workspace did not load. Start the local stack (`npx convex dev`, plus `npm run mocks`) and reload the page."
      : null,
  };
}
