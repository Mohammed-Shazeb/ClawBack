import { v } from "convex/values";
import { demoIdentityEnabled, resolveCaller } from "./caller";
import { mutation, query } from "./_generated/server";

/**
 * Identity.
 *
 * The caller's id is now derived from the session token on the server (see
 * `caller.ts`); no public function trusts a `userId` argument any more. What
 * remains here are the two anonymous helpers the no-sign-in demo needs, and a
 * query for the signed-in user's own row.
 *
 * `ensureDemo` and `createOrGet` both create rows without a session, so they
 * are the only remaining anonymous write paths. They refuse unless the
 * deployment has explicitly opted into demo identities
 * (`ALLOW_DEMO_IDENTITY=true`), which means a production deployment that has
 * not opted in cannot be made to mint users. `createOrGet` is kept public
 * rather than internal because the local end-to-end harness uses it to
 * fabricate the *other* user that the cross-user refusal tests need.
 *
 * The per-case ownership checks are unchanged and remain the second line of
 * defence: now that the id is trustworthy, they are what stops one signed-in
 * renter from reading another's case.
 */

const DEMO_EMAIL = "demo@clawback.local";

function assertDemoMode(): void {
  if (!demoIdentityEnabled()) {
    throw new Error("This deployment does not accept anonymous identities.");
  }
}

export const ensureDemo = mutation({
  args: {},
  handler: async (ctx) => {
    assertDemoMode();

    const existing = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", DEMO_EMAIL))
      .first();

    if (existing) return existing._id;

    return await ctx.db.insert("users", { email: DEMO_EMAIL, name: "Demo renter" });
  },
});

export const createOrGet = mutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertDemoMode();

    const existing = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();

    if (existing) {
      return existing._id;
    }

    return await ctx.db.insert("users", {
      email: args.email,
      name: args.name,
    });
  },
});

/**
 * The signed-in caller's own row, or `null` when nobody is signed in.
 *
 * This replaces the old `get(userId)`, which returned any row for any id — an
 * unauthenticated read of every user in the deployment. There is deliberately
 * no way to ask for someone else's row.
 */
export const current = query({
  args: {},
  handler: async (ctx) => {
    // Checked before resolving so "nobody is signed in" is a normal state the
    // UI can render, rather than a refusal it has to catch.
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) return null;

    const userId = await resolveCaller(ctx);

    return await ctx.db.get(userId);
  },
});
