"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { BriefcaseBusiness, Plus } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { AppShell } from "./app-shell";
import { CaseTable } from "./case-table";
import { useCurrentUser } from "./current-user";
import { Panel, PanelHead } from "./ui/primitives";

export function CaseList() {
  // The unreachable-backend message is not repeated here: `WorkspaceGate` renders
  // it before this component is reached, so a second copy could never be seen.
  const { userId } = useCurrentUser();
  const cases = useQuery(api.cases.list, userId ? { userId } : "skip");

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted">
              Workspace
            </p>
            <h1 className="mt-2 text-[1.75rem] font-semibold leading-tight tracking-[-0.03em] text-ink">
              Cases
            </h1>
            <p className="mt-2 text-[13px] leading-6 text-ink-secondary">
              Every deposit dispute, and the amount the evidence indicates may be disputable.
            </p>
          </div>
          <Link
            href="/cases/new"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-accent-strong"
          >
            <Plus size={15} aria-hidden="true" />
            Create case
          </Link>
        </header>

        <Panel as="div" className="mt-7 overflow-hidden">
          <PanelHead
            title="All cases"
            description="Newest first."
            aside={
              cases ? (
                <span className="tabular text-[11px] font-medium text-ink-muted">{cases.length}</span>
              ) : null
            }
          />

          {cases === undefined ? (
            <LoadingRows />
          ) : cases.length === 0 ? (
            <EmptyCases />
          ) : (
            <CaseTable cases={cases} />
          )}
        </Panel>
      </div>
    </AppShell>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-2 p-5" aria-hidden="true">
      <div className="h-11 animate-pulse rounded-md bg-surface-muted" />
      <div className="h-11 animate-pulse rounded-md bg-surface-muted" />
      <div className="h-11 animate-pulse rounded-md bg-surface-muted" />
    </div>
  );
}

function EmptyCases() {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <span
        className="flex size-10 items-center justify-center rounded-full border border-line bg-surface-muted text-ink-muted"
        aria-hidden="true"
      >
        <BriefcaseBusiness size={17} />
      </span>
      <h3 className="mt-4 text-[13px] font-semibold text-ink">No cases yet</h3>
      <p className="mt-2 max-w-sm text-xs leading-5 text-ink-secondary">
        Start a case with the figures from your deposit statement. Clawback opens a private email
        address so the statement can be read automatically.
      </p>
      <Link
        href="/cases/new"
        className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3.5 text-[13px] font-semibold text-ink transition-colors hover:border-line-strong"
      >
        <Plus size={14} aria-hidden="true" />
        Create case
      </Link>
    </div>
  );
}
