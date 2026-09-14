import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import {
  ASSESSMENT_SCHEMA_NAME,
  ASSESSMENT_SYSTEM_PROMPT,
  assessmentJsonSchema,
  buildAssessmentUserPrompt,
  computePotentiallyDisputableAmount,
  validateAssessment,
} from "./assessment";
import { toSafeMessage } from "./errors";
import { requestStructuredJson } from "./openai";
import { validatedAssessmentValidator } from "./validators";

/**
 * Evidence-based assessment pipeline: deduction + official sources → OpenAI
 * structured reasoning → validated assessment → case totals.
 *
 * Mutations own every database write; the action only does the model call and
 * orchestration, so a failed assessment can never leave a half-written state.
 */

/** Labels sources as S1, S2, … inside the model prompt. */
function sourceLabel(index: number): string {
  return `S${index + 1}`;
}

/** Identifies one assessment pass; see `claimForAssessment`. */
function createAssessmentRunId(): string {
  return `asm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export const claimForAssessment = internalMutation({
  args: { deductionId: v.id("deductions") },
  handler: async (ctx, args) => {
    const deduction = await ctx.db.get(args.deductionId);
    if (!deduction) return null;

    // Only a deduction that is not already being assessed can be claimed;
    // duplicate scheduled runs therefore become no-ops.
    if (deduction.assessmentStatus === "ASSESSING") return null;

    // Without completed research there is no evidence to reason from.
    if (deduction.researchStatus !== "COMPLETED") return null;

    const now = Date.now();
    const runId = createAssessmentRunId();

    // Deliberately single-document. Reading the case or the deduction's sources
    // here would make every sibling assessment contend for rows they all share,
    // and Convex would abort the losers — the failure mode that used to leave a
    // deduction stuck in ASSESSING. `getAssessmentContext` supplies the rest.
    await ctx.db.patch(args.deductionId, {
      assessmentStatus: "ASSESSING",
      assessmentRunId: runId,
      assessmentError: undefined,
      updatedAt: now,
    });

    await ctx.db.insert("timelineEvents", {
      caseId: deduction.caseId,
      type: "ASSESSMENT_STARTED",
      description: `Deduction assessment started — ${deduction.description}`,
      metadata: { deductionId: args.deductionId, runId },
      createdAt: now,
    });

    return { runId, caseId: deduction.caseId };
  },
});

/**
 * Everything an assessment prompt needs about the deduction, its case and the
 * evidence found for it. Kept out of the claim so the claim stays contention-free.
 */
export const getAssessmentContext = internalQuery({
  args: { deductionId: v.id("deductions") },
  handler: async (ctx, args) => {
    const deduction = await ctx.db.get(args.deductionId);
    if (!deduction) return null;

    const caseData = await ctx.db.get(deduction.caseId);
    if (!caseData) return null;

    const sources = await ctx.db
      .query("sources")
      .withIndex("by_deduction", (q) => q.eq("deductionId", args.deductionId))
      .collect();

    return {
      jurisdiction: caseData.jurisdiction,
      depositAmount: caseData.depositAmount,
      description: deduction.description,
      amount: deduction.amount,
      category: deduction.category,
      researchQuestion: deduction.researchQuestion,
      sources: sources.map((source, index) => ({
        id: source._id,
        label: sourceLabel(index),
        title: source.title,
        authority: source.authority,
        jurisdiction: source.jurisdiction,
        relevantText: source.relevantText,
      })),
    };
  },
});

export const assessDeduction = internalAction({
  args: { deductionId: v.id("deductions") },
  handler: async (
    ctx,
    args
  ): Promise<{ assessment: string } | null> => {
    const claim = await ctx.runMutation(internal.assessments.claimForAssessment, {
      deductionId: args.deductionId,
    });

    // Not assessable, or another run already owns the deduction.
    if (!claim) return null;

    try {
      // The claim deliberately touches one document, so the case, the deduction
      // details and the evidence are fetched here instead.
      const context = await ctx.runQuery(internal.assessments.getAssessmentContext, {
        deductionId: args.deductionId,
      });

      if (!context) {
        throw new Error("The case for this deduction could not be found.");
      }

      if (context.sources.length === 0) {
        // No evidence means nothing to reason from; the pipeline records this as
        // a failed pass rather than inventing a conclusion.
        throw new Error("No official source was available to assess this deduction against.");
      }

      const raw = await requestStructuredJson({
        system: ASSESSMENT_SYSTEM_PROMPT,
        user: buildAssessmentUserPrompt(context),
        schemaName: ASSESSMENT_SCHEMA_NAME,
        jsonSchema: assessmentJsonSchema,
      });

      const validated = validateAssessment(raw, {
        deductionAmount: context.amount,
        sources: context.sources.map((source) => ({ label: source.label, id: source.id })),
      });

      if (!validated) {
        throw new Error("The assessment could not be validated against the retrieved evidence.");
      }

      const stored = await ctx.runMutation(internal.assessments.storeAssessment, {
        deductionId: args.deductionId,
        runId: claim.runId,
        assessment: validated,
      });

      // The total is recomputed in a separate transaction so the deduction write
      // above stays contention-free. A failure here only delays the summary, it
      // does not lose the assessment.
      if (stored) {
        await ctx.runMutation(internal.assessments.refreshCaseDisputableTotal, {
          caseId: stored.caseId,
        });
      }

      return stored ? { assessment: stored.assessment } : null;
    } catch (error) {
      const reason = toSafeMessage(error, "The deduction could not be assessed.");

      await ctx.runMutation(internal.assessments.failAssessment, {
        deductionId: args.deductionId,
        runId: claim.runId,
        reason,
      });

      return null;
    }
  },
});

export const storeAssessment = internalMutation({
  args: {
    deductionId: v.id("deductions"),
    runId: v.string(),
    assessment: validatedAssessmentValidator,
  },
  handler: async (ctx, args) => {
    const deduction = await ctx.db.get(args.deductionId);
    if (!deduction) return null;

    // A superseded run must not write over the run that replaced it. This is the
    // real ownership check: the status check below is only a cheap early exit.
    if (deduction.assessmentRunId !== args.runId) return null;

    const caseData = await ctx.db.get(deduction.caseId);
    if (!caseData) return null;

    const now = Date.now();

    // This mutation deliberately touches only the one deduction it owns. Writing
    // the case here would make every sibling assessment contend for the same
    // `cases` document, and Convex would abort the losers after exhausting its
    // retries — which is exactly how a deduction used to end up stranded in
    // ASSESSING. The case totals are recomputed by a separate call below.
    await ctx.db.patch(args.deductionId, {
      assessmentStatus: "COMPLETED",
      assessmentRunId: undefined,
      assessment: args.assessment.assessment,
      assessmentReason: args.assessment.assessmentReason,
      potentiallyDisputableAmount: args.assessment.potentiallyDisputableAmount,
      assessmentSourceIds: args.assessment.assessmentSourceIds,
      assessmentMissingInformation: args.assessment.assessmentMissingInformation,
      assessmentError: undefined,
      assessedAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("timelineEvents", {
      caseId: caseData._id,
      type: "ASSESSMENT_COMPLETED",
      description: `Deduction assessment completed — ${deduction.description}`,
      metadata: {
        deductionId: args.deductionId,
        assessment: args.assessment.assessment,
        potentiallyDisputableAmount: args.assessment.potentiallyDisputableAmount,
      },
      createdAt: now,
    });

    return { assessment: args.assessment.assessment, caseId: caseData._id };
  },
});

/**
 * Recomputes a case's disputable total. Kept as its own mutation so it can be
 * retried independently of the deduction write that triggered it: it reads the
 * whole case, which necessarily makes it contend with sibling assessments.
 */
export const refreshCaseDisputableTotal = internalMutation({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args) => {
    await recalcDisputableTotal(ctx, args.caseId, Date.now());
    return null;
  },
});

export const failAssessment = internalMutation({
  args: {
    deductionId: v.id("deductions"),
    runId: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const deduction = await ctx.db.get(args.deductionId);
    if (!deduction) return null;

    // A superseded run must not fail a deduction a newer run now owns.
    if (deduction.assessmentRunId !== args.runId) return null;

    const now = Date.now();

    // Single-document, like `storeAssessment`: a failing sibling must not be able
    // to abort this write and leave the deduction stuck in ASSESSING.
    await ctx.db.patch(args.deductionId, {
      assessmentStatus: "FAILED",
      assessmentRunId: undefined,
      assessmentError: args.reason,
      updatedAt: now,
    });

    await ctx.db.insert("timelineEvents", {
      caseId: deduction.caseId,
      type: "ASSESSMENT_FAILED",
      description: `Deduction assessment failed — ${deduction.description}`,
      metadata: { deductionId: args.deductionId, reason: args.reason },
      createdAt: now,
    });

    return null;
  },
});

/** Puts a failed assessment back in the queue so it can be retried. */
export const retryAssessment = mutation({
  args: {
    deductionId: v.id("deductions"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const deduction = await ctx.db.get(args.deductionId);
    if (!deduction) throw new Error("Deduction not found");

    const caseData = await ctx.db.get(deduction.caseId);
    if (!caseData) throw new Error("Case not found");
    if (caseData.userId !== args.userId) throw new Error("Unauthorized");

    if (deduction.assessmentStatus === "ASSESSING") {
      throw new Error("An assessment is already running for this deduction");
    }

    const sources = await ctx.db
      .query("sources")
      .withIndex("by_deduction", (q) => q.eq("deductionId", args.deductionId))
      .first();

    if (!sources) {
      throw new Error("This deduction has no official sources to assess against yet");
    }

    await ctx.db.patch(args.deductionId, {
      assessmentStatus: "PENDING",
      assessmentRunId: undefined,
      assessmentError: undefined,
      updatedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.assessments.assessDeduction, {
      deductionId: args.deductionId,
    });

    return null;
  },
});

/**
 * Recomputes the case's disputable total from the stored per-deduction
 * assessments. Shared with the research pipeline, which resets assessments
 * when it replaces the evidence they were built on.
 */
export async function recalcDisputableTotal(
  ctx: MutationCtx,
  caseId: Id<"cases">,
  now: number
): Promise<void> {
  const caseData = await ctx.db.get(caseId);
  if (!caseData) return;

  const deductions = await ctx.db
    .query("deductions")
    .withIndex("by_case", (q) => q.eq("caseId", caseId))
    .collect();

  await ctx.db.patch(caseId, {
    potentiallyDisputableAmount: computePotentiallyDisputableAmount(deductions),
    updatedAt: now,
  });
}
