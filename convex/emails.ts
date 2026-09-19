import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { internalAction, internalMutation, mutation, query } from "./_generated/server";
import { fetchInboundImageAttachment, fetchInboundMessageBody } from "./agentmail";
import { resolveCaller } from "./caller";
import { toSafeMessage } from "./errors";
import {
  buildStatementUserPrompt,
  DEPOSIT_STATEMENT_SCHEMA_NAME,
  depositStatementJsonSchema,
  EXTRACTION_SYSTEM_PROMPT,
  parseDepositStatement,
  toExtractionResult,
} from "./extraction";
import { requestStructuredJson } from "./openai";
import {
  attachmentValidator,
  caseStatusValidator,
  extractionResultValidator,
} from "./validators";

/**
 * Inbound email pipeline: AgentMail -> Convex -> OpenAI extraction -> case.
 *
 * Mutations own every database write; the action only does network calls and
 * orchestration, so a failed model call can never leave a half-written case.
 */

/**
 * Case statuses that analysis is allowed to move the case out of. Anything at
 * or beyond ANALYSIS (RESEARCHING, EVIDENCE_FOUND, …) is left alone so a
 * revised statement cannot rewind progress that already happened.
 */
const PRE_ANALYSIS_STATUSES = ["RECEIVED"] as const;

/**
 * Case statuses from which recording a landlord response is a forward move.
 * Everything up to and including SENT precedes a response; LANDLORD_RESPONDED
 * and RESOLVED are already at or past it and must not be rewound.
 */
const PRE_RESPONSE_STATUSES = [
  "RECEIVED",
  "ANALYZING",
  "RESEARCHING",
  "EVIDENCE_FOUND",
  "DRAFT_READY",
  "AWAITING_APPROVAL",
  "SENT",
] as const;

/** What the case UI shows for a statement, without leaking the whole body. */
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

    const emails = await ctx.db
      .query("emails")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .order("desc")
      .collect();

    return emails.map((email) => ({
      _id: email._id,
      direction: email.direction,
      subject: email.subject,
      sender: email.sender,
      recipient: email.recipient,
      receivedAt: email.receivedAt,
      processingStatus: email.processingStatus,
      processingError: email.processingError,
      attachments: email.attachments ?? [],
      createdAt: email.createdAt,
    }));
  },
});

/**
 * The case's correspondence, in the order it happened: the dispute that was
 * sent and anything the landlord sent back. Statements are excluded — this is
 * the communication feed, not the analysis input list.
 *
 * Bodies are included because the renter needs to read what the landlord
 * actually wrote; the model's reading is shown alongside it, never instead of it.
 */
export const listCommunication = query({
  args: {
    caseId: v.id("cases"),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const callerId = await resolveCaller(ctx, args.userId);
    const caseData = await ctx.db.get(args.caseId);
    if (!caseData) throw new Error("Case not found");
    if (caseData.userId !== callerId) throw new Error("Unauthorized");

    const emails = await ctx.db
      .query("emails")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    return emails
      .filter((email) => email.direction === "OUTBOUND" || email.isReply === true)
      .sort((left, right) => {
        const leftAt = left.sentAt ?? left.receivedAt ?? left.createdAt ?? 0;
        const rightAt = right.sentAt ?? right.receivedAt ?? right.createdAt ?? 0;
        return leftAt - rightAt;
      })
      .map((email) => ({
        _id: email._id,
        direction: email.direction,
        subject: email.subject,
        body: email.body,
        sender: email.sender,
        recipient: email.recipient,
        sentAt: email.sentAt,
        receivedAt: email.receivedAt,
        createdAt: email.createdAt,
        sendStatus: email.sendStatus,
        sendError: email.sendError,
        externalMessageId: email.externalMessageId,
        responseAnalysisStatus: email.responseAnalysisStatus,
        responseAnalysis: email.responseAnalysis,
        responseAnalysisError: email.responseAnalysisError,
        responseAnalyzedAt: email.responseAnalyzedAt,
      }));
  },
});

/**
 * Stores an inbound delivery. Idempotent on the provider's message id, so a
 * retried webhook returns the stored row instead of creating a second one.
 *
 * Convex mutations are transactional: if two deliveries of the same message
 * race, the second one re-runs against the first one's writes and takes the
 * duplicate branch.
 *
 * Two kinds of mail arrive on a case inbox, and they are handled very
 * differently:
 *
 *  - a deposit statement, which is extracted into deductions;
 *  - a landlord's reply to the dispute, which is correspondence and must never
 *    be run through extraction — extraction replaces every deduction on the
 *    case, so treating a reply as a statement would destroy the analysis the
 *    dispute was built from.
 *
 * The reply is identified by the provider's thread id first, then by the
 * In-Reply-To/References headers. A subject line is never the primary signal.
 */
