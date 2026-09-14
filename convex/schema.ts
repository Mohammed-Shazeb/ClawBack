import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import {
  assessmentOutcomeValidator,
  assessmentStatusValidator,
  attachmentValidator,
  caseStatusValidator,
  deductionCategoryValidator,
  emailProcessingStatusValidator,
  inboxStatusValidator,
  researchStatusValidator,
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
    /** The inbound email this deduction was read from. */
    sourceEmailId: v.optional(v.id("emails")),
    /** Where research for this deduction stands. Absent on deductions written
     * before research existed; treated as PENDING by the research pipeline. */
    researchStatus: v.optional(researchStatusValidator),
    /** Identifies the research pass that currently owns this deduction. A pass
     * may only write its results if this still matches the pass that claimed
     * the deduction, so a superseded or duplicated run cannot overwrite newer
     * evidence. */
    researchRunId: v.optional(v.string()),
    /** The question researched for this deduction, once one has been generated. */
    researchQuestion: v.optional(v.string()),
    /** Why the last research pass failed, when it did. */
    researchError: v.optional(v.string()),
    /** Where the evidence-based assessment stands. Absent on deductions written
     * before assessment existed; treated as PENDING by the pipeline. */
    assessmentStatus: v.optional(assessmentStatusValidator),
    /** Identifies the assessment pass that currently owns this deduction, so a
     * superseded run cannot overwrite a newer assessment. */
    assessmentRunId: v.optional(v.string()),
    /** The validated assessment outcome, once assessment completed. */
    assessment: v.optional(assessmentOutcomeValidator),
    /** Concise evidence-based explanation shown to the renter. This is the
     * validated reasoning summary, never private model chain-of-thought. */
    assessmentReason: v.optional(v.string()),
    /** What this deduction contributes to the case's disputable total. Kept
     * within the stated amount; 0 unless the outcome is POTENTIALLY_DISPUTABLE. */
    potentiallyDisputableAmount: v.optional(v.number()),
    /** The sources the assessment cites, all found by research for this
     * deduction. */
    assessmentSourceIds: v.optional(v.array(v.id("sources"))),
    /** What the assessment said was missing, when evidence was insufficient. */
    assessmentMissingInformation: v.optional(v.array(v.string())),
    /** Why the last assessment failed, when it did. */
    assessmentError: v.optional(v.string()),
    assessedAt: v.optional(v.number()),
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
    /** The deduction whose research found this source, when it was found by
     * research rather than entered some other way. */
    deductionId: v.optional(v.id("deductions")),
    title: v.string(),
    url: v.string(),
    /** Expected to identify the source's standing (e.g. a government agency),
     * not to reach any legal conclusion. */
    authority: v.string(),
    jurisdiction: v.string(),
    /** The retrieved passage relevant to the deduction, when the provider
     * returned one. External, untrusted text. */
    relevantText: v.optional(v.string()),
    /** When the source was retrieved from the provider. */
    retrievedAt: v.number(),
    addedAt: v.number(),
  })
    .index("by_case", ["caseId"])
    .index("by_deduction", ["deductionId"]),

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
