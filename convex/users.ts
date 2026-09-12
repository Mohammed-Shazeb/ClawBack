import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const DEMO_EMAIL = "demo@clawback.local";

export const ensureDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", DEMO_EMAIL))
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
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (existing) {
      return existing._id;
    }

    const userId = await ctx.db.insert("users", {
      email: args.email,
      name: args.name,
    });

    return userId;
  },
});

export const get = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});
