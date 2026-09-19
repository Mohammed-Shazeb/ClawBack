"use client";

import { ReactNode } from "react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

/**
 * `ConvexAuthProvider` rather than a bare `ConvexProvider`.
 *
 * It does everything `ConvexProvider` does and additionally holds the session:
 * it runs the sign-in flow, stores the token, attaches it to every request, and
 * re-runs the app's queries when the session changes. The queries themselves are
 * unchanged — they never see a `userId` from the client any more, because the
 * server derives it from the token this provider attaches.
 */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return <ConvexAuthProvider client={convex}>{children}</ConvexAuthProvider>;
}
