"use client";

import { Check, Minus } from "lucide-react";

import { formatDateTime } from "@/lib/format";
import { Panel, PanelHead } from "./ui/primitives";

export type TimelineEventRow = {
  _id: string;
  type: string;
  description: string;
  createdAt: number;
};

export type InvestigationInput = {
  jurisdiction: string;
  status: string;
  deductionCount: number;
  sourceCount: number;
  connectedSourceCount: number;
  assessedCount: number;
  letterExists: boolean;
  letterReady: boolean;
  letterStatus?: string;
  timeline: TimelineEventRow[];
};

type StepState = "done" | "active" | "pending";

type Step = {
  key: string;
  label: string;
  detail?: string;
  state: StepState;
  at?: number;
};

/** The event types that correspond to a visible step, newest timestamp wins. */
const STEP_EVENTS: Record<string, string[]> = {
  received: ["EMAIL_RECEIVED"],
  identified: ["ANALYSIS_COMPLETED"],
  sourced: ["RESEARCH_COMPLETED"],
  assessed: ["ASSESSMENT_COMPLETED"],
  prepared: ["LETTER_UPDATED", "LETTER_PRESENTED_FOR_APPROVAL", "LETTER_DRAFT_STARTED"],
  approved: ["LETTER_APPROVED"],
  sent: ["DISPUTE_SENT"],
  responded: ["LANDLORD_RESPONDED"],
};

function latestEventAt(timeline: TimelineEventRow[], key: string): number | undefined {
  const types = STEP_EVENTS[key];
  if (!types) return undefined;

  const matches = timeline.filter((event) => types.includes(event.type));
  if (matches.length === 0) return undefined;

  return matches.reduce((newest, event) => Math.max(newest, event.createdAt), 0);
}

/**
 * Builds the investigation timeline from what the case has actually recorded.
 *
 * Every step is derived from persisted state or a real timeline event — nothing
 * is staged for effect. A step that has not happened is shown as not having
 * happened, and the current step is the first one still outstanding while work
 * is genuinely in flight.
 */
function buildSteps(input: InvestigationInput): Step[] {
  const {
    jurisdiction,
    status,
    deductionCount,
    sourceCount,
    connectedSourceCount,
    assessedCount,
    letterExists,
    letterReady,
    letterStatus,
    timeline,
  } = input;

  const allAssessed = deductionCount > 0 && assessedCount === deductionCount;
  const sent = ["SENT", "LANDLORD_RESPONDED", "RESOLVED"].includes(status);
  const responded = ["LANDLORD_RESPONDED", "RESOLVED"].includes(status);
  const approved = letterStatus === "APPROVED" || letterStatus === "SENT";

  const raw: Array<Omit<Step, "state"> & { done: boolean; active?: boolean }> = [
    {
      key: "received",
      label: "Statement received",
      detail: "A deposit statement arrived at this case's address.",
      done: deductionCount > 0,
      at: latestEventAt(timeline, "received"),
    },
    {
      key: "identified",
      label: "Deductions identified",
      detail:
        deductionCount > 0
          ? `${deductionCount} deduction${deductionCount === 1 ? "" : "s"} itemized on the statement.`
          : "Waiting for the statement to be read.",
      done: deductionCount > 0,
      at: latestEventAt(timeline, "identified"),
    },
    {
      key: "jurisdiction",
      label: "Jurisdiction confirmed",
      detail: `Assessed against ${jurisdiction}.`,
      done: deductionCount > 0,
    },
    {
      key: "sourced",
      label: "Official sources retrieved",
      detail:
        sourceCount > 0
          ? `${sourceCount} source${sourceCount === 1 ? "" : "s"} retrieved from housing authorities.`
          : "No official source has been retrieved yet.",
      done: sourceCount > 0,
      active: deductionCount > 0 && sourceCount === 0,
      at: latestEventAt(timeline, "sourced"),
    },
    {
      key: "connected",
      label: "Evidence connected",
      detail:
        connectedSourceCount > 0
          ? `${connectedSourceCount} source${connectedSourceCount === 1 ? "" : "s"} tied to a specific deduction.`
          : "Sources are not yet tied to individual deductions.",
      done: connectedSourceCount > 0,
    },
    {
      key: "assessed",
      label: "Deductions assessed",
      detail:
        deductionCount > 0
          ? `${assessedCount} of ${deductionCount} assessed against the retrieved sources.`
          : undefined,
      done: allAssessed,
      active: sourceCount > 0 && !allAssessed && assessedCount >= 0 && deductionCount > 0,
      at: latestEventAt(timeline, "assessed"),
    },
    {
      key: "prepared",
      label: "Dispute prepared",
      detail: letterExists
        ? "A dispute letter has been drafted from the assessed evidence."
        : "A letter can be drafted once at least one deduction is potentially disputable.",
      done: letterExists && letterReady,
      at: latestEventAt(timeline, "prepared"),
    },
    {
      key: "approved",
      label: "Approved by you",
      detail: approved
        ? "You approved this letter. Nothing is sent without this step."
        : "Your approval is required before anything is sent.",
      done: approved,
      active: letterStatus === "AWAITING_APPROVAL",
      at: latestEventAt(timeline, "approved"),
    },
    {
      key: "sent",
      label: "Dispute sent to landlord",
      detail: sent ? "Delivered through this case's AgentMail address." : undefined,
      done: sent,
      at: latestEventAt(timeline, "sent"),
    },
    {
      key: "responded",
      label: "Landlord responded",
      detail: responded ? "A reply from the landlord is attached to this case." : undefined,
      done: responded,
      at: latestEventAt(timeline, "responded"),
    },
  ];

  // The first outstanding step is "active" only if something is genuinely in
  // flight; otherwise the timeline would imply work that is not happening.
  const firstOutstanding = raw.findIndex((step) => !step.done);
  const anyActive = raw.some((step) => step.active);

  return raw.map((step, index) => {
    const { done, active, ...rest } = step;
    let state: StepState = done ? "done" : "pending";
    if (!done && (active || (!anyActive && index === firstOutstanding && isInFlight(status)))) {
      state = "active";
    }
    return { ...rest, state };
  });
}

