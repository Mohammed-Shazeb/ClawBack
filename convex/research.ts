import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import { resolveCaller } from "./caller";
import { toSafeMessage } from "./errors";
import {
  authorityLabel,
  classifyAuthority,
  extractRelevantPassage,
  isFirecrawlConfigured,
  MAX_SOURCES_PER_DEDUCTION,
  searchAuthoritative,
} from "./firecrawl";
import { buildResearchKeywordQuery, buildResearchQuestion } from "./questions";

/**
 * Firecrawl research pipeline: deduction → research question → authoritative
 * source → stored evidence.
 *
 * Mutations own every database write; the action only does the provider call
 * and orchestration, so a failed research pass can never leave a half-written
 * deduction.
 */

const PRE_EVIDENCE_STATUSES = ["RECEIVED", "ANALYZING", "RESEARCHING"] as const;

/**
 * Identifies one research pass. Convex mutations are transactional, so a unique
 * value minted inside a mutation is written atomically with the claim.
 */
function createResearchRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Claims a deduction for one research pass.
 *
 * Deliberately narrow: this reads and writes only the deduction row. Sibling
 * deductions of the same case run concurrently, and the case row is shared
 * between them, so touching the case here would make every sibling claim
 * contend for it and make Convex abort and retry the whole batch. Case-level
 * bookkeeping (status, disputable total) therefore lives in the store/fail
 * mutations, which run once per deduction after the provider call settles.
 */
export const claimForResearch = internalMutation({
  args: { deductionId: v.id("deductions") },
  handler: async (ctx, args) => {
    const deduction = await ctx.db.get(args.deductionId);
    if (!deduction) return null;

    // Only a deduction that is not already being researched can be claimed;
    // duplicate scheduled runs therefore become no-ops.
    if (deduction.researchStatus === "RESEARCHING") return null;

    const now = Date.now();

    // Each pass gets its own id. Only the pass that still owns the deduction
    // may write results, so a retry started while an older pass is in flight
    // cannot have its evidence overwritten by the older pass finishing later.
    const runId = createResearchRunId();

    // Re-running research replaces the evidence a previous pass produced, so
    // any assessment built on that evidence is reset with it.
    await ctx.db.patch(args.deductionId, {
      researchStatus: "RESEARCHING",
      researchRunId: runId,
      researchError: undefined,
      assessmentStatus: "PENDING",
      assessmentRunId: undefined,
      assessment: undefined,
      assessmentReason: undefined,
      potentiallyDisputableAmount: undefined,
      assessmentSourceIds: undefined,
      assessmentMissingInformation: undefined,
      assessmentError: undefined,
      assessedAt: undefined,
      updatedAt: now,
    });

    // A start event is an insert into a different table, so it does not make
    // sibling claims contend for the case row.
    await ctx.db.insert("timelineEvents", {
      caseId: deduction.caseId,
      type: "RESEARCH_STARTED",
      description: `Official source research started — ${deduction.description}`,
      metadata: { deductionId: args.deductionId, runId },
      createdAt: now,
    });

    return {
      runId,
      caseId: deduction.caseId,
      description: deduction.description,
      category: deduction.category,
    };
  },
});

