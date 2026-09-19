import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import {
  assessmentOutcomeValidator,
  assessmentStatusValidator,
  attachmentValidator,
  caseStatusValidator,
  deductionCategoryValidator,
  emailDirectionValidator,
  emailProcessingStatusValidator,
  inboxStatusValidator,
  letterPipelineStatusValidator,
  letterStatusValidator,
  outboundSendStatusValidator,
  researchStatusValidator,
  responseAnalysisStatusValidator,
  responseAnalysisValidator,
} from "./validators";

export default defineSchema({
  // Convex Auth brings its own `users`, `authSessions`, `authAccounts`,
  // `authRefreshTokens`, `authVerificationCodes`, `authVerifiers` and
  // `authRateLimits` tables.
  ...authTables,

  /**
   * `users` is redefined *after* the spread so the app's own fields survive,
   * but it must keep every field and index Convex Auth relies on.
   *
   * Two things changed from the pre-auth definition, both deliberate:
   *  - `email` is now optional, because Convex Auth can create a row before an
   *    address is verified. The app's own lookups still require one to be
   *    present, and nothing reads a user row expecting `email` to be a string.
   *  - The address index is now named `email`, which is the name Convex Auth
   *    queries. The old `by_email` index had to go rather than be kept
   *    alongside it: Convex rejects two indexes over the same fields
   *    (`IndexNotUnique`), so `users.ts` was updated to match.
   */
  users: defineTable({
    // Convex Auth's fields. The names and optionality are its contract.
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    /** The auth provider subject this row was created from. */
    authSubject: v.optional(v.string()),
    /** Kept so rows written before auth existed stay schema-valid. */
    clerkUserId: v.optional(v.string()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("by_clerk_user", ["clerkUserId"])
    .index("by_auth_subject", ["authSubject"]),

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
    /**
     * The landlord's or property manager's email address, entered by the renter.
     * This is the envelope recipient for a dispute; the letter's own `recipient`
     * field is only the salutation shown on the document ("Property Manager").
     * Deliberately optional: Clawback never invents an address, and sending is
     * blocked until one is supplied.
     */
    landlordEmail: v.optional(v.string()),
    /**
     * The AgentMail conversation thread for this case's dispute, set when the
     * dispute letter is first sent. A landlord reply carries the same thread id,
     * which is how a reply is tied back to its case without guessing from the
     * subject line.
     */
    threadId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_inbox", ["inboxId"])
    .index("by_thread", ["threadId"]),

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
    /** Full letter text as shown and sent, including the salutation and
     * sign-off. Kept alongside the structured fields so an edited letter is
     * stored exactly as the renter approved it. */
    content: v.string(),
    /** Who the letter is addressed to. Model-generated, renter-editable. */
    recipient: v.string(),
    subject: v.string(),
    body: v.string(),
    /** Monotonic: bumped on every generation and on every explicit save. */
    version: v.number(),
    /** The workflow state. Only `approveLetter` may write APPROVED, and only
     * the owner may call it. SENT is reserved for the next milestone. */
    status: letterStatusValidator,
    /** Where generation stands, so the UI can show real progress and real
     * failures instead of a fabricated one. */
    pipelineStatus: letterPipelineStatusValidator,
    /** Why the last generation or validation failed, when it did. */
    pipelineError: v.optional(v.string()),
    /** Identifies the generation pass that currently owns this letter, so a
     * superseded run cannot overwrite a newer draft. */
    generationRunId: v.optional(v.string()),
    /** The stored sources the letter's evidence-backed claims rest on. Always
     * sources belonging to this case. Never rendered as database ids. */
    supportingSourceIds: v.array(v.id("sources")),
    /** Snapshot of the case figures the letter was drafted from, so a later
     * recomputation cannot silently change what an approved letter claims. */
    depositAmount: v.number(),
    totalDeductions: v.number(),
    potentiallyDisputableAmount: v.number(),
    /** Set when the renter edited the generated draft, so the UI can show that
     * the stored text is no longer exactly what the model produced. */
    editedAt: v.optional(v.number()),
    /** Set when this letter stopped being the case's live letter, because the
     * renter explicitly started a new draft. An archived approved letter is
     * kept for the record and is never rewritten. */
    archivedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    approvedAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
  })
    .index("by_case", ["caseId"])
    .index("by_case_and_status", ["caseId", "status"]),

  emails: defineTable({
    /**
     * Absent while a message could not be matched to a case. Unassociated mail
     * is kept for review and is never attached to a case by guesswork.
     */
    caseId: v.optional(v.id("cases")),
    letterId: v.optional(v.id("letters")),
    direction: emailDirectionValidator,
    subject: v.string(),
    body: v.string(),
    sender: v.optional(v.string()),
    recipient: v.optional(v.string()),
    /** AgentMail inbox the message arrived in (equivalently, was sent from). */
    inboxId: v.optional(v.string()),
    /** Provider message id, also the idempotency key for webhook retries. */
    externalMessageId: v.optional(v.string()),
    provider: v.optional(v.string()),
    /**
     * The provider's conversation thread. Shared by every message in the same
     * back-and-forth, which is the primary way a landlord reply is matched to
     * the case that sent the dispute.
     */
    threadId: v.optional(v.string()),
    /** The message this one replies to, when the provider supplies it. */
    inReplyTo: v.optional(v.string()),
    /** The conversation's prior message ids, when the provider supplies them. */
    references: v.optional(v.array(v.string())),
    /**
     * Deterministic key identifying the exact outbound document being sent
     * (letter id plus version). A second attempt at the same document finds
     * this row instead of sending again, which is what makes sending safe
     * against double-clicks, retries and duplicated webhooks.
     */
    idempotencyKey: v.optional(v.string()),
    /** Where an outbound send stands. Absent for inbound mail. */
    sendStatus: v.optional(outboundSendStatusValidator),
    /** Why the last send attempt failed, when it did. */
    sendError: v.optional(v.string()),
    /** How many times a send has been attempted, so retries are visible. */
    sendAttempts: v.optional(v.number()),
    /** Only meaningful for INBOUND mail. */
    processingStatus: v.optional(emailProcessingStatusValidator),
    processingError: v.optional(v.string()),
    /** True when this inbound message is a landlord reply rather than a
     * statement, so the UI and pipeline treat it as correspondence. */
    isReply: v.optional(v.boolean()),
    /** Where the structured reading of a landlord reply stands. */
    responseAnalysisStatus: v.optional(responseAnalysisStatusValidator),
    /** The validated reading of the reply. Never a legal conclusion. */
    responseAnalysis: v.optional(responseAnalysisValidator),
    responseAnalysisError: v.optional(v.string()),
    responseAnalyzedAt: v.optional(v.number()),
    /** Set when the message could not be associated with a case. */
    needsReview: v.optional(v.boolean()),
    /** Attachment metadata; image contents may be fetched during statement analysis. */
    attachments: v.optional(v.array(attachmentValidator)),
    sentAt: v.optional(v.number()),
    receivedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_case", ["caseId"])
    .index("by_external_message", ["externalMessageId"])
    .index("by_idempotency", ["idempotencyKey"])
    .index("by_thread", ["threadId"]),

  timelineEvents: defineTable({
    caseId: v.id("cases"),
    type: v.string(),
    description: v.string(),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  }).index("by_case", ["caseId"]),
});
