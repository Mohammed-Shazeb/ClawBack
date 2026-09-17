import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalAction, internalMutation, mutation } from "./_generated/server";
import { toSafeMessage } from "./errors";
import { requestStructuredJson } from "./openai";
import {
  buildResponseAnalysisUserPrompt,
  RESPONSE_ANALYSIS_SCHEMA_NAME,
  RESPONSE_ANALYSIS_SYSTEM_PROMPT,
  responseAnalysisJsonSchema,
  validateResponseAnalysis,
} from "./response";
import { responseAnalysisValidator } from "./validators";

/**
 * Reading a landlord's reply.
 *
 * The reply itself is stored the moment it arrives, by `emails.ingestInbound`.
 * This module only adds a structured reading on top, and a reply with no
 * reading is still a reply — a failed or unconfigured model never loses the
 * landlord's message.
 *
 * Concurrency discipline: the claim and the store each touch one document (the
 * reply), and the case is only patched for its `updatedAt` by the ingestion
 * path. No shared-row recomputation happens here.
 */

/** The reply context the model needs, read fresh at claim time. */
export const claimResponseAnalysis = internalMutation({
  args: { emailId: v.id("emails") },
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);
    if (!email || email.direction !== "INBOUND") return null;

    // Only a stored reply is readable, and only while it is unread or failed.
    if (!email.isReply) return null;
    if (
      email.responseAnalysisStatus !== "PENDING" &&
      email.responseAnalysisStatus !== "FAILED"
    ) {
      return null;
    }

    const caseId = email.caseId;
    if (!caseId) return null;

    const caseData = await ctx.db.get(caseId);
    if (!caseData) return null;

    const now = Date.now();

    await ctx.db.patch(email._id, {
      responseAnalysisStatus: "ANALYZING",
      responseAnalysisError: undefined,
      updatedAt: now,
    });

    return {
      emailId: email._id,
      caseId,
      sender: email.sender,
      subject: email.subject,
      body: email.body,
      context: {
        jurisdiction: caseData.jurisdiction,
        depositAmount: caseData.depositAmount,
        totalDeductions: caseData.totalDeductions,
        potentiallyDisputableAmount: caseData.potentiallyDisputableAmount,
        letterSubject: await latestSentLetterSubject(ctx, caseId),
      },
    };
  },
});

/**
 * The subject of the dispute this reply answers, so the model can tell which
 * conversation it is reading. Undefined when no dispute has been sent.
 */
async function latestSentLetterSubject(
  ctx: MutationCtx,
  caseId: Id<"cases">
): Promise<string | undefined> {
  const letter = await ctx.db
    .query("letters")
    .withIndex("by_case_and_status", (q) => q.eq("caseId", caseId).eq("status", "SENT"))
    .first();

  return letter?.subject;
}

/**
 * Stores a validated reading. Guarded on ANALYZING so a replayed action cannot
 * overwrite a newer reading, and on the reply still existing.
 */
export const storeResponseAnalysis = internalMutation({
  args: {
    emailId: v.id("emails"),
    analysis: responseAnalysisValidator,
  },
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);
    if (!email) return null;
    if (email.responseAnalysisStatus !== "ANALYZING") return null;

    const caseId = email.caseId;
    if (!caseId) return null;

    const now = Date.now();

    await ctx.db.patch(email._id, {
      responseAnalysis: args.analysis,
      responseAnalysisStatus: "COMPLETED",
      responseAnalysisError: undefined,
      responseAnalyzedAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("timelineEvents", {
      caseId,
      type: "RESPONSE_ANALYZED",
      description: "Landlord response analyzed",
      metadata: { emailId: email._id },
      createdAt: now,
    });

    return { caseId };
  },
});

/**
 * Records a failed reading. The reply stays stored and readable; only the
 * analysis is marked failed, so the UI can offer a retry without implying the
 * landlord's message was lost.
 */
export const failResponseAnalysis = internalMutation({
  args: { emailId: v.id("emails"), reason: v.string() },
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);
    if (!email) return null;
    if (email.responseAnalysisStatus !== "ANALYZING") return null;

    await ctx.db.patch(email._id, {
      responseAnalysisStatus: "FAILED",
      responseAnalysisError: args.reason,
      updatedAt: Date.now(),
    });

    return null;
  },
});

/**
 * Reads the reply with the model. The action only orchestrates and calls the
 * provider; both writes are mutations, so a failed call cannot leave a
 * half-written reading.
 */
export const analyzeLandlordResponse = internalAction({
  args: { emailId: v.id("emails") },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    const claim = await ctx.runMutation(internal.responses.claimResponseAnalysis, {
      emailId: args.emailId,
    });

    // Already read, not a reply, or not attached to a case.
    if (!claim) return { ok: false, reason: "This response is not awaiting analysis." };

    if (!claim.body.trim()) {
      await ctx.runMutation(internal.responses.failResponseAnalysis, {
        emailId: args.emailId,
        reason: "The reply did not contain any readable text.",
      });

      return { ok: false, reason: "The reply did not contain any readable text." };
    }

    try {
      const raw = await requestStructuredJson({
        system: RESPONSE_ANALYSIS_SYSTEM_PROMPT,
        user: buildResponseAnalysisUserPrompt({
          context: claim.context,
          message: {
            sender: claim.sender,
            subject: claim.subject,
            body: claim.body,
          },
        }),
        schemaName: RESPONSE_ANALYSIS_SCHEMA_NAME,
        jsonSchema: responseAnalysisJsonSchema,
      });

      const validated = validateResponseAnalysis(raw, {
        depositAmount: claim.context.depositAmount,
      });

      if (!validated) {
        throw new Error(
          "The reply could not be read reliably, so no reading was stored."
        );
      }

      await ctx.runMutation(internal.responses.storeResponseAnalysis, {
        emailId: args.emailId,
        analysis: validated,
      });

      return { ok: true };
    } catch (error) {
      const reason = toSafeMessage(error, "The landlord's reply could not be read.");

      await ctx.runMutation(internal.responses.failResponseAnalysis, {
        emailId: args.emailId,
        reason,
      });

      return { ok: false, reason };
    }
  },
});

/**
 * Re-runs the reading for a reply whose analysis failed. Owner-only, so one
 * renter cannot trigger work on another's case.
 */
export const retryResponseAnalysis = mutation({
  args: {
    emailId: v.id("emails"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);
    if (!email) throw new Error("Message not found");
    if (!email.caseId) throw new Error("This message is not attached to a case");

    const caseData = await ctx.db.get(email.caseId);
    if (!caseData) throw new Error("Case not found");
    if (caseData.userId !== args.userId) throw new Error("Unauthorized");

    if (!email.isReply) throw new Error("Only a landlord reply can be analyzed");
    if (email.responseAnalysisStatus === "COMPLETED") {
      throw new Error("This reply has already been read");
    }

    await ctx.db.patch(email._id, {
      responseAnalysisStatus: "PENDING",
      responseAnalysisError: undefined,
      updatedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.responses.analyzeLandlordResponse, {
      emailId: email._id,
    });

    return null;
  },
});
