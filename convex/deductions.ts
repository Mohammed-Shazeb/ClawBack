import { v } from "convex/values";

import { query } from "./_generated/server";

/** The deductions extracted for a case, in the order they were recorded. */
export const listByCase = query({
  args: {
    caseId: v.id("cases"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const caseData = await ctx.db.get(args.caseId);
    if (!caseData) throw new Error("Case not found");
    if (caseData.userId !== args.userId) throw new Error("Unauthorized");

    const deductions = await ctx.db
      .query("deductions")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    return deductions.map((deduction) => ({
      _id: deduction._id,
      description: deduction.description,
      amount: deduction.amount,
      category: deduction.category,
      createdAt: deduction.createdAt,
    }));
  },
});