export const ingestInbound = internalMutation({
  args: {
    inboxId: v.string(),
    externalMessageId: v.string(),
    sender: v.optional(v.string()),
    recipient: v.optional(v.string()),
    subject: v.string(),
    body: v.string(),
    receivedAt: v.number(),
    threadId: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    references: v.array(v.string()),
    attachments: v.array(attachmentValidator),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("emails")
      .withIndex("by_external_message", (q) =>
        q.eq("externalMessageId", args.externalMessageId)
      )
      .first();

    if (existing) {
      return {
        emailId: existing._id,
        caseId: existing.caseId ?? null,
        created: false,
        kind: existing.isReply ? ("REPLY" as const) : ("STATEMENT" as const),
      };
    }

    const caseData = await ctx.db
      .query("cases")
      .withIndex("by_inbox", (q) => q.eq("inboxId", args.inboxId))
      .first();

    const now = Date.now();

    const isReply = caseData ? await looksLikeReply(ctx, caseData, args) : false;

    const emailId = await ctx.db.insert("emails", {
      caseId: caseData?._id,
      direction: "INBOUND",
      subject: args.subject,
      body: args.body,
      sender: args.sender,
      recipient: args.recipient,
      inboxId: args.inboxId,
      externalMessageId: args.externalMessageId,
      provider: "agentmail",
      threadId: args.threadId,
      inReplyTo: args.inReplyTo,
      references: args.references.length > 0 ? args.references : undefined,
      isReply: isReply ? true : undefined,
      processingStatus: isReply ? undefined : "RECEIVED",
      needsReview: caseData ? undefined : true,
      attachments: args.attachments.length > 0 ? args.attachments : undefined,
      receivedAt: args.receivedAt,
      createdAt: now,
      updatedAt: now,
    });

    if (!caseData) {
      // No case owns this inbox. Store it for review rather than guessing.
      return { emailId, caseId: null, created: true, kind: "STATEMENT" as const };
    }

    if (isReply) {
      return await recordReply(ctx, {
        caseId: caseData._id,
        caseStatus: caseData.status,
        emailId,
        sender: args.sender,
        subject: args.subject,
        now,
      });
    }

    await ctx.db.insert("timelineEvents", {
      caseId: caseData._id,
      type: "EMAIL_RECEIVED",
      description: "Deposit statement received",
      metadata: {
        emailId,
        sender: args.sender,
        subject: args.subject,
        attachmentCount: args.attachments.length,
      },
      createdAt: now,
    });

    await ctx.db.patch(caseData._id, { updatedAt: now });

    // Extraction runs outside the transaction so the webhook can acknowledge
    // immediately.
    await ctx.scheduler.runAfter(0, internal.emails.processInboundEmail, {
      emailId,
    });

    return { emailId, caseId: caseData._id, created: true, kind: "STATEMENT" as const };
  },
});

/**
 * Whether an inbound message is a reply to the dispute rather than a new
 * statement.
 *
 * Order matters, strongest evidence first:
 *
 *  1. the provider's thread id matches the case's dispute thread;
 *  2. the message's In-Reply-To/References name a message we sent on this case;
 *  3. the case has already sent a dispute, so further mail is correspondence.
 *
 * Rule 3 is the safety net: once a dispute is out, the case's deductions are
 * the thing under discussion, and re-running extraction on the next message
 * would silently replace them. A statement arriving after a dispute is far less
 * likely than a reply, and a misclassified statement is recoverable while
 * destroyed analysis is not.
 */
async function looksLikeReply(
  ctx: MutationCtx,
  caseData: { _id: Id<"cases">; threadId?: string; status: string },
  args: { threadId?: string; inReplyTo?: string; references: string[] }
): Promise<boolean> {
  if (caseData.threadId && args.threadId && caseData.threadId === args.threadId) {
    return true;
  }

  const candidateIds = [
    ...(args.inReplyTo ? [args.inReplyTo] : []),
    ...args.references,
  ];

  for (const candidate of candidateIds) {
    const parent = await ctx.db
      .query("emails")
      .withIndex("by_external_message", (q) => q.eq("externalMessageId", candidate))
      .first();

    // A parent we sent on this case settles it.
    if (parent && parent.direction === "OUTBOUND" && parent.caseId === caseData._id) {
      return true;
    }
  }

  const sentLetter = await ctx.db
    .query("letters")
    .withIndex("by_case_and_status", (q) =>
      q.eq("caseId", caseData._id).eq("status", "SENT")
    )
    .first();

  return sentLetter !== null;
}

