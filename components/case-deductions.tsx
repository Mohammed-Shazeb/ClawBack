"use client";

import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import {
  AlertTriangle,
  ChevronRight,
  ExternalLink,
  FileText,
  Landmark,
  Loader2,
  Quote,
  Receipt,
  RefreshCw,
  Scale,
  Search,
} from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatCurrency } from "@/lib/format";
import { DeductionCategoryBadge } from "./deduction-category-badge";
import { AssessmentBadge, Badge, MicroLabel, Panel, PanelHead } from "./ui/primitives";

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

/**
 * The evidence workspace.
 *
 * One deduction is selected at a time; selecting it reveals the chain that
 * produced its assessment — what the landlord charged, what the research found,
 * what the sources actually say, and what Clawback concluded. Selecting a source
 * brings its passage forward, so a finding can always be traced to the text it
 * came from rather than being taken on trust.
 */
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
  // Stable fallbacks: `deductions ?? []` would be a fresh array on every render,
  // which would invalidate the memos below on every pass.
  const rows = useMemo(() => deductions ?? [], [deductions]);
  const allSources = useMemo(() => sources ?? [], [sources]);

  const [openId, setOpenId] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);

  // Default to the first deduction that has something to show, so the workspace
  // opens on content rather than on an empty selection.
  const activeId = openId ?? rows.find((row) => row.assessmentStatus === "COMPLETED")?._id ?? rows[0]?._id ?? null;
  const active = useMemo(() => rows.find((row) => row._id === activeId) ?? null, [rows, activeId]);
  const activeSources = useMemo(
    () => allSources.filter((source) => source.deductionId === activeId),
    [allSources, activeId]
  );

  const statedTotal = rows.reduce((total, row) => total + (row.amount ?? 0), 0);
  const unstatedCount = rows.filter((row) => row.amount === undefined).length;

  return (
    <Panel as="section" className="overflow-hidden" aria-label="Deductions and evidence">
      <PanelHead
        title="Deductions"
        description="Each charge on the statement, and the evidence behind Clawback's finding."
        aside={
          <div className="text-right">
            <MicroLabel>Itemized total</MicroLabel>
            <p className="tabular text-sm font-semibold text-ink">{formatCurrency(statedTotal)}</p>
          </div>
        }
      />

      {deductions === undefined ? (
        <LoadingRows />
      ) : rows.length === 0 ? (
        <EmptyDeductions isAnalyzing={isAnalyzing} />
      ) : (
        <div className="grid lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
          {/* --- The claims --- */}
          <ul className="divide-y divide-line border-b border-line lg:border-b-0 lg:border-r">
            {rows.map((row) => (
              <li key={row._id}>
                <DeductionRowButton
                  row={row}
                  sourceCount={allSources.filter((source) => source.deductionId === row._id).length}
                  selected={row._id === activeId}
                  onSelect={() => {
                    setOpenId(row._id);
                    setSourceId(null);
                  }}
                />
              </li>
            ))}

            {unstatedCount > 0 ? (
              <li className="px-5 py-3 text-[11px] leading-5 text-ink-muted">
                {unstatedCount} item{unstatedCount === 1 ? "" : "s"} named without an amount, so{" "}
                {unstatedCount === 1 ? "it is" : "they are"} excluded from the itemized total.
              </li>
            ) : null}
          </ul>

          {/* --- The investigation for the selected claim --- */}
          <div className="min-w-0 bg-surface">
            {active ? (
              <DeductionDetail
                key={active._id}
                userId={userId}
                deduction={active}
                sources={activeSources}
                selectedSourceId={sourceId}
                onSelectSource={setSourceId}
              />
            ) : null}
          </div>
        </div>
      )}

      <p className="border-t border-line bg-surface-muted px-5 py-3 text-[11px] leading-5 text-ink-muted">
        Assessments describe what the retrieved official sources indicate. &ldquo;Potentially
        disputable&rdquo; is not a legal conclusion, and nothing here promises recovery.
      </p>
    </Panel>
  );
}

