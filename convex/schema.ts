import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    email: v.string(),
    name: v.optional(v.string()),
    clerkUserId: v.optional(v.string()),
  })
    .index("by_email", ["email"])
    .index("by_clerk_user", ["clerkUserId"]),

  cases: defineTable({
    userId: v.id("users"),
    jurisdiction: v.string(),
    depositAmount: v.number(),
    totalDeductions: v.number(),
    potentiallyDisputableAmount: v.number(),
    status: v.union(
      v.literal("RECEIVED"),
      v.literal("ANALYZING"),
      v.literal("RESEARCHING"),
      v.literal("EVIDENCE_FOUND"),
      v.literal("DRAFT_READY"),
      v.literal("AWAITING_APPROVAL"),
      v.literal("SENT"),
      v.literal("LANDLORD_RESPONDED"),
      v.literal("RESOLVED")
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  deductions: defineTable({
    caseId: v.id("cases"),
    description: v.string(),
    amount: v.number(),
    category: v.optional(v.string()),
    isDisputable: v.optional(v.boolean()),
    reasoning: v.optional(v.string()),
  }).index("by_case", ["caseId"]),

  evidence: defineTable({
    caseId: v.id("cases"),
    deductionId: v.optional(v.id("deductions")),
    type: v.string(),
    content: v.string(),
    url: v.optional(v.string()),
    addedAt: v.number(),
  }).index("by_case", ["caseId"]),

  sources: defineTable({
    caseId: v.id("cases"),
    title: v.string(),
    url: v.string(),
    jurisdiction: v.string(),
    relevantText: v.optional(v.string()),
    addedAt: v.number(),
  }).index("by_case", ["caseId"]),

  letters: defineTable({
    caseId: v.id("cases"),
    content: v.string(),
    version: v.number(),
    status: v.union(
      v.literal("DRAFT"),
      v.literal("APPROVED"),
      v.literal("SENT")
    ),
    createdAt: v.number(),
    approvedAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
  }).index("by_case", ["caseId"]),

  emails: defineTable({
    caseId: v.id("cases"),
    letterId: v.optional(v.id("letters")),
    direction: v.union(v.literal("OUTBOUND"), v.literal("INBOUND")),
    subject: v.string(),
    body: v.string(),
    sentAt: v.optional(v.number()),
    receivedAt: v.optional(v.number()),
  }).index("by_case", ["caseId"]),

  timelineEvents: defineTable({
    caseId: v.id("cases"),
    type: v.string(),
    description: v.string(),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  }).index("by_case", ["caseId"]),
});
