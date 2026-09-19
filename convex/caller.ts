import type { Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";

/**
 * Who is calling — decided on the server, never taken from the caller.
 *
 * Before this module, every public function accepted a `userId` argument and
 * trusted it. The per-case ownership checks (`loadCaseForOwner`) were already
 * correct, but they compared the stored owner against a value the *client*
 * chose, so anyone could pass someone else's id and be treated as them. That
 * made the checks a correctness guard, not an authorization boundary.
 *
 * The rule now is:
 *
 *   - **Authenticated** → the id is derived from the verified session token.
 *     The `userId` argument is not read at all, so it cannot influence the
 *     outcome even by accident.
 *   - **Unauthenticated, demo mode on** → the argument is used, which is what
 *     lets the local harness and the no-sign-in demo run.
 *   - **Unauthenticated, demo mode off (the default)** → refused.
 *
 * The decision is split from the plumbing on purpose: `decideCaller` is pure,
 * so the offline harness can prove the security properties without a backend,
 * and the two `resolveCaller*` wrappers differ only in whether they can check
 * that the row still exists (an action has no `db`).
 */

/** The divider Convex Auth uses in `identity.subject`: `userId|sessionId`. */
const SUBJECT_DIVIDER = "|";

/**
 * Off by default. A deployment that has not opted in refuses anonymous callers,
 * which is the safe direction to fail: a misconfigured deployment locks people
 * out rather than letting anyone in as anyone.
 *
 * Compared against the exact string `"true"` so a stray `"1"`, `"false"` or
 * empty value cannot switch it on.
 */
export const DEMO_IDENTITY_ENV = "ALLOW_DEMO_IDENTITY";

export function demoIdentityEnabled(): boolean {
  return process.env[DEMO_IDENTITY_ENV] === "true";
}

/**
 * `identity.subject` is `userId|sessionId`, not a bare id. Splitting and taking
 * the first part also handles a bare id correctly (no divider → the whole
 * string), so this stays right if the format ever changes.
 */
export function userIdFromSubject(subject: string): string | null {
  const userId = subject.split(SUBJECT_DIVIDER)[0];
  return userId.length > 0 ? userId : null;
}

export type CallerDecision =
  | { ok: true; userId: Id<"users"> }
  | { ok: false; reason: "NO_SESSION" | "NO_CLAIMED_ID" | "MALFORMED_SUBJECT" };

/**
 * The whole authorization decision, with no database and no context — which is
 * exactly what makes it testable.
 *
 * The order of the two branches is the security property, not a style choice:
 * a session is resolved first and returns immediately, so on the authenticated
 * path `claimedUserId` is never read. Swapping them would let a caller with a
 * valid session act as anyone by naming them.
 */
export function decideCaller({
  subject,
  claimedUserId,
  demoEnabled,
}: {
  subject: string | null;
  claimedUserId?: Id<"users">;
  demoEnabled: boolean;
}): CallerDecision {
  if (subject !== null) {
    const userId = userIdFromSubject(subject);
    if (userId === null) return { ok: false, reason: "MALFORMED_SUBJECT" };
    return { ok: true, userId: userId as Id<"users"> };
  }

  if (!demoEnabled) return { ok: false, reason: "NO_SESSION" };
  if (claimedUserId === undefined) return { ok: false, reason: "NO_CLAIMED_ID" };

  return { ok: true, userId: claimedUserId };
}

/** One message for every refusal, so a caller cannot probe which rule failed. */
const REFUSED = "Unauthorized";

/**
 * Resolves the caller for a query or mutation, and confirms the row still
 * exists. A token can outlive its user, and a case owned by a deleted user is
 * not something to act on.
 */
export async function resolveCaller(
  ctx: QueryCtx | MutationCtx,
  claimedUserId?: Id<"users">
): Promise<Id<"users">> {
  const identity = await ctx.auth.getUserIdentity();

  const decision = decideCaller({
    subject: identity?.subject ?? null,
    claimedUserId,
    demoEnabled: demoIdentityEnabled(),
  });

  if (!decision.ok) throw new Error(REFUSED);

  // A subject that is not a well-formed table id would throw inside `db.get`;
  // normalise that to the same refusal rather than leaking a validation error.
  let user;
  try {
    user = await ctx.db.get(decision.userId);
  } catch {
    throw new Error(REFUSED);
  }

  if (!user) throw new Error(REFUSED);

  return decision.userId;
}

/**
 * The action variant. An action has no `db`, so the row cannot be checked here;
 * every action that needs the row goes on to call a mutation that re-resolves.
 * Kept separate rather than silently skipping the check inside `resolveCaller`,
 * so the weaker guarantee is visible at the call site.
 */
export async function resolveCallerInAction(
  ctx: ActionCtx,
  claimedUserId?: Id<"users">
): Promise<Id<"users">> {
  const identity = await ctx.auth.getUserIdentity();

  const decision = decideCaller({
    subject: identity?.subject ?? null,
    claimedUserId,
    demoEnabled: demoIdentityEnabled(),
  });

  if (!decision.ok) throw new Error(REFUSED);

  return decision.userId;
}