/** Stores a landlord reply and queues its structured reading. */
async function recordReply(
  ctx: MutationCtx,
  {
    caseId,
    caseStatus,
    emailId,
    sender,
    subject,
    now,
  }: {
    caseId: Id<"cases">;
    caseStatus: string;
    emailId: Id<"emails">;
    sender?: string;
    subject: string;
    now: number;
  }
) {
  await ctx.db.insert("timelineEvents", {
    caseId,
    type: "LANDLORD_RESPONDED",
    description: "Landlord response received",
    metadata: { emailId, sender, subject },
    createdAt: now,
  });

  // Forward-only: a reply cannot normally precede the dispute, but if a race
  // produced one the case is still moved on, and a case already at
  // LANDLORD_RESPONDED or RESOLVED is left alone rather than rewound.
  if (PRE_RESPONSE_STATUSES.includes(caseStatus as (typeof PRE_RESPONSE_STATUSES)[number])) {
    await ctx.db.patch(caseId, { status: "LANDLORD_RESPONDED", updatedAt: now });
  } else {
    await ctx.db.patch(caseId, { updatedAt: now });
  }

  await ctx.db.patch(emailId, {
    responseAnalysisStatus: "PENDING",
    updatedAt: now,
  });

  // Reading the reply is a separate pass; the webhook acknowledges now.
  await ctx.scheduler.runAfter(0, internal.responses.analyzeLandlordResponse, {
    emailId,
  });

  return { emailId, caseId, created: true, kind: "REPLY" as const };
}

/**
 * Marks an email as being processed and moves its case into ANALYZING.
 * Returns null when the message was already handled, which makes retried
 * deliveries and duplicate scheduler runs no-ops.
 */
export const claimForProcessing = internalMutation({
  args: { emailId: v.id("emails") },
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);
    if (!email || email.direction !== "INBOUND") return null;

    // Only a freshly received email can be claimed.
    if (email.processingStatus !== "RECEIVED") return null;

    // Unassociated mail is never processed against a case.
    const caseId = email.caseId;
    if (!caseId) return null;

    const caseData = await ctx.db.get(caseId);
    if (!caseData) return null;

    const now = Date.now();

    await ctx.db.patch(email._id, {
      processingStatus: "PROCESSING",
      processingError: undefined,
      updatedAt: now,
    });

    // Analysis is starting. Only a case that has not moved past analysis is
    // moved into ANALYZING: a revision arriving on a case that already has
    // evidence must not rewind its workflow status.
    if (PRE_ANALYSIS_STATUSES.includes(caseData.status as (typeof PRE_ANALYSIS_STATUSES)[number])) {
      await ctx.db.patch(caseId, {
        status: "ANALYZING",
        updatedAt: now,
      });
    }

    await ctx.db.insert("timelineEvents", {
      caseId,
      type: "ANALYSIS_STARTED",
      description: "Statement analysis started",
      metadata: { emailId: email._id },
      createdAt: now,
    });

    return {
      previousCaseStatus: caseData.status,
      subject: email.subject,
      statement: email.body,
      inboxId: email.inboxId,
      externalMessageId: email.externalMessageId,
      attachments: email.attachments ?? [],
    };
  },
});

/**
 * Reads the statement with the model and hands the validated result to
 * `applyExtraction`. Any failure is recorded on the email instead of being
 * swallowed.
 */
export const processInboundEmail = internalAction({
  args: { emailId: v.id("emails") },
  handler: async (
    ctx,
    args
  ): Promise<{ caseId: Id<"cases">; deductionCount: number; totalDeductions: number } | null> => {
    const claim = await ctx.runMutation(internal.emails.claimForProcessing, {
      emailId: args.emailId,
    });

    // Already processed, already failed, or not associated with a case.
    if (!claim) return null;

    try {
      const statement = await resolveStatementText(ctx, args.emailId, claim);
      const image = await resolveStatementImage(claim);

      if (!statement.trim() && !image) {
        throw new Error("The email did not contain any readable statement text.");
      }

      const raw = await requestStructuredJson({
        system: EXTRACTION_SYSTEM_PROMPT,
        user: image
          ? [
              {
                type: "text",
                text: buildStatementUserPrompt({ subject: claim.subject, body: statement }),
              },
              { type: "image_url", image_url: { url: image } },
            ]
          : buildStatementUserPrompt({ subject: claim.subject, body: statement }),
        schemaName: DEPOSIT_STATEMENT_SCHEMA_NAME,
        jsonSchema: depositStatementJsonSchema,
      });

      const extracted = parseDepositStatement(raw);
      if (!extracted) {
        throw new Error("The statement could not be read as structured data.");
      }

      if (extracted.depositAmount === null && extracted.deductions.length === 0) {
        throw new Error("No deposit statement content was found in this email.");
      }

      return await ctx.runMutation(internal.emails.applyExtraction, {
        emailId: args.emailId,
        extraction: toExtractionResult(extracted),
      });
    } catch (error) {
      const reason = toSafeMessage(error);

      await ctx.runMutation(internal.emails.failProcessing, {
        emailId: args.emailId,
        reason,
        previousCaseStatus: claim.previousCaseStatus,
      });

      return null;
    }
  },
});

