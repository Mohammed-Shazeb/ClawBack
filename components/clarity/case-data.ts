/**
 * The shape the main UI renders against.
 *
 * Ported from `UI/clawback-case-clarity/src/lib/case-data.ts` — the types, the
 * currency formatter and the assessment labels are unchanged. What is *gone* is
 * the hardcoded demo case: every value is now supplied by `case-data-provider`
 * from real Convex data, so nothing here can invent a figure.
 *
 * Fields the backend genuinely stores map one-to-one. Fields it does not store
 * (`tenantEvidence`, `rule`, `whyItMatters`, `property`, `tenancy`) are typed as
 * optional and render as an honest blank rather than plausible prose — the UI's
 * own markup decides how an absent value looks.
 */

export type Assessment = "disputable" | "valid" | "unknown";

export type Deduction = {
  id: string;
  label: string;
  amount: number;
  disputable: number;
  assessment: Assessment;
  summary: string;
  sourceIds: string[];
  /** Not stored by the backend. Absent rather than invented. */
  tenantEvidence?: string;
  /** Not stored by the backend. Absent rather than invented. */
  rule?: string;
  /** Not stored by the backend. Absent rather than invented. */
  whyItMatters?: string;
};

export type Source = {
  id: string;
  ref: string;
  title: string;
  citation: string;
  passage: string;
  url: string;
};

export type CaseMeta = {
  id: string;
  jurisdiction: string;
  date: string;
  /** Not stored by the backend. */
  property?: string;
  /** Not stored by the backend. */
  tenancy?: string;
  deposit: number;
  deductions: number;
  disputable: number;
  /**
   * `deposit − deductions`: the share of the deposit that was *not withheld*.
   * Deliberately NOT named "returned" — the app knows nothing was deducted from
   * this share, but it cannot know the landlord handed it back.
   */
  notWithheld: number;
};

export type ActivityStep = {
  id: string;
  label: string;
  detail: string;
  state: "done" | "active" | "pending";
};

export type TimelineEvent = {
  id: string;
  time: string;
  title: string;
  detail: string;
};

export const assessmentLabel: Record<Assessment, string> = {
  disputable: "Potentially disputable",
  valid: "Likely valid",
  unknown: "Needs more information",
};

export const currency = (value: number) =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
