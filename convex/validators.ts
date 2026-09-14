import { v } from "convex/values";

/**
 * Shared validators for values that cross a Convex boundary (schema, function
 * arguments, and stored payloads) so the literals are only listed once.
 */

/**
 * Case workflow status. This tracks the recovery case itself and is never
 * written from the email pipeline except for the transition into ANALYZING.
 */
export const CASE_STATUSES = [
  "RECEIVED",
  "ANALYZING",
  "RESEARCHING",
  "EVIDENCE_FOUND",
  "DRAFT_READY",
  "AWAITING_APPROVAL",
  "SENT",
  "LANDLORD_RESPONDED",
  "RESOLVED",
] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];

export const caseStatusValidator = v.union(
  ...CASE_STATUSES.map((status) => v.literal(status))
);

/**
 * Inbound-email processing status. Deliberately separate from the case
 * workflow status: an email can FAIL while its case stays ANALYZING.
 */
export const EMAIL_PROCESSING_STATUSES = [
  "RECEIVED",
  "PROCESSING",
  "PROCESSED",
  "FAILED",
] as const;

export type EmailProcessingStatus = (typeof EMAIL_PROCESSING_STATUSES)[number];

export const emailProcessingStatusValidator = v.union(
  ...EMAIL_PROCESSING_STATUSES.map((status) => v.literal(status))
);

/**
 * What the landlord said the deduction was for. This is a description of the
 * charge as stated, not a legal assessment of it.
 */
export const DEDUCTION_CATEGORIES = [
  "ORDINARY_WEAR",
  "TENANT_DAMAGE",
  "FEE",
  "UNKNOWN",
] as const;

export type DeductionCategory = (typeof DEDUCTION_CATEGORIES)[number];

export const deductionCategoryValidator = v.union(
  ...DEDUCTION_CATEGORIES.map((category) => v.literal(category))
);

/** Whether a case has an inbound email address yet. */
export const INBOX_STATUSES = ["PENDING", "READY", "FAILED"] as const;

export type InboxStatus = (typeof INBOX_STATUSES)[number];

export const inboxStatusValidator = v.union(
  ...INBOX_STATUSES.map((status) => v.literal(status))
);

/**
 * Per-deduction research state, deliberately separate from the case workflow
 * status. A deduction is researchable while PENDING (or FAILED, for a retry),
 * RESEARCHING while Firecrawl and the question generator are being asked,
 * COMPLETED once a pass finishes (which may legitimately find zero
 * authoritative sources), and FAILED when the retrieval itself threw.
 */
export const RESEARCH_STATUSES = ["PENDING", "RESEARCHING", "COMPLETED", "FAILED"] as const;

export type ResearchStatus = (typeof RESEARCH_STATUSES)[number];

export const researchStatusValidator = v.union(
  ...RESEARCH_STATUSES.map((status) => v.literal(status))
);

/**
 * Per-deduction assessment pipeline state, separate from the outcome: an
 * assessment is claimable while PENDING (or FAILED, for a retry), ASSESSING
 * while the model call runs, COMPLETED once a validated outcome is stored, and
 * FAILED when the model call or validation threw.
 */
export const ASSESSMENT_PIPELINE_STATUSES = [
  "PENDING",
  "ASSESSING",
  "COMPLETED",
  "FAILED",
] as const;

export type AssessmentPipelineStatus = (typeof ASSESSMENT_PIPELINE_STATUSES)[number];

export const assessmentStatusValidator = v.union(
  ...ASSESSMENT_PIPELINE_STATUSES.map((status) => v.literal(status))
);

/**
 * The outcome of an evidence-based assessment. POTENTIALLY_DISPUTABLE does not
 * mean legally invalid: it means the retrieved source indicates the charge may
 * not satisfy the applicable conditions.
 */
export const ASSESSMENT_OUTCOMES = [
  "POTENTIALLY_DISPUTABLE",
  "LIKELY_VALID",
  "NEEDS_MORE_INFORMATION",
] as const;

export type AssessmentOutcome = (typeof ASSESSMENT_OUTCOMES)[number];

export const assessmentOutcomeValidator = v.union(
  ...ASSESSMENT_OUTCOMES.map((outcome) => v.literal(outcome))
);

/** An assessment after validation, as stored on the deduction. */
export const validatedAssessmentValidator = v.object({
  assessment: assessmentOutcomeValidator,
  assessmentReason: v.string(),
  potentiallyDisputableAmount: v.number(),
  assessmentSourceIds: v.array(v.id("sources")),
  assessmentMissingInformation: v.array(v.string()),
});
/**
 * Attachment metadata only. Attachment bodies are never downloaded or parsed
 * in this milestone, so nothing here claims the document was read.
 */
export const attachmentValidator = v.object({
  attachmentId: v.optional(v.string()),
  filename: v.optional(v.string()),
  contentType: v.optional(v.string()),
  size: v.optional(v.number()),
  inline: v.optional(v.boolean()),
});

export type EmailAttachment = {
  attachmentId?: string;
  filename?: string;
  contentType?: string;
  size?: number;
  inline?: boolean;
};

/** One deduction as extracted from a statement, before it is stored. */
export const extractedDeductionValidator = v.object({
  description: v.string(),
  amount: v.optional(v.number()),
  category: deductionCategoryValidator,
});

/**
 * The result of reading a deposit statement. `statedTotalDeductions` is what
 * the statement itself claims the deductions add up to, kept only so a
 * mismatch against our own sum can be recorded.
 */
export const extractionResultValidator = v.object({
  depositAmount: v.optional(v.number()),
  statedTotalDeductions: v.optional(v.number()),
  deductions: v.array(extractedDeductionValidator),
  notes: v.optional(v.string()),
});

export type ExtractionResult = {
  depositAmount?: number;
  statedTotalDeductions?: number;
  deductions: Array<{
    description: string;
    amount?: number;
    category: DeductionCategory;
  }>;
  notes?: string;
};