export const researchDeduction = internalAction({
  args: { deductionId: v.id("deductions") },
  handler: async (
    ctx,
    args
  ): Promise<{ sourceCount: number } | null> => {
    const claim = await ctx.runMutation(internal.research.claimForResearch, {
      deductionId: args.deductionId,
    });

    // Already being researched by another run.
    if (!claim) return null;

    try {
      if (!isFirecrawlConfigured()) {
        throw new Error("Research is not configured (FIRECRAWL_API_KEY is missing).");
      }

      // The jurisdiction belongs to the case, which the claim deliberately does
      // not read; it is fetched here so the claim mutation stays contention-free.
      const context = await ctx.runQuery(internal.research.getDeductionContext, {
        deductionId: args.deductionId,
      });

      if (!context) {
        throw new Error("The case for this deduction could not be found.");
      }

      const question = buildResearchQuestion({
        jurisdiction: context.jurisdiction,
        description: claim.description,
        category: claim.category,
      });

      // Two queries over the same facts, both filtered by the same authority
      // rule. The prose question is the auditable one, but a real search engine
      // returns little for it — measured live, it produced no official host at
      // all for a deduction where a keyword query surfaced one. Running both is
      // what turns "no sources to assess against" into a real finding.
      const keywordQuery = buildResearchKeywordQuery({
        jurisdiction: context.jurisdiction,
        description: claim.description,
        category: claim.category,
      });

      const [fromQuestion, fromKeywords] = await Promise.all([
        searchAuthoritative(question),
        searchAuthoritative(keywordQuery),
      ]);

      const seenUrls = new Set<string>();
      const official = [...fromQuestion, ...fromKeywords]
        .filter((result) => classifyAuthority(result.url) === "OFFICIAL")
        .filter((result) => {
          if (seenUrls.has(result.url)) return false;
          seenUrls.add(result.url);
          return true;
        })
        .slice(0, MAX_SOURCES_PER_DEDUCTION);

      const stored = await ctx.runMutation(internal.research.storeResearchResults, {
        deductionId: args.deductionId,
        runId: claim.runId,
        question,
        sources: official.map((result) => ({
          title: result.title || result.url,
          url: result.url,
          authority: authorityLabel("OFFICIAL"),
          // Only a passage actually selected out of the retrieved page is
          // stored. The provider's one-line description is a summary, not an
          // authoritative passage, so it is deliberately not used as one.
          relevantText: extractRelevantPassage(result.markdown, claim.description),
        })),
      });

      if (!stored) {
        // The pass lost ownership of the deduction; a newer pass owns the
        // evidence now, so it must not be assessed against this run's sources.
        return null;
      }

      // Only a deduction that actually stored evidence advances the case and
      // moves on to assessment. Both steps are separate transactions so that
      // siblings researching concurrently never contend for the shared rows.
      if (stored.sourceCount > 0) {
        await ctx.runMutation(internal.research.advanceCaseToEvidenceFound, {
          caseId: stored.caseId,
        });

        await ctx.scheduler.runAfter(0, internal.assessments.assessDeduction, {
          deductionId: args.deductionId,
        });
      }

      return { sourceCount: stored.sourceCount };
    } catch (error) {
      const reason = toSafeMessage(error, "Research could not be completed.");

      await ctx.runMutation(internal.research.failResearch, {
        deductionId: args.deductionId,
        runId: claim.runId,
        reason,
      });

      return null;
    }
  },
});

/**
 * Reads just what a research pass needs about the surrounding case. Kept
 * separate from the claim so the claim touches a single document.
 */
export const getDeductionContext = internalQuery({
  args: { deductionId: v.id("deductions") },
  handler: async (ctx, args) => {
    const deduction = await ctx.db.get(args.deductionId);
    if (!deduction) return null;

    const caseData = await ctx.db.get(deduction.caseId);
    if (!caseData) return null;

    return { jurisdiction: caseData.jurisdiction };
  },
});

