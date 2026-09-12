import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const create = mutation({
  args: {
    userId: v.id("users"),
    jurisdiction: v.string(),
    depositAmount: v.number(),
    totalDeductions: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");
    if (args.depositAmount < 0 || args.totalDeductions < 0) {
      throw new Error("Amounts cannot be negative");
    }

    const now = Date.now();

    const caseId = await ctx.db.insert("cases", {
      userId: args.userId,
      jurisdiction: args.jurisdiction,
      depositAmount: args.depositAmount,
      totalDeductions: args.totalDeductions,
      potentiallyDisputableAmount: 0,
      status: "RECEIVED",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("timelineEvents", {
      caseId,
      type: "CASE_CREATED",
      description: "Case received",
      createdAt: now,
    });

    return caseId;
  },
});

export const list = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const cases = await ctx.db
      .query("cases")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .collect();

    return cases;
  },
});

export const get = query({
  args: {
    caseId: v.id("cases"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const caseData = await ctx.db.get(args.caseId);

    if (!caseData) {
      return null;
    }

    if (caseData.userId !== args.userId) {
      throw new Error("Unauthorized");
    }

    return caseData;
  },
});

export const getTimeline = query({
  args: {
    caseId: v.id("cases"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const caseData = await ctx.db.get(args.caseId);

    if (!caseData) {
      throw new Error("Case not found");
    }

    if (caseData.userId !== args.userId) {
      throw new Error("Unauthorized");
    }

    const events = await ctx.db
      .query("timelineEvents")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .order("asc")
      .collect();

    return events;
  },
});
