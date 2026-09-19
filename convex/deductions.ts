import { v } from "convex/values";

import { resolveCaller } from "./caller";
import { query } from "./_generated/server";

/** The deductions extracted for a case, in the order they were recorded. */
export const listByCase = query({
  args: {
    caseId: v.id("cases"),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const callerId = await resolveCaller(ctx, args.userId);
    const caseData = await ctx.db.get(args.caseId);
    if (!caseData) throw new Error("Case not found");
    if (caseData.userId !== callerId) throw new Error("Unauthorized");

    const deductions = await ctx.db
      .query("deductions")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    return deductions.map((deduction) => ({
      _id: deduction._id,
      description: deduction.description,
      amount: deduction.amount,
      category: deduction.category,
      researchStatus: deduction.researchStatus,
      researchQuestion: deduction.researchQuestion,
      researchError: deduction.researchError,
      assessmentStatus: deduction.assessmentStatus,
      assessment: deduction.assessment,
      assessmentReason: deduction.assessmentReason,
      potentiallyDisputableAmount: deduction.potentiallyDisputableAmount,
      assessmentSourceIds: deduction.assessmentSourceIds,
      assessmentMissingInformation: deduction.assessmentMissingInformation ?? [],
      assessmentError: deduction.assessmentError,
      assessedAt: deduction.assessedAt,
      createdAt: deduction.createdAt,
    }));
  },
});
