import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import { sendCaseMessage } from "./agentmail";
import { toSafeMessage } from "./errors";
import {
  decideSendClaim,
  duplicateSendMessage,
  isSendableEmail,
  sendIdempotencyKey,
  validateSendRequest,
} from "./send";

/**
 * Outbound dispute delivery: an approved letter is handed to AgentMail, and the
 * case only becomes SENT once the provider confirms it accepted the message.
 *
 * Scope guard: sending is explicitly triggered by the renter. Nothing here runs
 * as a consequence of generation or approval.
 *
 * Concurrency discipline: one send is in flight per case at a time, guarded by
 * the outbound email row. The claim is a single-document write, so a double
 * click serialises on that row and the second attempt is refused rather than
 * sending a second copy.
 */

/** Case statuses from which sending is a forward move. */
const PRE_SEND_STATUSES = [
  "RECEIVED",
  "ANALYZING",
  "RESEARCHING",
  "EVIDENCE_FOUND",
  "DRAFT_READY",
  "AWAITING_APPROVAL",
] as const;

/** A send refusal that the renter can act on, as opposed to a crash. */
export class SendRefused extends Error {}

async function loadCaseForOwner(
  ctx: QueryCtx | MutationCtx,
  caseId: Id<"cases">,
  userId: Id<"users">
) {
  const caseData = await ctx.db.get(caseId);
  if (!caseData) throw new Error("Case not found");
  if (caseData.userId !== userId) throw new Error("Unauthorized");

  return caseData;
}

/** The live letter for a case: the newest one not archived by a new draft. */
async function resolveLiveLetter(ctx: QueryCtx | MutationCtx, caseId: Id<"cases">) {
  const letters = await ctx.db
    .query("letters")
    .withIndex("by_case", (q) => q.eq("caseId", caseId))
    .order("desc")
    .collect();

  return letters.find((letter) => letter.archivedAt === undefined) ?? null;
}

/**
 * Everything the send attempt needs, read fresh rather than carried through the
 * scheduler so the action cannot send a document that has since changed.
 */
export const getSendContext = internalQuery({
  args: { emailId: v.id("emails") },
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);
    if (!email || email.direction !== "OUTBOUND") return null;
    if (email.sendStatus !== "SENDING") return null;

    const caseId = email.caseId;
    if (!caseId) return null;

    const caseData = await ctx.db.get(caseId);
    if (!caseData) return null;

    if (!email.inboxId || !email.recipient || !email.idempotencyKey) return null;

    return {
      inboxId: email.inboxId,
      recipient: email.recipient,
      subject: email.subject,
      body: email.body,
      threadId: caseData.threadId,
      idempotencyKey: email.idempotencyKey,
      caseId,
    };
  },
});

/**
 * Validates an approved letter for sending and claims the send.
 *
 * Returns the outbound email row to hand to the provider. Refusals are thrown
 * as `SendRefused` so the UI can show a real reason, and nothing is claimed
 * unless the letter genuinely is approved and addressed.
 */
