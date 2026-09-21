"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCurrentUser } from "@/components/current-user";
import type {
  ActivityStep,
  Assessment,
  CaseMeta,
  Deduction,
  Source,
  TimelineEvent,
} from "./case-data";

/**
 * Supplies the main UI's data from Convex instead of the hardcoded demo case.
 *
 * The rule this file exists to enforce: **nothing is invented**. Every value is
 * either read from the database or left absent, and an absent value renders as a
 * blank the UI already handles — never as plausible-sounding filler. That is why
 * `tenantEvidence`, `rule`, `whyItMatters`, `property` and `tenancy` have no
 * source here: the backend does not store them, so they stay undefined.
 *
 * The one figure renamed on purpose is `notWithheld` (`deposit − deductions`).
 * The prototype called it `returned`; the app can know a deduction was not made
 * from that share, but not that the landlord handed the money back.
 */

export type LetterView = {
  id: string;
  subject: string;
  /** Who the stored letter is addressed to. */
  recipient: string;
  body: string;
  status: string;
  /** Paragraphs of the stored letter, split on blank lines. */
  paragraphs: string[];
};

export type CaseData = {
  caseMeta: CaseMeta | null;
  caseStatus: string | null;
  /** Needed to act on the case (approving a letter is addressed by case). */
  caseId: Id<"cases"> | null;
  deductions: Deduction[];
  sources: Source[];
  activitySteps: ActivityStep[];
  timeline: TimelineEvent[];
  letter: LetterView | null;
  counts: {
    deductions: number;
    sources: number;
    openQuestions: number;
    documents: number;
  };
  loading: boolean;
};

const EMPTY: CaseData = {
  caseMeta: null,
  caseStatus: null,
  caseId: null,
  deductions: [],
  sources: [],
  activitySteps: [],
  timeline: [],
  letter: null,
  counts: { deductions: 0, sources: 0, openQuestions: 0, documents: 0 },
  loading: true,
};

const CaseDataContext = createContext<CaseData>(EMPTY);

export function useCaseData(): CaseData {
  return useContext(CaseDataContext);
}

const OUTCOME_TO_ASSESSMENT: Record<string, Assessment> = {
  POTENTIALLY_DISPUTABLE: "disputable",
  LIKELY_VALID: "valid",
  NEEDS_MORE_INFORMATION: "unknown",
};

/** Convex ids are long; the header shows a short, stable tail. */
const shortId = (id: string) => id.slice(-4).toUpperCase();

const longDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

const clockTime = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

/** The design shows a bare host (e.g. `dca.ca.gov`), not a full URL. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const humanize = (value: string) =>
  value
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word, i) => (i === 0 ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(" ");

export function CaseDataProvider({ children }: { children: ReactNode }) {
  const { userId, isLoading: authLoading } = useCurrentUser();

  // Convex requires "skip" (not undefined) to defer a query that has no id yet.
  const cases = useQuery(api.cases.list, userId ? { userId } : "skip");
  const activeCase = cases?.[0];
  const caseId = activeCase?._id;

  const rawDeductions = useQuery(
    api.deductions.listByCase,
    caseId ? { caseId } : "skip",
  );
  const rawSources = useQuery(api.sources.listByCase, caseId ? { caseId } : "skip");
  const rawTimeline = useQuery(api.cases.getTimeline, caseId ? { caseId } : "skip");
  const rawLetter = useQuery(api.letters.getForCase, caseId ? { caseId } : "skip");
  const rawEmails = useQuery(api.emails.listByCase, caseId ? { caseId } : "skip");

  const value = useMemo<CaseData>(() => {
    if (authLoading || cases === undefined) return EMPTY;

    if (!activeCase) {
      // A real account with no cases. Not an error, and not a reason to show
      // somebody else's numbers.
      return { ...EMPTY, loading: false };
    }

    const sources: Source[] = (rawSources ?? []).map((source, index) => ({
      id: source._id,
      ref: String(index + 1).padStart(2, "0"),
      title: source.title,
      citation: source.authority,
      passage: source.relevantText ?? "",
      url: hostOf(source.url),
    }));

    const deductions: Deduction[] = (rawDeductions ?? []).map((deduction) => ({
      id: deduction._id,
      label: deduction.description,
      amount: deduction.amount ?? 0,
      disputable: deduction.potentiallyDisputableAmount ?? 0,
      assessment:
        OUTCOME_TO_ASSESSMENT[deduction.assessment ?? ""] ?? "unknown",
      summary: deduction.assessmentReason ?? "",
      sourceIds: (deduction.assessmentSourceIds ?? []).map(String),
    }));

    const events = rawTimeline ?? [];

    const activitySteps: ActivityStep[] = events.map((event) => ({
      id: event._id,
      label: humanize(event.type),
      detail: event.description,
      state: "done",
    }));

    const timeline: TimelineEvent[] = events.map((event) => ({
      id: event._id,
      time: clockTime(event.createdAt),
      title: humanize(event.type),
      detail: event.description,
    }));

    const letter: LetterView | null = rawLetter
      ? {
          id: rawLetter._id,
          subject: rawLetter.subject,
          recipient: rawLetter.recipient,
          body: rawLetter.body,
          status: rawLetter.status,
          paragraphs: rawLetter.body
            .split(/\n{2,}/)
            .map((paragraph) => paragraph.trim())
            .filter(Boolean),
        }
      : null;

    const caseMeta: CaseMeta = {
      id: shortId(activeCase._id),
      jurisdiction: activeCase.jurisdiction,
      date: longDate(activeCase.createdAt),
      deposit: activeCase.depositAmount,
      deductions: activeCase.totalDeductions,
      disputable: activeCase.potentiallyDisputableAmount,
      notWithheld: Math.max(0, activeCase.depositAmount - activeCase.totalDeductions),
    };

    return {
      caseMeta,
      caseStatus: activeCase.status,
      caseId: activeCase._id,
      deductions,
      sources,
      activitySteps,
      timeline,
      letter,
      counts: {
        deductions: deductions.length,
        sources: sources.length,
        openQuestions: deductions.filter((d) => d.assessment === "unknown").length,
        documents: rawEmails?.length ?? 0,
      },
      loading: false,
    };
  }, [
    authLoading,
    cases,
    activeCase,
    rawDeductions,
    rawSources,
    rawTimeline,
    rawLetter,
    rawEmails,
  ]);

  return <CaseDataContext.Provider value={value}>{children}</CaseDataContext.Provider>;
}