/** Statuses that mean Clawback is actively working on the case right now. */
function isInFlight(status: string): boolean {
  return ["RECEIVED", "ANALYZING", "RESEARCHING", "EVIDENCE_FOUND", "DRAFT_READY"].includes(status);
}

export function CaseInvestigation({ input }: { input: InvestigationInput }) {
  const steps = buildSteps(input);
  const completed = steps.filter((step) => step.state === "done").length;

  return (
    <Panel as="section" aria-label="Investigation timeline">
      <PanelHead
        title="Investigation"
        description="What Clawback did, in the order it happened."
        aside={
          <span className="tabular text-[11px] font-medium text-ink-muted">
            {completed}/{steps.length}
          </span>
        }
      />

      <ol className="px-5 py-4">
        {steps.map((step, index) => (
          <li key={step.key} className="relative flex gap-3 pb-4 last:pb-0">
            {/* Connector, drawn behind the marker so the rail reads as one line. */}
            {index < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className={`absolute left-[9px] top-5 h-full w-px ${
                  step.state === "done" ? "bg-accent-line" : "bg-line"
                }`}
              />
            ) : null}

            <StepMarker state={step.state} />

            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p
                  className={`text-[13px] leading-5 ${
                    step.state === "pending"
                      ? "text-ink-muted"
                      : step.state === "active"
                        ? "font-semibold text-ink"
                        : "font-medium text-ink"
                  }`}
                >
                  {step.label}
                </p>
                {step.at ? (
                  <p className="shrink-0 text-[10px] text-ink-muted">{formatDateTime(step.at)}</p>
                ) : null}
              </div>

              {step.detail ? (
                <p className="mt-1 text-[11px] leading-5 text-ink-secondary">{step.detail}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      <p className="border-t border-line px-5 py-3 text-[11px] leading-5 text-ink-muted">
        Steps reflect recorded case events. Clawback does not show its internal reasoning.
      </p>
    </Panel>
  );
}

function StepMarker({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <span
        className="relative z-10 mt-0.5 flex size-[19px] shrink-0 items-center justify-center rounded-full bg-accent text-white"
        aria-label="Completed"
      >
        <Check size={11} strokeWidth={3} aria-hidden="true" />
      </span>
    );
  }

  if (state === "active") {
    return (
      <span
        className="relative z-10 mt-0.5 flex size-[19px] shrink-0 items-center justify-center rounded-full border border-accent-line bg-accent-soft"
        aria-label="In progress"
      >
        <span className="size-1.5 animate-pulse rounded-full bg-accent" />
      </span>
    );
  }

  return (
    <span
      className="relative z-10 mt-0.5 flex size-[19px] shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink-muted"
      aria-label="Not yet started"
    >
      <Minus size={10} aria-hidden="true" />
    </span>
  );
}