export const sendLetter = mutation({
  args: {
    caseId: v.id("cases"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const caseData = await loadCaseForOwner(ctx, args.caseId, args.userId);

    const letter = await resolveLiveLetter(ctx, args.caseId);

    // The envelope recipient is the renter-supplied landlord address; the
    // letter's own `recipient` is only the salutation on the document.
    const landlordEmail = caseData.landlordEmail?.trim();

    // Every precondition lives in the pure contract so it is unit-tested
    // offline; this call is the only place the rules are applied.
    const refusal = validateSendRequest({
      letter: letter
        ? {
            status: letter.status,
            pipelineStatus: letter.pipelineStatus,
            subject: letter.subject,
            body: letter.body,
          }
        : null,
      inboxId: caseData.inboxId,
      landlordEmail,
    });

    if (refusal) throw new SendRefused(refusal.message);

    // `validateSendRequest` returning null guarantees these are present.
    if (!letter || !landlordEmail || !caseData.inboxId) {
      throw new SendRefused("The dispute cannot be sent from this case yet.");
    }

    const idempotencyKey = sendIdempotencyKey(letter._id, letter.version);
    const now = Date.now();

    const existing = await ctx.db
      .query("emails")
      .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey))
      .first();

    if (existing) {
      const previousStatus = existing.sendStatus ?? "FAILED";

      // Already delivered, still in flight, or a failed attempt to reuse. The
      // decision table is pure so every branch — including the stale-claim
      // boundary — is covered without a live deployment.
      const decision = decideSendClaim({
        sendStatus: previousStatus,
        ageMs: now - (existing.updatedAt ?? existing.createdAt ?? now),
      });

      if (decision !== "REUSE") {
        throw new SendRefused(duplicateSendMessage(decision));
      }

      // A failed attempt, or an abandoned one: reuse the same row so the
      // document keeps exactly one outbound record.
      await ctx.db.patch(existing._id, {
        sendStatus: "SENDING",
        sendError: undefined,
        sendAttempts: (existing.sendAttempts ?? 0) + 1,
        body: letter.body,
        subject: letter.subject,
        recipient: landlordEmail,
        sender: caseData.inboxId,
        letterId: letter._id,
        updatedAt: now,
      });

      // Taking over an abandoned claim is not the same as retrying a failure we
      // observed. The earlier attempt may have reached the provider and simply
      // not reported back, in which case the landlord can receive two copies.
      // We cannot detect that from here (this AgentMail endpoint has no
      // idempotency key), so it is recorded rather than hidden.
      if (previousStatus === "SENDING") {
        await ctx.db.insert("timelineEvents", {
          caseId: caseData._id,
          type: "SEND_ATTEMPT_ABANDONED",
          description:
            "A previous send attempt did not report back, so it was retried — the landlord may receive two copies",
          metadata: {
            emailId: existing._id,
            previousAttempts: existing.sendAttempts ?? 1,
            recipient: landlordEmail,
          },
          createdAt: now,
        });
      }

      await ctx.scheduler.runAfter(0, internal.outbound.performSend, {
        emailId: existing._id,
      });

      return { emailId: existing._id, resent: true };
    }

    const emailId = await ctx.db.insert("emails", {
      caseId: caseData._id,
      letterId: letter._id,
      direction: "OUTBOUND",
      subject: letter.subject,
      body: letter.body,
      sender: caseData.inboxId,
      recipient: landlordEmail,
      inboxId: caseData.inboxId,
      provider: "agentmail",
      idempotencyKey,
      sendStatus: "SENDING",
      sendAttempts: 1,
      sentAt: undefined,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.outbound.performSend, { emailId });

    return { emailId, resent: false };
  },
});

/**
 * Calls AgentMail and records the outcome. Every database write happens in a
 * mutation; this only performs the network call, so a crash mid-send leaves the
 * claim in SENDING (recoverable) rather than a half-written SENT.
 */
export const performSend = internalAction({
  args: { emailId: v.id("emails") },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    const context = await ctx.runQuery(internal.outbound.getSendContext, {
      emailId: args.emailId,
    });

    // The claim was already resolved or taken over by a newer attempt.
    if (!context) return { ok: false, reason: "This send is no longer active." };

    try {
      const sent = await sendCaseMessage({
        inboxId: context.inboxId,
        to: context.recipient,
        subject: context.subject,
        text: context.body,
        threadId: context.threadId,
      });

      await ctx.runMutation(internal.outbound.recordSendSuccess, {
        emailId: args.emailId,
        externalMessageId: sent.externalMessageId,
        threadId: sent.threadId,
      });

      return { ok: true };
    } catch (error) {
      const reason = toSafeMessage(error, "The dispute could not be sent.");

      await ctx.runMutation(internal.outbound.recordSendFailure, {
        emailId: args.emailId,
        reason,
      });

      return { ok: false, reason };
    }
  },
});

