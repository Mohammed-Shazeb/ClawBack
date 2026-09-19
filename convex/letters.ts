import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalAction, internalMutation, mutation, query } from "./_generated/server";
import { resolveCaller } from "./caller";
import { toSafeMessage } from "./errors";
import {
  buildLetterUserPrompt,
  hasLetterEvidence,
  INSUFFICIENT_EVIDENCE_MESSAGE,
  LETTER_SCHEMA_NAME,
  LETTER_SYSTEM_PROMPT,
  letterJsonSchema,
  type LetterDeductionInput,
  validateLetterWithReason,
} from "./letter";
import { requestStructuredJson } from "./openai";

/**
 * Evidence-backed dispute letter pipeline: assessed deductions + stored sources
 * → OpenAI → validated draft → human review → approval.
 *
 * Scope guard: this milestone deliberately stops at APPROVED. Nothing here
 * contacts the landlord; outbound sending is the next milestone's job.
 *
 * Concurrency discipline (learned the hard way in Milestone 3): every mutation
 * writes a single document. Writes to the shared `cases` row are isolated in
 * their own small mutations so a concurrent sibling can never abort a letter
 * write and strand it in a generating state.
 */

/** Identifies one generation pass; see `claimGeneration`. */
function createGenerationRunId(): string {
  return `ltr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Case statuses from which drafting a letter is a forward move. */
const PRE_DRAFT_STATUSES = ["RECEIVED", "ANALYZING", "RESEARCHING", "EVIDENCE_FOUND"] as const;

/** Case statuses from which presenting a letter for approval is a forward move. */
const PRE_APPROVAL_STATUSES = [
  "RECEIVED",
  "ANALYZING",
  "RESEARCHING",
  "EVIDENCE_FOUND",
  "DRAFT_READY",
] as const;

/**
 * Loads everything generation needs and verifies the caller owns the case.
 *
 * Ownership is checked here from the stored `userId`, never from anything the
 * client supplied beyond the id it claims to be.
 */
async function loadCaseForOwner(
  ctx: QueryCtx,
  caseId: Id<"cases">,
  userId: Id<"users">
) {
  const caseData = await ctx.db.get(caseId);
  if (!caseData) throw new Error("Case not found");
  if (caseData.userId !== userId) throw new Error("Unauthorized");

  return caseData;
}

/**
 * The letter currently on the case, or null. A case has at most one *live*
 * letter: regeneration updates that record, and starting a new draft archives
 * the old one, so the workflow never accumulates ambiguous duplicates.
 */
export const getForCase = query({
  args: {
    caseId: v.id("cases"),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const callerId = await resolveCaller(ctx, args.userId);
    await loadCaseForOwner(ctx, args.caseId, callerId);

    return await resolveLiveLetter(ctx, args.caseId);
  },
});

/**
 * The case's live letter: the newest one that has not been archived by a
 * "start new draft". Every read path goes through this so an archived letter
 * can never be edited, approved or regenerated again.
 */
async function resolveLiveLetter(ctx: QueryCtx | MutationCtx, caseId: Id<"cases">) {
  const letters = await ctx.db
    .query("letters")
    .withIndex("by_case", (q) => q.eq("caseId", caseId))
    .order("desc")
    .collect();

  return letters.find((letter) => letter.archivedAt === undefined) ?? null;
}

/**
 * The evidence the letter rests on, in the shape the UI's evidence panel needs.
 * Only sources belonging to this case are ever returned.
 */
export const getSupportingSources = query({
  args: {
    caseId: v.id("cases"),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const callerId = await resolveCaller(ctx, args.userId);
    await loadCaseForOwner(ctx, args.caseId, callerId);

    const letter = await resolveLiveLetter(ctx, args.caseId);

    if (!letter || letter.supportingSourceIds.length === 0) return [];

    const sources = await Promise.all(
      letter.supportingSourceIds.map((sourceId) => ctx.db.get(sourceId))
    );

    // A source may have been replaced by a later research pass; those simply
    // drop out rather than being shown as if they still existed. The predicate
    // is explicitly typed so callers receive non-null sources.
    return sources.filter(
      (source): source is NonNullable<typeof source> =>
        source !== null && source.caseId === args.caseId
    );
  },
});

/**
 * Whether a letter can be drafted at all, plus why not when it cannot. Lets the
 * UI explain the real reason instead of showing a button that will fail.
 */
export const getDraftReadiness = query({
  args: {
    caseId: v.id("cases"),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const callerId = await resolveCaller(ctx, args.userId);
    await loadCaseForOwner(ctx, args.caseId, callerId);

    const deductions = await ctx.db
      .query("deductions")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    const sources = await ctx.db
      .query("sources")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    if (deductions.length === 0) {
      return { ready: false, reason: "No deductions have been extracted for this case yet." };
    }

    const assessmentsPending = deductions.some(
      (deduction) => deduction.assessmentStatus !== "COMPLETED"
    );

    if (!hasLetterEvidence(deductions)) {
      return {
        ready: false,
        reason: INSUFFICIENT_EVIDENCE_MESSAGE,
        assessmentsPending,
      };
    }

    if (sources.length === 0) {
      return { ready: false, reason: INSUFFICIENT_EVIDENCE_MESSAGE };
    }

    return { ready: true, reason: null as string | null, assessmentsPending };
  },
});

/**
 * Claims one generation pass for a case.
 *
 * Single-document on purpose: it reads and writes only the letter row (or
 * inserts one), so two passes for the same case serialise on that row rather
 * than contending for the case. Returns the run id and everything the model
 * call needs.
 */
export const claimGeneration = internalMutation({
  args: {
    caseId: v.id("cases"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const caseData = await loadCaseForOwner(ctx, args.caseId, args.userId);

    const deductions = await ctx.db
      .query("deductions")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    if (deductions.length === 0) {
      throw new Error("No deductions have been extracted for this case yet.");
    }

    const sources = await ctx.db
      .query("sources")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    // The model reasons from evidence this case actually has.
    if (!hasLetterEvidence(deductions) || sources.length === 0) {
      throw new Error(INSUFFICIENT_EVIDENCE_MESSAGE);
    }

    const existing = await resolveLiveLetter(ctx, args.caseId);

    // A finalised letter is immutable: approved (the renter signed off on this
    // text) or sent (the landlord already holds a copy). Regenerating in place
    // would rewrite a document that has left the building, so the renter must
    // explicitly start a new draft instead.
    if (existing && (existing.status === "APPROVED" || existing.status === "SENT")) {
      throw new Error(
        existing.status === "SENT"
          ? "This letter has already been sent and can no longer be regenerated. Start a new draft to send a revision."
          : "This letter has been approved and can no longer be regenerated. Start a new draft to revise it."
      );
    }

    // A generation already in flight owns the letter.
    if (existing && existing.pipelineStatus === "GENERATING") {
      throw new Error("A letter is already being generated for this case.");
    }

    const now = Date.now();
    const runId = createGenerationRunId();

    let letterId: Id<"letters">;
    if (existing) {
      await ctx.db.patch(existing._id, {
        pipelineStatus: "GENERATING",
        pipelineError: undefined,
        generationRunId: runId,
        updatedAt: now,
      });
      letterId = existing._id;
    } else {
      letterId = await ctx.db.insert("letters", {
        caseId: caseData._id,
        content: "",
        recipient: "",
        subject: "",
        body: "",
        version: 0,
        status: "DRAFT",
        pipelineStatus: "GENERATING",
        generationRunId: runId,
        supportingSourceIds: [],
        depositAmount: caseData.depositAmount,
        totalDeductions: caseData.totalDeductions,
        potentiallyDisputableAmount: caseData.potentiallyDisputableAmount,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Labelling is positional and deterministic, and the labels are what the
    // model is allowed to reference. The real ids never leave the server.
    const labelled = sources.map((source, index) => ({ label: `S${index + 1}`, source }));
    const labelById = new Map(labelled.map(({ label, source }) => [source._id, label]));

    const deductionInputs: LetterDeductionInput[] = deductions.map((deduction) => ({
      description: deduction.description,
      amount: deduction.amount,
      category: deduction.category,
      assessment: deduction.assessment,
      assessmentReason: deduction.assessmentReason,
      potentiallyDisputableAmount: deduction.potentiallyDisputableAmount,
      missingInformation: deduction.assessmentMissingInformation ?? [],
      sourceLabels: (deduction.assessmentSourceIds ?? [])
        .map((sourceId) => labelById.get(sourceId))
        .filter((label): label is string => label !== undefined),
    }));

    return {
      runId,
      letterId,
      jurisdiction: caseData.jurisdiction,
      depositAmount: caseData.depositAmount,
      totalDeductions: caseData.totalDeductions,
      potentiallyDisputableAmount: caseData.potentiallyDisputableAmount,
      deductions: deductionInputs,
      sources: labelled.map(({ label, source }) => ({
        label,
        id: source._id,
        title: source.title,
        authority: source.authority,
        jurisdiction: source.jurisdiction,
        relevantText: source.relevantText,
      })),
    };
  },
});

/**
 * Stores a validated draft. Guarded by the run id so a superseded pass cannot
 * overwrite a newer draft, and by status so an approved letter can never be
 * overwritten by a late finish.
 */
export const storeGeneratedLetter = internalMutation({
  args: {
    letterId: v.id("letters"),
    runId: v.string(),
    recipient: v.string(),
    subject: v.string(),
    body: v.string(),
    supportingSourceIds: v.array(v.id("sources")),
  },
  handler: async (ctx, args) => {
    const letter = await ctx.db.get(args.letterId);
    if (!letter) return null;

    // Ownership of the pass.
    if (letter.generationRunId !== args.runId) return null;

    // An approved letter is immutable, even if a generation was somehow in flight.
    if (letter.status === "APPROVED") return null;

    const caseData = await ctx.db.get(letter.caseId);
    if (!caseData) return null;

    const now = Date.now();

    // Only sources that belong to this case may be cited. This is the check
    // that makes it impossible for a letter to reference another user's source.
    const verified: Id<"sources">[] = [];
    for (const sourceId of args.supportingSourceIds) {
      const source = await ctx.db.get(sourceId);
      if (source && source.caseId === letter.caseId) verified.push(sourceId);
    }

    const content = composeLetterContent({
      recipient: args.recipient,
      subject: args.subject,
      body: args.body,
    });

    await ctx.db.patch(args.letterId, {
      recipient: args.recipient,
      subject: args.subject,
      body: args.body,
      content,
      // A regenerated draft is a new version of the document.
      version: letter.version + 1,
      status: "DRAFT",
      pipelineStatus: "READY",
      pipelineError: undefined,
      generationRunId: undefined,
      supportingSourceIds: verified,
      // Refresh the figures the draft was built from.
      depositAmount: caseData.depositAmount,
      totalDeductions: caseData.totalDeductions,
      potentiallyDisputableAmount: caseData.potentiallyDisputableAmount,
      // The stored text is exactly what the model produced.
      editedAt: undefined,
      updatedAt: now,
      approvedAt: undefined,
    });

    await ctx.db.insert("timelineEvents", {
      caseId: letter.caseId,
      type: letter.version === 0 ? "LETTER_DRAFTED" : "LETTER_UPDATED",
      description:
        letter.version === 0
          ? "Dispute letter drafted"
          : `Dispute letter updated — draft v${letter.version + 1}`,
      metadata: {
        letterId: args.letterId,
        version: letter.version + 1,
        supportingSourceCount: verified.length,
      },
      createdAt: now,
    });

    return { version: letter.version + 1, caseId: letter.caseId };
  },
});

/** Records a failed generation pass so the UI can show the real reason. */
export const failGeneration = internalMutation({
  args: {
    letterId: v.id("letters"),
    runId: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const letter = await ctx.db.get(args.letterId);
    if (!letter) return null;
    if (letter.generationRunId !== args.runId) return null;

    await ctx.db.patch(args.letterId, {
      pipelineStatus: "FAILED",
      pipelineError: args.reason,
      generationRunId: undefined,
      updatedAt: Date.now(),
    });

    return null;
  },
});

/**
 * Moves a case forward to DRAFT_READY. Separate, small and forward-only so a
 * concurrent sibling write can never abort the letter write that triggered it.
 */
export const advanceCaseToDraftReady = internalMutation({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args) => {
    const caseData = await ctx.db.get(args.caseId);
    if (!caseData) return null;

    if (!PRE_DRAFT_STATUSES.includes(caseData.status as (typeof PRE_DRAFT_STATUSES)[number])) {
      return null;
    }

    await ctx.db.patch(args.caseId, { status: "DRAFT_READY", updatedAt: Date.now() });
    return null;
  },
});

/**
 * Generates (or regenerates) the dispute letter.
 *
 * The action only orchestrates and calls the provider; every database write is
 * a mutation, so a failed model call can never leave a half-written letter.
 */
export const generateLetter = internalAction({
  args: {
    caseId: v.id("cases"),
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    let claim;
    try {
      claim = await ctx.runMutation(internal.letters.claimGeneration, {
        caseId: args.caseId,
        userId: args.userId,
      });
    } catch (error) {
      // A refusal here is a real reason (no evidence, already approved), not a
      // crash, so it is surfaced as-is.
      return { ok: false, reason: toSafeMessage(error, "The letter could not be started.") };
    }

    try {
      const raw = await requestStructuredJson({
        system: LETTER_SYSTEM_PROMPT,
        user: buildLetterUserPrompt({
          jurisdiction: claim.jurisdiction,
          depositAmount: claim.depositAmount,
          totalDeductions: claim.totalDeductions,
          potentiallyDisputableAmount: claim.potentiallyDisputableAmount,
          deductions: claim.deductions,
          sources: claim.sources,
        }),
        schemaName: LETTER_SCHEMA_NAME,
        jsonSchema: letterJsonSchema,
      });

      const validated = validateLetterWithReason(raw, {
        sources: claim.sources.map((source) => ({ label: source.label, id: source.id })),
      });

      // Name the rule that fired. "Did not meet the requirements" alone is
      // indistinguishable from a one-off bad completion, so a systematic
      // conflict between the prompt and the validator would never be noticed.
      if (!validated.ok) {
        throw new Error(
          `The drafted letter did not meet the evidence and language requirements — ${validated.reason} — so it was not saved.`
        );
      }

      const stored = await ctx.runMutation(internal.letters.storeGeneratedLetter, {
        letterId: claim.letterId,
        runId: claim.runId,
        recipient: validated.letter.recipient,
        subject: validated.letter.subject,
        body: validated.letter.body,
        supportingSourceIds: validated.letter.supportingSourceIds,
      });

      if (!stored) {
        // The pass lost ownership (a newer pass took over, or the letter was
        // approved while this one ran). Nothing to do but step aside.
        return { ok: false, reason: "This draft was superseded by a newer one." };
      }

      // Forward-only case transition, in its own transaction.
      await ctx.runMutation(internal.letters.advanceCaseToDraftReady, {
        caseId: stored.caseId,
      });

      return { ok: true };
    } catch (error) {
      const reason = toSafeMessage(error, "The dispute letter could not be drafted.");

      await ctx.runMutation(internal.letters.failGeneration, {
        letterId: claim.letterId,
        runId: claim.runId,
        reason,
      });

      return { ok: false, reason };
    }
  },
});

/**
 * Queues drafting for the case owner. The caller is resolved here and the
 * derived id is what travels to the scheduled action, so generation can only
 * ever run against the caller's own case.
 */
export const draftLetter = mutation({
  args: {
    caseId: v.id("cases"),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args): Promise<null> => {
    const callerId = await resolveCaller(ctx, args.userId);
    await loadCaseForOwner(ctx, args.caseId, callerId);

    await ctx.scheduler.runAfter(0, internal.letters.generateLetter, {
      caseId: args.caseId,
      userId: callerId,
    });

    return null;
  },
});

/**
 * Saves renter edits. This is the only path that changes the stored text
 * without regenerating, and it is explicit: the UI must call it from a Save
 * action, so an in-progress edit can never overwrite the draft by accident.
 */
export const saveLetterEdits = mutation({
  args: {
    caseId: v.id("cases"),
    userId: v.optional(v.id("users")),
    recipient: v.string(),
    subject: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const callerId = await resolveCaller(ctx, args.userId);
    const caseData = await loadCaseForOwner(ctx, args.caseId, callerId);

    const letter = await resolveLiveLetter(ctx, args.caseId);

    if (!letter) throw new Error("There is no letter to save yet.");
    if (letter.pipelineStatus !== "READY") {
      throw new Error("The letter is not ready to edit yet.");
    }

    const recipient = args.recipient.trim();
    const subject = args.subject.trim();
    const body = args.body.trim();

    if (recipient.length === 0) throw new Error("The letter needs a recipient.");
    if (subject.length === 0) throw new Error("The letter needs a subject.");
    if (body.length < 200) throw new Error("The letter body is too short to be a valid letter.");

    // An approved letter is immutable until the renter explicitly starts a new
    // draft; silently editing an approved document would break that promise.
    if (letter.status === "APPROVED") {
      throw new Error(
        "This letter has been approved and can no longer be edited. Start a new draft to revise it."
      );
    }

    const now = Date.now();

    await ctx.db.patch(letter._id, {
      recipient: recipient.slice(0, 200),
      subject: subject.slice(0, 300),
      body: body.slice(0, 20_000),
      content: composeLetterContent({ recipient, subject, body }),
      version: letter.version + 1,
      // Editing returns the letter to a draft that the owner must re-present.
      status: "DRAFT",
      editedAt: now,
      updatedAt: now,
      approvedAt: undefined,
    });

    await ctx.db.insert("timelineEvents", {
      caseId: caseData._id,
      type: "LETTER_UPDATED",
      description: `Dispute letter updated — saved v${letter.version + 1}`,
      metadata: { letterId: letter._id, version: letter.version + 1, edited: true },
      createdAt: now,
    });

    return { version: letter.version + 1 };
  },
});

/**
 * Presents the letter for approval.
 *
 * This is a real human step: it moves the case to AWAITING_APPROVAL and the
 * letter to AWAITING_APPROVAL. Nothing is sent.
 */
export const presentForApproval = mutation({
  args: {
    caseId: v.id("cases"),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const callerId = await resolveCaller(ctx, args.userId);
    const caseData = await loadCaseForOwner(ctx, args.caseId, callerId);

    const letter = await resolveLiveLetter(ctx, args.caseId);

    if (!letter) throw new Error("There is no letter to present for approval yet.");
    if (letter.pipelineStatus !== "READY") {
      throw new Error("The letter is not ready for approval yet.");
    }
    if (letter.status === "APPROVED" || letter.status === "SENT") {
      throw new Error("This letter has already been approved.");
    }
    if (letter.status === "AWAITING_APPROVAL") return null;

    const now = Date.now();

    await ctx.db.patch(letter._id, {
      status: "AWAITING_APPROVAL",
      updatedAt: now,
    });

    // Forward-only; a case already past this point is left where it is.
    if (
      PRE_APPROVAL_STATUSES.includes(
        caseData.status as (typeof PRE_APPROVAL_STATUSES)[number]
      )
    ) {
      await ctx.db.patch(args.caseId, { status: "AWAITING_APPROVAL", updatedAt: now });
    }

    await ctx.db.insert("timelineEvents", {
      caseId: args.caseId,
      type: "LETTER_PRESENTED_FOR_APPROVAL",
      description: "Dispute letter presented for approval",
      metadata: { letterId: letter._id, version: letter.version },
      createdAt: now,
    });

    return null;
  },
});

/**
 * Human approval. Explicit, owner-only, and it does **not** send anything.
 *
 * Sending belongs to the next milestone; this only marks the letter approved
 * and the case SENT-ready, which is what the UI reports.
 */
export const approveLetter = mutation({
  args: {
    caseId: v.id("cases"),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const callerId = await resolveCaller(ctx, args.userId);
    const caseData = await loadCaseForOwner(ctx, args.caseId, callerId);

    const letter = await resolveLiveLetter(ctx, args.caseId);

    if (!letter) throw new Error("There is no letter to approve yet.");
    if (letter.pipelineStatus !== "READY") {
      throw new Error("The letter is not ready to approve yet.");
    }
    if (letter.status === "APPROVED") return null;
    if (letter.status === "SENT") throw new Error("This letter has already been sent.");

    const now = Date.now();

    await ctx.db.patch(letter._id, {
      status: "APPROVED",
      approvedAt: now,
      updatedAt: now,
      // Completing the pass: no future generation may claim this letter.
      generationRunId: undefined,
    });

    // The case is now waiting to be sent, which is the next milestone's step.
    // It is never marked SENT here.
    if (
      PRE_APPROVAL_STATUSES.includes(
        caseData.status as (typeof PRE_APPROVAL_STATUSES)[number]
      ) ||
      caseData.status === "AWAITING_APPROVAL"
    ) {
      await ctx.db.patch(args.caseId, { status: "AWAITING_APPROVAL", updatedAt: now });
    }

    await ctx.db.insert("timelineEvents", {
      caseId: args.caseId,
      type: "LETTER_APPROVED",
      description: "Dispute letter approved — ready to send",
      metadata: { letterId: letter._id, version: letter.version },
      createdAt: now,
    });

    return null;
  },
});

/**
 * Starts a fresh draft after a finalised letter.
 *
 * The finalised letter is retained for the record — the fact that it was
 * approved, and when it was sent, is never rewritten — but it stops being the
 * case's live letter, so generation can run again and produce a new draft.
 */
export const startNewDraft = mutation({
  args: {
    caseId: v.id("cases"),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const callerId = await resolveCaller(ctx, args.userId);
    await loadCaseForOwner(ctx, args.caseId, callerId);

    const letters = await ctx.db
      .query("letters")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    const now = Date.now();

    // Every letter that is still live is archived, not deleted: a sent letter
    // keeps its `sentAt` and an approved one its `approvedAt`, so the history
    // stays honest. Archiving is recorded by moving it out of the live slot,
    // which is what `getForCase` reads.
    //
    // A SENT letter is archived too. Leaving it live would let the next
    // generation rewrite the very document the landlord already received,
    // destroying the record of what was actually sent.
    let archived = 0;
    for (const letter of letters) {
      if (letter.archivedAt !== undefined) continue;

      await ctx.db.patch(letter._id, {
        archivedAt: now,
        generationRunId: undefined,
        updatedAt: now,
      });
      archived += 1;
    }

    await ctx.db.insert("timelineEvents", {
      caseId: args.caseId,
      type: "LETTER_DRAFT_STARTED",
      description: "New dispute letter draft started",
      metadata: { archivedLetters: archived },
      createdAt: now,
    });

    return null;
  },
});

/** The letter body as one document, exactly as it will be presented. */
function composeLetterContent({
  recipient,
  subject,
  body,
}: {
  recipient: string;
  subject: string;
  body: string;
}): string {
  return [`To: ${recipient}`, `Subject: ${subject}`, "", body].join("\n");
}

export { composeLetterContent };
