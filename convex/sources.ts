import { v } from "convex/values";
import { query } from "./_generated/server";

/** The official sources research stored for a case, oldest first. */
export const listByCase = query({
  args: {
    caseId: v.id("cases"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const caseData = await ctx.db.get(args.caseId);
    if (!caseData) throw new Error("Case not found");
    if (caseData.userId !== args.userId) throw new Error("Unauthorized");

    return await ctx.db
      .query("sources")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .order("asc")
      .collect();
  },
});