/**
 * The send succeeded. One transaction records the provider's message id, marks
 * the letter sent, and moves the case forward — so the case can never claim to
 * have sent a dispute that the provider did not accept.
 *
 * Only one send per case can be in flight (guarded by the email row), so this
 * does not contend with concurrent siblings.
 */
export const recordSendSuccess = internalMutation({
  args: {
    emailId: v.id("emails"),
    externalMessageId: v.string(),
    threadId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);
    if (!email || email.direction !== "OUTBOUND") return null;

    // Already recorded by an earlier attempt of the same send.
    if (email.sendStatus === "SENT") return null;

    const caseId = email.caseId;
    if (!caseId) return null;

    const caseData = await ctx.db.get(caseId);
    if (!caseData) return null;

    const now = Date.now();

    await ctx.db.patch(email._id, {
      sendStatus: "SENT",
      sendError: undefined,
      externalMessageId: args.externalMessageId,
      threadId: args.threadId,
      sentAt: now,
      updatedAt: now,
    });

    // The letter is now sent. Its text is never rewritten after this point.
    if (email.letterId) {
      const letter = await ctx.db.get(email.letterId);
      if (letter) {
        await ctx.db.patch(letter._id, {
          status: "SENT",
          sentAt: now,
          updatedAt: now,
        });
      }
    }

    // Remember the conversation so a landlord reply can be matched to this case
    // by thread rather than by subject line.
    if (args.threadId && caseData.threadId !== args.threadId) {
      await ctx.db.patch(caseId, { threadId: args.threadId, updatedAt: now });
    }

    // Forward-only: a case already past SENT (a reply arrived first) is left.
    if (PRE_SEND_STATUSES.includes(caseData.status as (typeof PRE_SEND_STATUSES)[number])) {
      await ctx.db.patch(caseId, { status: "SENT", updatedAt: now });
    }

    await ctx.db.insert("timelineEvents", {
      caseId,
      type: "DISPUTE_SENT",
      description: "Dispute sent",
      metadata: {
        emailId: email._id,
        letterId: email.letterId,
        recipient: email.recipient,
        externalMessageId: args.externalMessageId,
      },
      createdAt: now,
    });

    return { caseId };
  },
});

/**
 * The send failed. The email records why and stays retryable; the case is left
 * exactly where it was, because nothing was delivered.
 */
export const recordSendFailure = internalMutation({
  args: {
    emailId: v.id("emails"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);
    if (!email || email.direction !== "OUTBOUND") return null;

    // Never downgrade a send that already succeeded.
    if (email.sendStatus === "SENT") return null;

    const now = Date.now();

    await ctx.db.patch(email._id, {
      sendStatus: "FAILED",
      sendError: args.reason,
      updatedAt: now,
    });

    const caseId = email.caseId;
    if (!caseId) return null;

    await ctx.db.insert("timelineEvents", {
      caseId,
      type: "SEND_FAILED",
      description: "Sending the dispute failed",
      metadata: { emailId: email._id, reason: args.reason },
      createdAt: now,
    });

    return null;
  },
});

/**
 * Records the landlord's address for this case. Owner-only, and the address is
 * validated here so a malformed one cannot reach the send path.
 */
export const setLandlordEmail = mutation({
  args: {
    caseId: v.id("cases"),
    userId: v.id("users"),
    landlordEmail: v.string(),
  },
  handler: async (ctx, args) => {
    await loadCaseForOwner(ctx, args.caseId, args.userId);

    const trimmed = args.landlordEmail.trim();
    if (!isSendableEmail(trimmed)) {
      throw new Error("Enter a valid email address for the landlord.");
    }

    await ctx.db.patch(args.caseId, {
      landlordEmail: trimmed,
      updatedAt: Date.now(),
    });

    return null;
  },
});