function DeductionRowButton({
  row,
  sourceCount,
  selected,
  onSelect,
}: {
  row: DeductionRow;
  sourceCount: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={`group flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors ${
        selected ? "bg-accent-soft" : "hover:bg-surface-muted"
      }`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 h-8 w-0.5 shrink-0 rounded-full transition-colors ${
          selected ? "bg-accent" : "bg-transparent"
        }`}
      />

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="truncate text-[13px] font-medium text-ink">{row.description}</span>
          <span
            className={`tabular shrink-0 text-[13px] font-semibold ${
              row.amount === undefined ? "text-ink-muted" : "text-ink"
            }`}
          >
            {formatCurrency(row.amount)}
          </span>
        </span>

        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <AssessmentBadge assessment={row.assessment} status={row.assessmentStatus} />
          <DeductionCategoryBadge category={row.category} />
          {row.assessmentStatus === "COMPLETED" && sourceCount > 0 ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-ink-muted">
              <FileText size={11} aria-hidden="true" />
              {sourceCount} source{sourceCount === 1 ? "" : "s"}
            </span>
          ) : null}
          {/*
            * How much of this line is actually in dispute.
            *
            * The list previously showed only what the landlord charged, so a
            * $450 charge the evidence fully supported and a $450 charge the
            * evidence did not looked identical — the one number a renter needs
            * to decide which lines to open was the one missing from the row.
            * Shown only when there is something to dispute, so the attention
            * colour keeps meaning something.
            */}
          {row.assessmentStatus === "COMPLETED" && (row.potentiallyDisputableAmount ?? 0) > 0 ? (
            <span className="tabular inline-flex items-center gap-1 text-[11px] font-medium text-attention">
              {formatCurrency(row.potentiallyDisputableAmount)} in question
            </span>
          ) : null}
          {row.researchStatus === "FAILED" || row.assessmentStatus === "FAILED" ? (
            <Badge tone="danger">Needs attention</Badge>
          ) : null}
        </span>
      </span>

      <ChevronRight
        size={14}
        aria-hidden="true"
        className={`mt-1 shrink-0 transition-transform ${
          selected ? "translate-x-0.5 text-accent" : "text-ink-muted group-hover:translate-x-0.5"
        }`}
      />
    </button>
  );
}

function DeductionDetail({
  userId,
  deduction,
  sources,
  selectedSourceId,
  onSelectSource,
}: {
  userId: Id<"users">;
  deduction: DeductionRow;
  sources: SourceRow[];
  selectedSourceId: string | null;
  onSelectSource: (id: string | null) => void;
}) {
  return (
    <div className="animate-fade p-5">
      {/* The claim under investigation. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <MicroLabel>Landlord claim</MicroLabel>
          <p className="mt-1.5 text-base font-semibold tracking-[-0.01em] text-ink">
            {deduction.description}
          </p>
        </div>
        <p className="tabular text-lg font-semibold text-ink">{formatCurrency(deduction.amount)}</p>
      </div>

      <div className="mt-4 space-y-4">
        <ResearchStep userId={userId} deduction={deduction} sourceCount={sources.length} />
        <AssessmentStep
          userId={userId}
          deduction={deduction}
          sources={sources}
          selectedSourceId={selectedSourceId}
          onSelectSource={onSelectSource}
        />
      </div>
    </div>
  );
}

/** A labelled stage in the evidence chain, with a rail so the order reads clearly. */
function ChainStep({
  index,
  label,
  icon,
  children,
  muted = false,
}: {
  index: number;
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${
            muted
              ? "border-line bg-surface-muted text-ink-muted"
              : "border-accent-line bg-accent-soft text-accent"
          }`}
          aria-hidden="true"
        >
          {icon}
        </span>
        <span className="mt-1 w-px flex-1 bg-line" aria-hidden="true" />
      </div>

      <div className="min-w-0 flex-1 pb-1">
        <MicroLabel>
          <span className="sr-only">Step {index}. </span>
          {label}
        </MicroLabel>
        <div className="mt-1.5">{children}</div>
      </div>
    </div>
  );
}

