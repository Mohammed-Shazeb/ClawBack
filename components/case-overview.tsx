"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { ArrowLeft, Clock3, FileText, Mail } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDateTime } from "@/lib/format";
import { AppShell } from "./app-shell";
import { CaseDeductions } from "./case-deductions";
import { CaseEmailAddress } from "./case-email-address";
import { CaseFinances } from "./case-finances";
import { CaseStatement } from "./case-statement";
import { useDemoUser } from "./demo-user";

export function CaseOverview({ caseId }: { caseId: string }) {
  const { userId, error: userError } = useDemoUser();
  const id = caseId as Id<"cases">;

  const caseData = useQuery(api.cases.get, userId ? { caseId: id, userId } : "skip");
  const timeline = useQuery(api.cases.getTimeline, userId ? { caseId: id, userId } : "skip");
  const emails = useQuery(api.emails.listByCase, userId ? { caseId: id, userId } : "skip");
  const deductions = useQuery(api.deductions.listByCase, userId ? { caseId: id, userId } : "skip");
  const sources = useQuery(api.sources.listByCase, userId ? { caseId: id, userId } : "skip");

  if (caseData === null) {
    return (
      <AppShell>
        <div className="mx-auto max-w-6xl px-5 py-8">
          <BackLink />
          <p className="mt-8 rounded-lg border border-[#e6c9c5] bg-[#fff7f6] px-4 py-3 text-sm text-[#9c4338]">
            Case not found or you do not have access to it.
          </p>
        </div>
      </AppShell>
    );
  }

  const isAnalyzing =
    emails?.some(
      (email) => email.processingStatus === "RECEIVED" || email.processingStatus === "PROCESSING"
    ) ?? false;
  const assessed =
    deductions?.some((deduction) => deduction.assessmentStatus === "COMPLETED") ?? false;

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <BackLink />

        {userError ? (
          <p className="mt-8 rounded-lg border border-[#e6c9c5] bg-[#fff7f6] px-4 py-3 text-sm text-[#9c4338]">
            {userError}
          </p>
        ) : caseData === undefined ? (
          <p className="mt-8 text-sm text-[#89929b]">Loading case…</p>
        ) : (
          <>
            <header className="mt-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#82908a]">
                  Case {caseId.slice(-6).toUpperCase()}
                </p>
                <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
                  {caseData.jurisdiction} recovery
                </h1>
                <p className="mt-2 text-sm text-[#69737d]">
                  Created {formatDateTime(caseData.createdAt)}
                </p>
              </div>
              <StatusPill status={caseData.status} isAnalyzing={isAnalyzing} />
            </header>

            <div className="mt-8">
              <CaseFinances
                depositAmount={caseData.depositAmount}
                totalDeductions={caseData.totalDeductions}
                potentiallyDisputableAmount={caseData.potentiallyDisputableAmount}
                assessed={assessed}
              />
            </div>

            <div className="mt-8 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="space-y-6">
                <CaseDeductions
                  userId={userId as Id<"users">}
                  deductions={deductions}
                  sources={sources}
                  isAnalyzing={isAnalyzing}
                />
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

              <div className="space-y-6">
                <section className="rounded-xl border border-[#e4e7eb] bg-white">
                  <div className="border-b border-[#edf0f2] px-5 py-4">
                    <h2 className="text-sm font-semibold">Timeline</h2>
                    <p className="mt-1 text-xs text-[#89929b]">
                      Actions recorded for this case
                    </p>
                  </div>
                  {timeline === undefined ? (
                    <p className="p-5 text-sm text-[#89929b]">Loading timeline…</p>
                  ) : timeline.length === 0 ? (
                    <p className="p-5 text-sm text-[#89929b]">No activity recorded yet.</p>
                  ) : (
                    <div className="p-5">
                      {timeline.map((event) => (
                        <div key={event._id} className="relative flex gap-3 pb-6 last:pb-0">
                          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-[#edf4f1] text-[#235b4c]">
                            <Clock3 size={14} />
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{event.description}</p>
                            <p className="mt-1 text-xs text-[#89929b]">
                              {formatDateTime(event.createdAt)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <div className="space-y-3">
                  <FutureBlock
                    icon={<FileText size={17} />}
                    title="Dispute letter"
                    text="Drafting the dispute letter from the assessed deductions comes next."
                  />
                  <FutureBlock
                    icon={<Mail size={17} />}
                    title="Response"
                    text="Landlord communication will appear here."
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function BackLink() {
  return (
    <Link
      href="/cases"
      className="inline-flex items-center gap-2 text-sm font-medium text-[#69737d] hover:text-[#173f35]"
    >
      <ArrowLeft size={16} /> All cases
    </Link>
  );
}

function StatusPill({ status, isAnalyzing }: { status: string; isAnalyzing: boolean }) {
  return (
    <span className="inline-flex w-fit items-center gap-2 rounded-full bg-[#edf4f1] px-3 py-1.5 text-xs font-semibold text-[#235b4c]">
      {isAnalyzing ? (
        <span className="size-1.5 animate-pulse rounded-full bg-[#6d9387]" />
      ) : null}
      {status}
    </span>
  );
}

function FutureBlock({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-dashed border-[#d9dfe1] bg-[#fbfcfc] p-4">
      <span className="text-[#82908a]">{icon}</span>
      <div>
        <h3 className="text-sm font-semibold text-[#35414b]">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-[#89929b]">{text}</p>
      </div>
    </div>
  );
}
