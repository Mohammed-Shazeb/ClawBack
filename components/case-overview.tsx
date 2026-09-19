"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { caseReference, caseStatus } from "@/lib/case-status";
import { formatDateTime } from "@/lib/format";
import { AppShell } from "./app-shell";
import { CaseCommunication } from "./case-communication";
import { CaseDeductions } from "./case-deductions";
import { CaseEmailAddress } from "./case-email-address";
import { CaseFinances } from "./case-finances";
import { CaseInvestigation } from "./case-investigation";
import { CaseLetter } from "./case-letter";
import { CaseSectionNav } from "./case-section-nav";
import { CaseStatement } from "./case-statement";
import { Badge } from "./ui/primitives";

/**
 * `userId` is a prop rather than something this component looks up.
 *
 * Two reasons. It keeps the identity decision in one place — the page's gate —
 * instead of every screen resolving it for itself; and it makes the component
 * renderable offline with a fixed id, which is how the UI harness verifies it
 * without a Convex connection. The queries still pass `"skip"` while the id is
 * null, because the type is honestly nullable: the gate guarantees a user, but
 * one render happens before the row lands.
 */
export function CaseOverview({
  caseId,
  userId,
}: {
  caseId: string;
  userId: Id<"users"> | null;
}) {
  const id = caseId as Id<"cases">;

  const caseData = useQuery(api.cases.get, userId ? { caseId: id, userId } : "skip");
  const timeline = useQuery(api.cases.getTimeline, userId ? { caseId: id, userId } : "skip");
  const emails = useQuery(api.emails.listByCase, userId ? { caseId: id, userId } : "skip");
  const deductions = useQuery(api.deductions.listByCase, userId ? { caseId: id, userId } : "skip");
  const sources = useQuery(api.sources.listByCase, userId ? { caseId: id, userId } : "skip");
  const letter = useQuery(api.letters.getForCase, userId ? { caseId: id, userId } : "skip");

  if (caseData === null) {
    return (
      <AppShell>
        <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
          <BackLink />
          <div className="mt-8 rounded-lg border border-danger-line bg-danger-soft px-4 py-3.5">
            <p className="text-[13px] font-medium text-danger">Case not available</p>
            <p className="mt-1 text-xs leading-5 text-danger">
              This case does not exist, or it belongs to a different account.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  const isAnalyzing =
    emails?.some(
      (email) => email.processingStatus === "RECEIVED" || email.processingStatus === "PROCESSING"
    ) ?? false;

  const assessed = deductions?.some((deduction) => deduction.assessmentStatus === "COMPLETED") ?? false;
  const statusCopy = caseData ? caseStatus(caseData.status) : undefined;

  /*
   * Derived from the stored deduction rows, never from a model total — the same
   * rule the case totals follow. `likelyValidAmount` is the other half of the
   * deposit decomposition: what the evidence supported, as opposed to what it
   * did not.
   */
  const assessedCount =
    deductions?.filter((deduction) => deduction.assessmentStatus === "COMPLETED").length ?? 0;
  const likelyValidAmount = (deductions ?? [])
    .filter((deduction) => deduction.assessment === "LIKELY_VALID")
    .reduce((sum, deduction) => sum + (deduction.amount ?? 0), 0);

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <BackLink />

        {caseData === undefined ? (
          <CaseSkeleton />
        ) : (
          <div className="animate-fade">
            {/* --- Case identity --- */}
            <header className="mt-7 flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted">
                  <span>{caseReference(caseId)}</span>
                  <span aria-hidden="true" className="text-line-strong">
                    /
                  </span>
                  <span>{caseData.jurisdiction}</span>
                </div>
                <h1 className="mt-2 text-[1.75rem] font-semibold leading-tight tracking-[-0.03em] text-ink">
                  Security deposit dispute
                </h1>
                <p className="mt-1.5 text-xs text-ink-muted">
                  Opened {formatDateTime(caseData.createdAt)}
                </p>
              </div>

              <div className="flex items-center gap-3">
                {isAnalyzing ? (
                  <span className="flex items-center gap-1.5 text-[11px] text-ink-secondary">
                    <span className="size-1.5 animate-pulse rounded-full bg-accent" aria-hidden="true" />
                    Working
                  </span>
                ) : null}
                {statusCopy ? <Badge tone={statusCopy.tone}>{statusCopy.label}</Badge> : null}
              </div>
            </header>

            <CaseSectionNav />

            {/* --- The money --- */}
            <div id="case-money" className="mt-7 scroll-mt-28">
              <CaseFinances
                depositAmount={caseData.depositAmount}
                totalDeductions={caseData.totalDeductions}
                potentiallyDisputableAmount={caseData.potentiallyDisputableAmount}
                likelyValidAmount={likelyValidAmount}
                deductionCount={deductions?.length ?? 0}
                assessedCount={assessedCount}
                assessed={assessed}
              />
            </div>

            {/* --- The evidence, given the room it needs --- */}
            <div id="case-deductions" className="mt-6 scroll-mt-28">
              <CaseDeductions
                userId={userId as Id<"users">}
                deductions={deductions}
                sources={sources}
                isAnalyzing={isAnalyzing}
              />
            </div>

            {/* --- Action and correspondence, with the investigation beside them --- */}
            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)]">
              <div className="min-w-0 space-y-6">
                <div id="case-letter" className="scroll-mt-28">
                  <CaseLetter
                    caseId={caseId}
                    userId={userId as Id<"users">}
                    potentiallyDisputableAmount={caseData.potentiallyDisputableAmount}
                    landlordEmail={caseData.landlordEmail}
                    deductions={(deductions ?? []).map((deduction) => ({
                      _id: deduction._id,
                      description: deduction.description,
                      amount: deduction.amount,
                      assessment: deduction.assessment,
                      potentiallyDisputableAmount: deduction.potentiallyDisputableAmount,
                      assessmentSourceIds: deduction.assessmentSourceIds,
                    }))}
                  />
                </div>

                <div id="case-communication" className="scroll-mt-28">
                  <CaseCommunication caseId={caseId} userId={userId as Id<"users">} />
                </div>
              </div>

              <div className="min-w-0 space-y-6">
                <div id="case-timeline" className="scroll-mt-28">
                  <CaseInvestigation
                    input={{
                      jurisdiction: caseData.jurisdiction,
                      status: caseData.status,
                      deductionCount: deductions?.length ?? 0,
                      sourceCount: sources?.length ?? 0,
                      connectedSourceCount:
                        sources?.filter((source) => Boolean(source.deductionId)).length ?? 0,
                      assessedCount,
                      letterExists: Boolean(letter),
                      letterReady: letter?.pipelineStatus === "READY",
                      letterStatus: letter?.status,
                      timeline: timeline ?? [],
                    }}
                  />
                </div>

                <div id="case-statement" className="scroll-mt-28 space-y-6">
                  <CaseEmailAddress
                    caseId={caseId}
                    userId={userId as Id<"users">}
                    inboxId={caseData.inboxId}
                    inboxStatus={caseData.inboxStatus}
                    inboxError={caseData.inboxError}
                  />
                  <CaseStatement
                    userId={userId as Id<"users">}
                    emails={emails}
                    deductionCount={deductions?.length ?? 0}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function BackLink() {
  return (
    <Link
      href="/cases"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-secondary transition-colors hover:text-ink"
    >
      <ArrowLeft size={14} aria-hidden="true" /> All cases
    </Link>
  );
}

/** A quiet placeholder shaped like the real page, so loading does not jump. */
function CaseSkeleton() {
  return (
    <div className="mt-7 space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading case…</span>
      <div className="space-y-3" aria-hidden="true">
        <div className="h-3 w-32 animate-pulse rounded bg-surface-muted" />
        <div className="h-7 w-72 animate-pulse rounded bg-surface-muted" />
      </div>
      <div className="h-56 animate-pulse rounded-lg border border-line bg-surface" aria-hidden="true" />
      <div className="h-80 animate-pulse rounded-lg border border-line bg-surface" aria-hidden="true" />
    </div>
  );
}
