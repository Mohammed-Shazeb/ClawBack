import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import {
  attachmentValidator,
  caseStatusValidator,
  deductionCategoryValidator,
  emailProcessingStatusValidator,
  inboxStatusValidator,
} from "./validators";

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
    /**
     * Stays 0 until legal analysis exists. The pipeline records what the
     * landlord claimed, not what is recoverable.
     */
    potentiallyDisputableAmount: v.number(),
    status: caseStatusValidator,
    /** AgentMail inbox id for this case, which is also its email address. */
    inboxId: v.optional(v.string()),
    inboxStatus: v.optional(inboxStatusValidator),
    inboxError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_inbox", ["inboxId"]),

  deductions: defineTable({
    caseId: v.id("cases"),
    description: v.string(),
    /** Absent when the statement did not state an amount for this item. */
    amount: v.optional(v.number()),
    category: v.optional(deductionCategoryValidator),
    isDisputable: v.optional(v.boolean()),
    reasoning: v.optional(v.string()),
    /** The inbound email this deduction was read from. */
    sourceEmailId: v.optional(v.id("emails")),
    createdAt: v.number(),
    updatedAt: v.number(),
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
    /**
     * Absent while a message could not be matched to a case. Unassociated mail
     * is kept for review and is never attached to a case by guesswork.
     */
    caseId: v.optional(v.id("cases")),
    letterId: v.optional(v.id("letters")),
    direction: v.union(v.literal("OUTBOUND"), v.literal("INBOUND")),
    subject: v.string(),
    body: v.string(),
    sender: v.optional(v.string()),
    recipient: v.optional(v.string()),
    /** AgentMail inbox the message arrived in (equivalently, was sent from). */
    inboxId: v.optional(v.string()),
    /** Provider message id, also the idempotency key for webhook retries. */
    externalMessageId: v.optional(v.string()),
    provider: v.optional(v.string()),
    /** Only meaningful for INBOUND mail. */
    processingStatus: v.optional(emailProcessingStatusValidator),
    processingError: v.optional(v.string()),
    /** Set when the message could not be associated with a case. */
    needsReview: v.optional(v.boolean()),
    /**
     * Attachment metadata only. Attachment contents are not downloaded or
     * parsed yet, and nothing in the product claims otherwise.
     */
    attachments: v.optional(v.array(attachmentValidator)),
    sentAt: v.optional(v.number()),
    receivedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_case", ["caseId"])
    .index("by_external_message", ["externalMessageId"]),

  timelineEvents: defineTable({
    caseId: v.id("cases"),
    type: v.string(),
    description: v.string(),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  }).index("by_case", ["caseId"]),
});
