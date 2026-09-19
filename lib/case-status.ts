/**
 * The one place case statuses are turned into human wording.
 *
 * Shared by the cases index and the case overview so the same stored status can
 * never be described two different ways. Every status here exists in the
 * pipeline; nothing is invented for display.
 */

export type StatusTone = "neutral" | "accent" | "attention" | "danger";

const CASE_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  RECEIVED: { label: "Statement received", tone: "neutral" },
  ANALYZING: { label: "Reading statement", tone: "accent" },
  RESEARCHING: { label: "Researching sources", tone: "accent" },
  EVIDENCE_FOUND: { label: "Evidence found", tone: "accent" },
  DRAFT_READY: { label: "Draft ready", tone: "accent" },
  AWAITING_APPROVAL: { label: "Awaiting your approval", tone: "attention" },
  SENT: { label: "Sent to landlord", tone: "accent" },
  LANDLORD_RESPONDED: { label: "Landlord responded", tone: "accent" },
  RESOLVED: { label: "Resolved", tone: "accent" },
};

export function caseStatus(status: string): { label: string; tone: StatusTone } {
  return CASE_STATUS[status] ?? { label: status, tone: "neutral" };
}

/** The last six characters of a case id, which is how a case is referred to. */
export function caseReference(caseId: string): string {
  return `Case ${caseId.slice(-6).toUpperCase()}`;
}
