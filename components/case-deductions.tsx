"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import {
  AlertTriangle,
  ExternalLink,
  Landmark,
  Loader2,
  RefreshCw,
  Receipt,
} from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatCurrency } from "@/lib/format";
import { DeductionCategoryBadge } from "./deduction-category-badge";

export type DeductionRow = {
  _id: string;
  description: string;
  amount?: number;
  category?: string;
  researchStatus?: string;
  researchQuestion?: string;
  researchError?: string;
  assessmentStatus?: string;
  assessment?: string;
  assessmentReason?: string;
  potentiallyDisputableAmount?: number;
  assessmentSourceIds?: string[];
  assessmentMissingInformation: string[];
  assessmentError?: string;
};

export type SourceRow = {
  _id: string;
  deductionId?: string;
  title: string;
  url: string;
  authority: string;
  jurisdiction: string;
  relevantText?: string;
  retrievedAt: number;
};

export function CaseDeductions({
  userId,
  deductions,
  sources,
  isAnalyzing,
}: {
  userId: Id<"users">;
  deductions: DeductionRow[] | undefined;
  sources: SourceRow[] | undefined;
  isAnalyzing: boolean;
}) {
  const statedTotal = (deductions ?? []).reduce(
    (total, deduction) => total + (deduction.amount ?? 0),
    0
  );
  const unstatedCount = (deductions ?? []).filter(
    (deduction) => deduction.amount === undefined
  ).length;

  return (
    <section className="overflow-hidden rounded-xl border border-[#e4e7eb] bg-white">
      <div className="border-b border-[#edf0f2] px-5 py-4">
        <h2 className="text-sm font-semibold">Deductions</h2>
        <p className="mt-1 text-xs text-[#89929b]">
          What the statement itemized, the official sources found for each item, and what the
          evidence indicates.
        </p>
      </div>

      {deductions === undefined ? (
        <LoadingRows />
      ) : deductions.length === 0 ? (
        <EmptyDeductions isAnalyzing={isAnalyzing} />
      ) : (
        <>
          <ul className="divide-y divide-[#edf0f2]">
            {deductions.map((deduction) => (
              <li key={deduction._id} className="px-5 py-4">
                <DeductionItem
                  userId={userId}
                  deduction={deduction}
                  sources={(sources ?? []).filter(
                    (source) => source.deductionId === deduction._id
                  )}
                />
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-[#edf0f2] bg-[#fbfcfc] px-5 py-3.5">
            <div>
              <p className="text-xs font-semibold text-[#35414b]">Itemized total</p>
              {unstatedCount > 0 ? (
                <p className="mt-1 text-xs text-[#89929b]">
                  {unstatedCount} item{unstatedCount === 1 ? "" : "s"} named without an amount
                </p>
              ) : null}
            </div>
            <p className="text-sm font-semibold tabular-nums">{formatCurrency(statedTotal)}</p>
          </div>
        </>
      )}

      <p className="border-t border-[#edf0f2] px-5 py-3 text-[11px] leading-5 text-[#a0a8ae]">
        Assessments describe what the retrieved official sources indicate. &ldquo;Potentially
        disputable&rdquo; is not a legal conclusion, and nothing here promises recovery.
      </p>
    </section>
  );
}

function DeductionItem({
  userId,
  deduction,
  sources,
}: {
  userId: Id<"users">;
  deduction: DeductionRow;
  sources: SourceRow[];
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{deduction.description}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <DeductionCategoryBadge category={deduction.category} />
            <AssessmentBadge
              assessment={deduction.assessment}
              assessmentStatus={deduction.assessmentStatus}
            />
          </div>
        </div>
        <p
          className={`text-sm font-semibold tabular-nums ${
            deduction.amount === undefined ? "text-[#a0a8ae]" : "text-[#18212b]"
          }`}
        >
          {formatCurrency(deduction.amount)}
        </p>
      </div>

      <ResearchState userId={userId} deduction={deduction} sourceCount={sources.length} />
      <AssessmentState userId={userId} deduction={deduction} sources={sources} />
    </div>
  );
}

function ResearchState({
  userId,
  deduction,
  sourceCount,
}: {
  userId: Id<"users">;
  deduction: DeductionRow;
  sourceCount: number;
}) {
  const retryResearch = useMutation(api.research.retryResearch);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (deduction.researchStatus === "RESEARCHING") {
    return (
      <p className="flex items-center gap-2 text-xs text-[#69737d]">
        <Loader2 size={13} className="animate-spin text-[#6d9387]" />
        Research — finding authoritative housing rules…
      </p>
    );
  }

  if (deduction.researchStatus === "PENDING" || deduction.researchStatus === undefined) {
    return (
      <p className="flex items-center gap-2 text-xs text-[#89929b]">
        <Landmark size={13} /> Research queued — official housing rules will be retrieved.
      </p>
    );
  }

  if (deduction.researchStatus === "FAILED") {
    return (
      <div className="rounded-lg border border-[#e6c9c5] bg-[#fff7f6] px-3 py-2.5">
        <p className="flex items-start gap-2 text-xs leading-5 text-[#9c4338]">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          Research failed —{" "}
          {deduction.researchError ?? "the official sources could not be retrieved."}
        </p>
        <RetryButton
          label={retrying ? "Retrying…" : "Retry research"}
          busy={retrying}
          onClick={() => {
            setRetrying(true);
            setError(null);
            retryResearch({ deductionId: deduction._id as Id<"deductions">, userId })
              .catch((reason: unknown) =>
                setError(reason instanceof Error ? reason.message : "Research could not be retried.")
              )
              .finally(() => setRetrying(false));
          }}
        />
        {error ? <p className="mt-2 text-[11px] text-[#9c4338]">{error}</p> : null}
      </div>
    );
  }

  return (
    <p className="flex items-center gap-2 text-xs text-[#69737d]">
      <Landmark size={13} className="text-[#235b4c]" />
      {sourceCount > 0
        ? `Research — ${sourceCount} official source${sourceCount === 1 ? "" : "s"} found`
        : "Research — no official source was found for this deduction"}
    </p>
  );
}

function AssessmentState({
  userId,
  deduction,
  sources,
}: {
  userId: Id<"users">;
  deduction: DeductionRow;
  sources: SourceRow[];
}) {
  const retryAssessment = useMutation(api.assessments.retryAssessment);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (deduction.assessmentStatus === "ASSESSING") {
    return (
      <p className="flex items-center gap-2 text-xs text-[#69737d]">
        <Loader2 size={13} className="animate-spin text-[#6d9387]" />
        Assessment — checking the deduction against the official sources…
      </p>
    );
  }

  if (deduction.assessmentStatus === "FAILED") {
    return (
      <div className="rounded-lg border border-[#e6c9c5] bg-[#fff7f6] px-3 py-2.5">
        <p className="flex items-start gap-2 text-xs leading-5 text-[#9c4338]">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          Assessment failed —{" "}
          {deduction.assessmentError ?? "the evidence could not be assessed."}
        </p>
        <RetryButton
          label={retrying ? "Retrying…" : "Retry assessment"}
          busy={retrying}
          onClick={() => {
            setRetrying(true);
            setError(null);
            retryAssessment({ deductionId: deduction._id as Id<"deductions">, userId })
              .catch((reason: unknown) =>
                setError(
                  reason instanceof Error ? reason.message : "The assessment could not be retried."
                )
              )
              .finally(() => setRetrying(false));
          }}
        />
        {error ? <p className="mt-2 text-[11px] text-[#9c4338]">{error}</p> : null}
      </div>
    );
  }

  if (deduction.assessmentStatus !== "COMPLETED" || !deduction.assessment) {
    return null;
  }

  // Evidence shown with the assessment: the sources it cites, falling back to
  // every source research stored for the deduction.
  const citedIds = new Set(deduction.assessmentSourceIds ?? []);
  const evidence =
    citedIds.size > 0 ? sources.filter((source) => citedIds.has(source._id)) : sources;

  return (
    <div className="rounded-lg border border-[#e4e7eb] bg-[#fbfcfc] px-4 py-3.5">
      {/* The evidence chain, in the order it was established: what the landlord
          charged, what the research found, and only then the assessment. */}
      <dl className="space-y-2 text-xs">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#a0a8ae]">
            Landlord claim
          </dt>
          <dd className="mt-1 leading-5 text-[#4a5660]">
            {deduction.description} — {formatCurrency(deduction.amount)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#a0a8ae]">
            Clawback found
          </dt>
          <dd className="mt-1 flex items-start gap-1.5 leading-5 text-[#4a5660]">
            <Landmark size={13} className="mt-0.5 shrink-0 text-[#235b4c]" />
            {evidence.length > 0
              ? `${evidence.length} official source${evidence.length === 1 ? "" : "s"} for ${
                  evidence[0]?.jurisdiction ?? "this jurisdiction"
                }`
              : "No authoritative source was retrieved for this deduction"}
          </dd>
        </div>
      </dl>

      <div className="mt-3 border-t border-[#edf0f2] pt-3">
        <p className="text-xs font-semibold text-[#35414b]">
          Why
          {deduction.assessment === "POTENTIALLY_DISPUTABLE" &&
          deduction.potentiallyDisputableAmount !== undefined ? (
            <span className="ml-2 font-medium tabular-nums text-[#8a5230]">
              {formatCurrency(deduction.potentiallyDisputableAmount)} potentially disputable
            </span>
          ) : null}
        </p>
        <p className="mt-1.5 text-xs leading-5 text-[#4a5660]">{deduction.assessmentReason}</p>
      </div>

      {deduction.assessmentMissingInformation.length > 0 ? (
        <div className="mt-2.5">
          <p className="text-[11px] font-semibold text-[#69737d]">More information needed</p>
          <ul className="mt-1 list-inside list-disc text-[11px] leading-5 text-[#89929b]">
            {deduction.assessmentMissingInformation.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {evidence.length > 0 ? (
        <div className="mt-3 border-t border-[#edf0f2] pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#a0a8ae]">
            Evidence
          </p>
          {deduction.researchQuestion ? (
            <p className="mt-1.5 text-[11px] leading-5 text-[#89929b]">
              Research question: {deduction.researchQuestion}
            </p>
          ) : null}
          <ul className="mt-2 space-y-2">
            {evidence.map((source) => (
              <SourceCard key={source._id} source={source} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function SourceCard({ source }: { source: SourceRow }) {
  return (
    <li className="rounded-lg border border-[#e4e7eb] bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-[#26323b]">{source.title}</p>
          <p className="mt-0.5 text-[11px] text-[#89929b]">
            {source.authority} · {source.jurisdiction}
          </p>
        </div>
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold text-[#235b4c] hover:underline"
        >
          View source <ExternalLink size={11} />
        </a>
      </div>
      {source.relevantText ? (
        <p className="mt-2 line-clamp-4 text-[11px] leading-5 text-[#69737d]">
          {source.relevantText}
        </p>
      ) : (
        <p className="mt-2 text-[11px] italic text-[#a0a8ae]">
          No passage was retrieved from this source.
        </p>
      )}
    </li>
  );
}

function AssessmentBadge({
  assessment,
  assessmentStatus,
}: {
  assessment?: string;
  assessmentStatus?: string;
}) {
  if (assessmentStatus === "COMPLETED" && assessment) {
    if (assessment === "POTENTIALLY_DISPUTABLE") {
      return (
        <span className="inline-flex w-fit items-center rounded-full bg-[#fbf0e9] px-2.5 py-1 text-[11px] font-semibold text-[#8a5230]">
          Potentially disputable
        </span>
      );
    }
    if (assessment === "LIKELY_VALID") {
      return (
        <span className="inline-flex w-fit items-center rounded-full bg-[#edf4f1] px-2.5 py-1 text-[11px] font-semibold text-[#235b4c]">
          Likely valid
        </span>
      );
    }
    return (
      <span className="inline-flex w-fit items-center rounded-full bg-[#f3f5f5] px-2.5 py-1 text-[11px] font-semibold text-[#69737d]">
        Needs more information
      </span>
    );
  }

  return null;
}

function RetryButton({
  label,
  busy,
  onClick,
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="mt-2.5 inline-flex h-8 items-center gap-2 rounded-lg border border-[#cbd8d3] bg-white px-3 text-[11px] font-semibold text-[#235b4c] hover:bg-[#f6faf8] disabled:opacity-60"
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
      {label}
    </button>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-3 p-5">
      <div className="h-10 animate-pulse rounded-lg bg-[#f3f5f5]" />
      <div className="h-10 animate-pulse rounded-lg bg-[#f3f5f5]" />
    </div>
  );
}

function EmptyDeductions({ isAnalyzing }: { isAnalyzing: boolean }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-[#edf4f1] text-[#235b4c]">
        <Receipt size={19} />
      </span>
      <h3 className="mt-4 text-sm font-semibold">
        {isAnalyzing ? "Analyzing statement…" : "No deductions yet"}
      </h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-[#89929b]">
        {isAnalyzing
          ? "The statement is being read. Extracted deductions appear here as soon as they are stored."
          : "Once a deposit statement arrives at this case's email address, the deductions it lists appear here."}
      </p>
    </div>
  );
}