/**
 * Stores the extracted deductions, recalculates the case totals and closes out
 * the email. Guarded on the PROCESSING status so a replayed action cannot
 * insert the same deductions twice.
 */
export const applyExtraction = internalMutation({
  args: {
    emailId: v.id("emails"),
    extraction: extractionResultValidator,
  },
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);
    if (!email || email.processingStatus !== "PROCESSING") return null;

    const caseId = email.caseId;
    if (!caseId) return null;

    const caseData = await ctx.db.get(caseId);
    if (!caseData) return null;

    const now = Date.now();

    // A later statement supersedes the deductions read from an earlier one:
    // revised statements would otherwise double-count every charge. Only the
    // deductions this email extracted are replaced; the email rows themselves
    // are kept for the record.
    const previousDeductionIds = await ctx.db
      .query("deductions")
      .withIndex("by_case", (q) => q.eq("caseId", caseId))
      .collect()
      .then((rows) => rows.map((row) => row._id));

    const deductionIds: Id<"deductions">[] = [];
    for (const deduction of args.extraction.deductions) {
      const deductionId = await ctx.db.insert("deductions", {
        caseId,
        description: deduction.description.slice(0, 500),
        amount: deduction.amount,
        category: deduction.category,
        sourceEmailId: email._id,
        researchStatus: "PENDING",
        researchRunId: undefined,
        assessmentStatus: "PENDING",
        assessmentRunId: undefined,
        createdAt: now,
        updatedAt: now,
      });
      deductionIds.push(deductionId);
    }

    for (const previousId of previousDeductionIds) {
      const sources = await ctx.db
        .query("sources")
        .withIndex("by_deduction", (q) => q.eq("deductionId", previousId))
        .collect();
      for (const source of sources) {
        await ctx.db.delete(source._id);
      }
      await ctx.db.delete(previousId);
    }

    const deductions = await ctx.db
      .query("deductions")
      .withIndex("by_case", (q) => q.eq("caseId", caseId))
      .collect();

    const totalDeductions = roundCurrency(
      deductions.reduce((total, deduction) => total + (deduction.amount ?? 0), 0)
    );
    const unquantifiedCount = deductions.filter(
      (deduction) => deduction.amount === undefined
    ).length;

    const statedTotal = args.extraction.statedTotalDeductions;
    const deductionCount = args.extraction.deductions.length;

    await ctx.db.patch(caseId, {
      // A statement that does not restate the deposit leaves it as it was.
      depositAmount: roundCurrency(
        args.extraction.depositAmount ?? caseData.depositAmount
      ),
      totalDeductions,
      // Every deduction was just rewritten, so nothing is claimed as
      // disputable until the new deductions have been researched and assessed.
      potentiallyDisputableAmount: 0,
      updatedAt: now,
    });

    await ctx.db.insert("timelineEvents", {
      caseId,
      type: "ANALYSIS_COMPLETED",
      description: `Statement analysis completed — ${deductionCount} deduction${
        deductionCount === 1 ? "" : "s"
      } extracted`,
      metadata: {
        emailId: email._id,
        deductionCount,
        unquantifiedCount,
        depositAmount: args.extraction.depositAmount,
        statedTotalDeductions: statedTotal,
        totalDeductions,
        statedTotalMismatch:
          statedTotal !== undefined && Math.abs(statedTotal - totalDeductions) > 0.005,
        notes: args.extraction.notes,
      },
      createdAt: now,
    });

    // Analysis advances the case, but only from a status that precedes it: a
    // revised statement on a case that already has evidence must not drag the
    // case backwards to ANALYZING. The deductions it extracted have been reset
    // to PENDING, so the research pipeline will move the case on again.
    if (PRE_ANALYSIS_STATUSES.includes(caseData.status as (typeof PRE_ANALYSIS_STATUSES)[number])) {
      await ctx.db.patch(caseId, { status: "ANALYZING", updatedAt: now });
    }

    await ctx.db.patch(email._id, {
      processingStatus: "PROCESSED",
      processingError: undefined,
      updatedAt: now,
    });

    // Each extracted deduction moves on to official-source research, outside
    // this transaction so a slow provider call cannot hold up the email write.
    for (const deductionId of deductionIds) {
      await ctx.scheduler.runAfter(0, internal.research.researchDeduction, { deductionId });
    }

    return { caseId, deductionCount, totalDeductions };
  },
});

