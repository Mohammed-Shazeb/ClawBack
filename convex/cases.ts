import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { caseInboxLocalPart, createCaseInbox } from "./agentmail";
import { resolveCaller, resolveCallerInAction } from "./caller";
import { toSafeMessage } from "./errors";

export const create = mutation({
  args: {
    userId: v.optional(v.id("users")),
    jurisdiction: v.string(),
    depositAmount: v.number(),
    totalDeductions: v.number(),
  },
  handler: async (ctx, args) => {
    const callerId = await resolveCaller(ctx, args.userId);
    if (args.depositAmount < 0 || args.totalDeductions < 0) {
      throw new Error("Amounts cannot be negative");
    }

    const now = Date.now();

    const caseId = await ctx.db.insert("cases", {
      userId: callerId,
      jurisdiction: args.jurisdiction,
      depositAmount: args.depositAmount,
      totalDeductions: args.totalDeductions,
      potentiallyDisputableAmount: 0,
      status: "RECEIVED",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("timelineEvents", {
      caseId,
      type: "CASE_CREATED",
      description: "Case received",
      createdAt: now,
    });

    return caseId;
  },
});

export const list = query({
  args: {
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const callerId = await resolveCaller(ctx, args.userId);

    const cases = await ctx.db
      .query("cases")
      .withIndex("by_user", (q) => q.eq("userId", callerId))
      .order("desc")
      .collect();

    return cases;
  },
});

export const get = query({
  args: {
    caseId: v.id("cases"),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const callerId = await resolveCaller(ctx, args.userId);
    const caseData = await ctx.db.get(args.caseId);

    if (!caseData) {
      return null;
    }

    if (caseData.userId !== callerId) {
      throw new Error("Unauthorized");
    }

    return caseData;
  },
});

export const getTimeline = query({
  args: {
    caseId: v.id("cases"),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const callerId = await resolveCaller(ctx, args.userId);
    const caseData = await ctx.db.get(args.caseId);

    if (!caseData) {
      throw new Error("Case not found");
    }

    if (caseData.userId !== callerId) {
      throw new Error("Unauthorized");
    }

    const events = await ctx.db
      .query("timelineEvents")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .order("asc")
      .collect();

    return events;
  },
});

/**
 * Creates a case and gives it its own inbound email address.
 *
 * Provisioning is best effort: a case that exists without an address is still
 * usable, and the failure is recorded on the case instead of being hidden.
 */
export const createWithInbox = action({
  args: {
    userId: v.optional(v.id("users")),
    jurisdiction: v.string(),
    depositAmount: v.number(),
    totalDeductions: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"cases">> => {
    // Resolve here so the id handed to the mutation is already derived, never
    // the client's claim; the mutation re-resolves and reaches the same answer.
    const callerId = await resolveCallerInAction(ctx, args.userId);

    const caseId = await ctx.runMutation(api.cases.create, {
      ...args,
      userId: callerId,
    });

    // Awaited: an unawaited operation in an action may never run, which would
    // leave the case without its inbox.
    await provisionInbox(ctx, caseId);

    return caseId;
  },
});

/** Retries address setup for a case whose provisioning failed. */
export const retryInboxProvision = action({
  args: {
    caseId: v.id("cases"),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args): Promise<string | null> => {
    const callerId = await resolveCallerInAction(ctx, args.userId);

    const caseData = await ctx.runQuery(api.cases.get, {
      caseId: args.caseId,
      userId: callerId,
    });

    if (!caseData) throw new Error("Case not found");
    if (caseData.inboxId) return caseData.inboxId;

    return await provisionInbox(ctx, args.caseId);
  },
});

export const attachInbox = internalMutation({
  args: {
    caseId: v.id("cases"),
    inboxId: v.string(),
  },
  handler: async (ctx, args) => {
    const caseData = await ctx.db.get(args.caseId);
    if (!caseData) throw new Error("Case not found");

    const now = Date.now();

    await ctx.db.patch(args.caseId, {
      inboxId: args.inboxId,
      inboxStatus: "READY",
      inboxError: undefined,
      updatedAt: now,
    });

    await ctx.db.insert("timelineEvents", {
      caseId: args.caseId,
      type: "INBOX_READY",
      description: "Case email address ready",
      metadata: { inboxId: args.inboxId },
      createdAt: now,
    });

    return args.inboxId;
  },
});

export const markInboxFailed = internalMutation({
  args: {
    caseId: v.id("cases"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const caseData = await ctx.db.get(args.caseId);
    if (!caseData) throw new Error("Case not found");

    const now = Date.now();

    await ctx.db.patch(args.caseId, {
      inboxStatus: "FAILED",
      inboxError: args.reason,
      updatedAt: now,
    });

    await ctx.db.insert("timelineEvents", {
      caseId: args.caseId,
      type: "INBOX_FAILED",
      description: "Case email address could not be set up",
      metadata: { reason: args.reason },
      createdAt: now,
    });

    return null;
  },
});

async function provisionInbox(ctx: ActionCtx, caseId: Id<"cases">): Promise<string | null> {
  try {
    const inbox = await createCaseInbox({
      caseId,
      localPart: caseInboxLocalPart(caseId),
    });

    await ctx.runMutation(internal.cases.attachInbox, {
      caseId,
      inboxId: inbox.inboxId,
    });

    return inbox.inboxId;
  } catch (error) {
    await ctx.runMutation(internal.cases.markInboxFailed, {
      caseId,
      reason: toSafeMessage(error, "The case email address could not be set up."),
    });

    return null;
  }
}