function ResearchStep({
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

  const retry = (
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
  );

  if (deduction.researchStatus === "RESEARCHING") {
    return (
      <ChainStep index={2} label="Official source" icon={<Search size={11} />}>
        <Busy>Searching housing authorities for the rules that apply to this charge…</Busy>
      </ChainStep>
    );
  }

  if (deduction.researchStatus === "PENDING" || deduction.researchStatus === undefined) {
    return (
      <ChainStep index={2} label="Official source" icon={<Search size={11} />} muted>
        <p className="text-xs leading-5 text-ink-secondary">
          Queued — an official housing source will be retrieved for this charge.
        </p>
      </ChainStep>
    );
  }

  if (deduction.researchStatus === "FAILED") {
    return (
      <ChainStep index={2} label="Official source" icon={<AlertTriangle size={11} />}>
        <div className="rounded-md border border-danger-line bg-danger-soft px-3 py-2.5">
          <p className="text-xs leading-5 text-danger">
            Research failed — {deduction.researchError ?? "the sources could not be retrieved."}
          </p>
          {retry}
          {error ? <p className="mt-2 text-[11px] text-danger">{error}</p> : null}
        </div>
      </ChainStep>
    );
  }

  return (
    <ChainStep index={2} label="Official source" icon={<Landmark size={11} />}>
      <p className="text-xs leading-5 text-ink-secondary">
        {sourceCount > 0
          ? `${sourceCount} official source${sourceCount === 1 ? "" : "s"} retrieved for ${
              deduction.description.toLowerCase()
            }.`
          : "No official source was found for this charge, so no finding is claimed."}
      </p>
      {deduction.researchQuestion ? (
        <p className="mt-1.5 text-[11px] leading-5 text-ink-muted">
          Asked: {deduction.researchQuestion}
        </p>
      ) : null}
    </ChainStep>
  );
}

function AssessmentStep({
  userId,
  deduction,
  sources,
  selectedSourceId,
  onSelectSource,
}: {
  userId: Id<"users">;
  deduction: DeductionRow;
  sources: SourceRow[];
  selectedSourceId: string | null;
  onSelectSource: (id: string | null) => void;
}) {
  const retryAssessment = useMutation(api.assessments.retryAssessment);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (deduction.assessmentStatus === "ASSESSING") {
    return (
      <ChainStep index={3} label="Clawback finding" icon={<Scale size={11} />}>
        <Busy>Checking this charge against the retrieved sources…</Busy>
      </ChainStep>
    );
  }

  if (deduction.assessmentStatus === "FAILED") {
    return (
      <ChainStep index={3} label="Clawback finding" icon={<AlertTriangle size={11} />}>
        <div className="rounded-md border border-danger-line bg-danger-soft px-3 py-2.5">
          <p className="text-xs leading-5 text-danger">
            Assessment failed — {deduction.assessmentError ?? "the evidence could not be assessed."}
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
          {error ? <p className="mt-2 text-[11px] text-danger">{error}</p> : null}
        </div>
      </ChainStep>
    );
  }

  if (deduction.assessmentStatus !== "COMPLETED" || !deduction.assessment) {
    return (
      <ChainStep index={3} label="Clawback finding" icon={<Scale size={11} />} muted>
        <p className="text-xs leading-5 text-ink-secondary">
          Not yet assessed — no finding is claimed until the evidence has been checked.
        </p>
      </ChainStep>
    );
  }

  const citedIds = new Set(deduction.assessmentSourceIds ?? []);
  const evidence = citedIds.size > 0 ? sources.filter((source) => citedIds.has(source._id)) : sources;

  // With exactly one source there is nothing to choose between, so it opens by
  // default. The quoted passage is the reason the finding can be trusted, and
  // hiding it behind a click works against that. With several sources the renter
  // picks, because choosing between them is the point.
  const openSourceId =
    selectedSourceId ?? (evidence.length === 1 ? evidence[0]._id : null);
  const disputable = deduction.assessment === "POTENTIALLY_DISPUTABLE";

  return (
    <>
      <ChainStep index={3} label="Clawback finding" icon={<Scale size={11} />}>
        <div className="rounded-md border border-line bg-surface-muted px-3.5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <AssessmentBadge assessment={deduction.assessment} status="COMPLETED" />
            {disputable && deduction.potentiallyDisputableAmount !== undefined ? (
              <span className="tabular text-[11px] font-semibold text-attention">
                {formatCurrency(deduction.potentiallyDisputableAmount)} potentially disputable
              </span>
            ) : null}
          </div>

          <p className="mt-2.5 text-xs leading-6 text-ink-secondary">{deduction.assessmentReason}</p>

          {deduction.assessmentMissingInformation.length > 0 ? (
            <div className="mt-3 border-t border-line pt-2.5">
              <MicroLabel>What would help</MicroLabel>
              <ul className="mt-1.5 space-y-1">
                {deduction.assessmentMissingInformation.map((item, index) => (
                  <li key={index} className="flex gap-2 text-[11px] leading-5 text-ink-secondary">
                    <span aria-hidden="true" className="mt-1.5 size-1 shrink-0 rounded-full bg-ink-muted" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </ChainStep>

      {evidence.length > 0 ? (
        <ChainStep index={4} label="Evidence" icon={<Quote size={11} />}>
          <ul className="space-y-2">
            {evidence.map((source, index) => (
              <SourceCard
                key={source._id}
                source={source}
                index={index + 1}
                selected={source._id === openSourceId}
                onSelect={() =>
                  onSelectSource(source._id === selectedSourceId ? null : source._id)
                }
              />
            ))}
          </ul>
        </ChainStep>
      ) : null}
    </>
  );
}

/**
 * One supporting source. The passage is collapsed until the source is selected,
 * which is what makes "selecting a source highlights the relevant passage"
 * meaningful rather than decorative.
 */
function SourceCard({
  source,
  index,
  selected,
  onSelect,
}: {
  source: SourceRow;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const label = `Source ${String(index).padStart(2, "0")}`;

  return (
    <li>
      <div
        className={`overflow-hidden rounded-md border transition-colors ${
          selected ? "border-accent-line bg-accent-soft/60" : "border-line bg-surface"
        }`}
      >
        <button
          type="button"
          onClick={onSelect}
          aria-expanded={selected}
          className="flex w-full items-start gap-3 px-3.5 py-3 text-left"
        >
          <span
            className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${
              selected ? "bg-accent text-white" : "bg-surface-muted text-ink-muted"
            }`}
          >
            {label}
          </span>

          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-ink">{source.title}</span>
            <span className="mt-0.5 block text-[11px] text-ink-muted">
              {source.authority} · {source.jurisdiction}
            </span>
          </span>

          <ChevronRight
            size={13}
            aria-hidden="true"
            className={`mt-0.5 shrink-0 text-ink-muted transition-transform ${
              selected ? "rotate-90" : ""
            }`}
          />
        </button>

        {selected ? (
          <div className="animate-fade border-t border-accent-line px-3.5 py-3">
            {source.relevantText ? (
              <blockquote className="border-l-2 border-accent pl-3">
                <p className="text-xs leading-6 text-ink-secondary">{source.relevantText}</p>
              </blockquote>
            ) : (
              <p className="text-[11px] italic text-ink-muted">
                No passage was retrieved from this source, so none is quoted.
              </p>
            )}

            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-accent hover:underline"
            >
              Open the source <ExternalLink size={11} aria-hidden="true" />
            </a>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function Busy({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-xs text-ink-secondary">
      <Loader2 size={12} className="animate-spin text-accent" aria-hidden="true" />
      {children}
    </p>
  );
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
      className="mt-2.5 inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-[11px] font-semibold text-ink transition-colors hover:border-line-strong disabled:opacity-60"
    >
      {busy ? (
        <Loader2 size={11} className="animate-spin" aria-hidden="true" />
      ) : (
        <RefreshCw size={11} aria-hidden="true" />
      )}
      {label}
    </button>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-3 p-5" aria-hidden="true">
      <div className="h-11 animate-pulse rounded-md bg-surface-muted" />
      <div className="h-11 animate-pulse rounded-md bg-surface-muted" />
      <div className="h-11 animate-pulse rounded-md bg-surface-muted" />
    </div>
  );
}

function EmptyDeductions({ isAnalyzing }: { isAnalyzing: boolean }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="flex size-10 items-center justify-center rounded-full border border-line bg-surface-muted text-ink-muted">
        <Receipt size={17} aria-hidden="true" />
      </span>
      <h3 className="mt-4 text-[13px] font-semibold text-ink">
        {isAnalyzing ? "Reading the statement" : "No deductions yet"}
      </h3>
      <p className="mt-2 max-w-sm text-xs leading-5 text-ink-secondary">
        {isAnalyzing
          ? "The statement is being read. Each deduction appears here as soon as it is stored."
          : "Once a deposit statement arrives at this case's address, the charges it lists appear here."}
      </p>
    </div>
  );
}