/**
 * Records a failed analysis. The case only returns to its previous status when
 * nothing has ever been extracted for it, so a second failing email cannot wipe
 * out the state a successful one produced.
 */
export const failProcessing = internalMutation({
  args: {
    emailId: v.id("emails"),
    reason: v.string(),
    previousCaseStatus: caseStatusValidator,
  },
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);
    if (!email) return null;

    // Never downgrade an analysis that already succeeded.
    if (email.processingStatus === "PROCESSED") return null;

    const now = Date.now();

    await ctx.db.patch(email._id, {
      processingStatus: "FAILED",
      processingError: args.reason,
      updatedAt: now,
    });

    const caseId = email.caseId;
    if (!caseId) return null;

    const caseData = await ctx.db.get(caseId);
    if (!caseData) return null;

    const existingDeduction = await ctx.db
      .query("deductions")
      .withIndex("by_case", (q) => q.eq("caseId", caseId))
      .first();

    await ctx.db.patch(caseId, {
      status: existingDeduction ? caseData.status : args.previousCaseStatus,
      updatedAt: now,
    });

    await ctx.db.insert("timelineEvents", {
      caseId,
      type: "ANALYSIS_FAILED",
      description: "Statement analysis failed",
      metadata: { emailId: email._id, reason: args.reason },
      createdAt: now,
    });

    return null;
  },
});

/** Stores a body fetched from AgentMail after an oversized webhook payload. */
export const recordStatementBody = internalMutation({
  args: { emailId: v.id("emails"), body: v.string() },
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);
    if (!email || email.body.trim()) return null;

    await ctx.db.patch(args.emailId, {
      body: args.body,
      updatedAt: Date.now(),
    });

    return null;
  },
});

/** Puts a failed email back in the queue so the analysis can be retried. */
export const retryProcessing = mutation({
  args: {
    emailId: v.id("emails"),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const callerId = await resolveCaller(ctx, args.userId);

    const email = await ctx.db.get(args.emailId);
    if (!email) throw new Error("Email not found");
    if (!email.caseId) throw new Error("This email is not attached to a case");

    const caseData = await ctx.db.get(email.caseId);
    if (!caseData) throw new Error("Case not found");
    if (caseData.userId !== callerId) throw new Error("Unauthorized");

    if (email.processingStatus !== "FAILED") {
      throw new Error("Only a failed statement can be analyzed again");
    }

    await ctx.db.patch(email._id, {
      processingStatus: "RECEIVED",
      processingError: undefined,
      updatedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.emails.processInboundEmail, {
      emailId: email._id,
    });

    return null;
  },
});

/**
 * Uses the statement text stored on the email. When the webhook had to drop an
 * oversized body, the text is fetched back from AgentMail and stored.
 */
async function resolveStatementText(
  ctx: ActionCtx,
  emailId: Id<"emails">,
  claim: { statement: string; inboxId?: string; externalMessageId?: string }
): Promise<string> {
  if (claim.statement.trim()) return claim.statement;
  if (!claim.inboxId || !claim.externalMessageId) return "";

  const body = await fetchInboundMessageBody({
    inboxId: claim.inboxId,
    messageId: claim.externalMessageId,
  });

  if (!body?.trim()) return "";

  await ctx.runMutation(internal.emails.recordStatementBody, { emailId, body });

  return body;
}

async function resolveStatementImage(
  claim: {
    inboxId?: string;
    externalMessageId?: string;
    attachments: Array<{
      attachmentId?: string;
      contentType?: string;
    }>;
  }
): Promise<string | null> {
  const imageAttachment = claim.attachments.find(
    (attachment) =>
      attachment.attachmentId && attachment.contentType?.toLowerCase().startsWith("image/")
  );
  if (!imageAttachment?.attachmentId || !claim.inboxId || !claim.externalMessageId) return null;

  return fetchInboundImageAttachment({
    inboxId: claim.inboxId,
    messageId: claim.externalMessageId,
    attachmentId: imageAttachment.attachmentId,
    contentType: imageAttachment.contentType,
  });
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