export const storeResearchResults = internalMutation({
  args: {
    deductionId: v.id("deductions"),
    runId: v.string(),
    question: v.string(),
    sources: v.array(
      v.object({
        title: v.string(),
        url: v.string(),
        authority: v.string(),
        relevantText: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const deduction = await ctx.db.get(args.deductionId);
    if (!deduction || deduction.researchStatus !== "RESEARCHING") return null;

    // A superseded pass must not write: if another pass claimed this deduction
    // after this one started, its evidence is the current one.
    if (deduction.researchRunId !== args.runId) return null;

    const caseData = await ctx.db.get(deduction.caseId);
    if (!caseData) return null;

    const now = Date.now();

    // A research pass replaces whatever a previous pass stored for this
    // deduction, so re-running research cannot create duplicate sources.
    const previous = await ctx.db
      .query("sources")
      .withIndex("by_deduction", (q) => q.eq("deductionId", args.deductionId))
      .collect();

    for (const source of previous) {
      await ctx.db.delete(source._id);
    }

    for (const source of args.sources) {
      await ctx.db.insert("sources", {
        caseId: deduction.caseId,
        deductionId: args.deductionId,
        title: source.title,
        url: source.url,
        authority: source.authority,
        jurisdiction: caseData.jurisdiction,
        relevantText: source.relevantText,
        retrievedAt: now,
        addedAt: now,
      });
    }

    await ctx.db.patch(args.deductionId, {
      researchStatus: "COMPLETED",
      researchRunId: undefined,
      researchQuestion: args.question,
      researchError: undefined,
      updatedAt: now,
    });

    await ctx.db.insert("timelineEvents", {
      caseId: caseData._id,
      type: "RESEARCH_COMPLETED",
      description:
        args.sources.length > 0
          ? `Official source research completed — ${args.sources.length} source${
              args.sources.length === 1 ? "" : "s"
            } found`
          : "Official source research completed — no authoritative source found",
      metadata: { deductionId: args.deductionId, sourceCount: args.sources.length, runId: args.runId },
      createdAt: now,
    });

    // The case advance happens in `advanceCaseToEvidenceFound`, not here: it
    // writes the shared case row, which every sibling deduction also touches.
    return { sourceCount: args.sources.length, caseId: caseData._id };
  },
});

/**
 * Moves a case forward to EVIDENCE_FOUND once evidence exists, without ever
 * dragging it backwards. Separate from the deduction writes so the shared case
 * row is only ever touched by one small, retryable transaction.
 */
export const advanceCaseToEvidenceFound = internalMutation({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args) => {
    const caseData = await ctx.db.get(args.caseId);
    if (!caseData) return null;

    if (
      !PRE_EVIDENCE_STATUSES.includes(caseData.status as (typeof PRE_EVIDENCE_STATUSES)[number])
    ) {
      return null;
    }

    await ctx.db.patch(args.caseId, { status: "EVIDENCE_FOUND", updatedAt: Date.now() });
    return null;
  },
});

export const failResearch = internalMutation({
  args: {
    deductionId: v.id("deductions"),
    runId: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const deduction = await ctx.db.get(args.deductionId);
    if (!deduction || deduction.researchStatus !== "RESEARCHING") return null;

    // A superseded pass must not mark the deduction failed after a newer pass
    // has taken over.
    if (deduction.researchRunId !== args.runId) return null;

    const now = Date.now();

    await ctx.db.patch(args.deductionId, {
      researchStatus: "FAILED",
      researchRunId: undefined,
      researchError: args.reason,
      updatedAt: now,
    });

    // The case id is already on the deduction; reading the case row here would
    // make a failing sibling contend with the case writes of a succeeding one.
    await ctx.db.insert("timelineEvents", {
      caseId: deduction.caseId,
      type: "RESEARCH_FAILED",
      description: `Official source research failed — ${deduction.description}`,
      metadata: { deductionId: args.deductionId, reason: args.reason },
      createdAt: now,
    });

    return null;
  },
});

/** Re-runs research for one deduction, replacing the evidence it stored. */
export const retryResearch = mutation({
  args: {
    deductionId: v.id("deductions"),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const callerId = await resolveCaller(ctx, args.userId);

    const deduction = await ctx.db.get(args.deductionId);
    if (!deduction) throw new Error("Deduction not found");

    const caseData = await ctx.db.get(deduction.caseId);
    if (!caseData) throw new Error("Case not found");
    if (caseData.userId !== callerId) throw new Error("Unauthorized");

    if (deduction.researchStatus === "RESEARCHING") {
      throw new Error("Research is already running for this deduction");
    }

    await ctx.db.patch(args.deductionId, {
      researchStatus: "PENDING",
      researchRunId: undefined,
      researchError: undefined,
      updatedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.research.researchDeduction, {
      deductionId: args.deductionId,
    });

    return null;
  },
});
