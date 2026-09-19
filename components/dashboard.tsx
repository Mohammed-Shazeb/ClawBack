"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { BriefcaseBusiness, FileSearch, Mail, Plus, RefreshCw, ShieldCheck } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { AppShell } from "./app-shell";
import { CaseTable } from "./case-table";
import { useCurrentUser } from "./current-user";
import { CountUp, MicroLabel, Panel, PanelHead } from "./ui/primitives";

export function Dashboard() {
  // The unreachable-backend message is not repeated here: `WorkspaceGate` renders
  // it before this component is reached, so a second copy could never be seen.
  const { userId } = useCurrentUser();
  const cases = useQuery(api.cases.list, userId ? { userId } : "skip");

  const active = cases?.filter((item) => item.status !== "RESOLVED") ?? [];
  const disputable = cases?.reduce((total, item) => total + item.potentiallyDisputableAmount, 0) ?? 0;
  const awaiting = cases?.filter((item) => item.status === "AWAITING_APPROVAL").length ?? 0;

  /*
   * A first run gets a hero rather than four panels reading $0.
   *
   * The reference design opens on one, and this is where it belongs in the real
   * app: a returning renter wants their cases, but someone who has just signed
   * in has nothing to look at, and a dashboard of zeroes explains nothing. The
   * hero only replaces the *empty* dashboard — once a case exists, the working
   * screen is what they came for.
   */
  if (cases !== undefined && cases.length === 0) return <FirstRun />;

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted">
              Overview
            </p>
            <h1 className="mt-2 text-[1.75rem] font-semibold leading-tight tracking-[-0.03em] text-ink">
              Your deposit cases
            </h1>
            <p className="mt-2 text-[13px] leading-6 text-ink-secondary">
              Each case runs from the statement through assessment to an approved dispute letter.
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

        {/* --- The money first, then the counts that explain it --- */}
        <div className="mt-7 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <Panel as="div" className="px-5 py-5">
            <MicroLabel>Potentially disputable across your cases</MicroLabel>
            <p className="mt-3 text-[2.25rem] font-semibold leading-none tracking-[-0.03em] text-ink">
              {cases === undefined ? "—" : <CountUp value={disputable} />}
            </p>
            <p className="mt-3 max-w-md text-[11px] leading-5 text-ink-secondary">
              The sum of the deduction-level findings Clawback has recorded, calculated on the
              server from the stored assessments. This is not money recovered, and it is not a legal
              conclusion.
            </p>
          </Panel>

          <div className="grid grid-cols-2 gap-4">
            <Counter label="Cases" value={cases?.length} icon={<BriefcaseBusiness size={13} />} />
            <Counter label="Open" value={cases ? active.length : undefined} icon={<RefreshCw size={13} />} />
            <Counter
              label="Awaiting your approval"
              value={cases ? awaiting : undefined}
              className="col-span-2"
            />
          </div>
        </div>

        <Panel as="div" className="mt-6 overflow-hidden">
          <PanelHead
            title="Recent cases"
            description="The five most recent."
            aside={
              <Link
                href="/cases"
                className="text-[11px] font-semibold text-accent transition-colors hover:underline"
              >
                View all
              </Link>
            }
          />

          {cases === undefined ? (
            <div className="space-y-2 p-5" aria-hidden="true">
              <div className="h-11 animate-pulse rounded-md bg-surface-muted" />
              <div className="h-11 animate-pulse rounded-md bg-surface-muted" />
            </div>
          ) : cases.length === 0 ? (
            <EmptyCases />
          ) : (
            <CaseTable cases={cases.slice(0, 5)} />
          )}
        </Panel>
      </div>
    </AppShell>
  );
}

/**
 * The first-run screen.
 *
 * One promise, one action, and the three steps that explain what will happen —
 * in that order, because a renter arriving here does not yet know what Clawback
 * does or what it will ask of them.
 *
 * The copy is deliberately narrower than a marketing headline would be. It says
 * what may be worth disputing and that every finding carries evidence; it does
 * not say the money is theirs to take, and it does not promise a recovery. That
 * is the same restraint the rest of the product holds to, and the hero is the
 * easiest place in the whole app to break it.
 */
const FIRST_RUN_STEPS = [
  {
    icon: Mail,
    title: "Send the statement",
    body: "Clawback opens a private email address for the case. Forward the landlord's deduction statement to it.",
  },
  {
    icon: FileSearch,
    title: "The rules are checked",
    body: "Each deduction is read, then checked against official housing guidance for your state — government sources only.",
  },
  {
    icon: ShieldCheck,
    title: "You decide what goes out",
    body: "You get a dispute letter built from that evidence. Nothing reaches the landlord until you approve it.",
  },
];

function FirstRun() {
  return (
    <AppShell>
      <div className="mx-auto max-w-5xl px-5 py-14 sm:px-8 lg:py-20">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted">
          Security-deposit dispute analysis
        </p>

        <h1 className="mt-4 max-w-2xl text-[2.25rem] font-semibold leading-[1.08] tracking-[-0.035em] text-ink sm:text-[3rem]">
          Your deposit, itemized.
        </h1>

        <p className="mt-5 max-w-xl text-[15px] leading-7 text-ink-secondary">
          Clawback reads your landlord&rsquo;s deduction statement, checks it against authoritative
          housing rules, and shows you what may be worth disputing — with the evidence behind every
          finding.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/cases/new"
            className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-[13px] font-semibold text-white transition-colors hover:bg-accent-strong"
          >
            <Plus size={15} aria-hidden="true" />
            Get started
          </Link>
          <a
            href="#how-it-works"
            className="inline-flex h-10 items-center rounded-md border border-line bg-surface px-4 text-[13px] font-semibold text-ink transition-colors hover:border-line-strong"
          >
            How it works
          </a>
        </div>

        <p className="mt-4 text-[11px] leading-5 text-ink-muted">
          No recovery is promised. Clawback is not a law firm and does not give legal advice.
        </p>

        <ol id="how-it-works" className="mt-14 grid scroll-mt-20 gap-8 sm:grid-cols-3">
          {FIRST_RUN_STEPS.map(({ icon: Icon, title, body }, index) => (
            <li key={title}>
              <div className="flex items-center gap-2.5">
                <span
                  className="tabular flex size-6 items-center justify-center rounded-full border border-line bg-surface text-[11px] font-semibold text-ink-muted"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <Icon size={15} className="text-accent" aria-hidden="true" />
              </div>
              <h2 className="mt-3.5 text-[13px] font-semibold text-ink">{title}</h2>
              <p className="mt-2 text-xs leading-6 text-ink-secondary">{body}</p>
            </li>
          ))}
        </ol>
      </div>
    </AppShell>
  );
}

function Counter({
  label,
  value,
  icon,
  className = "",
}: {
  label: string;
  value: number | undefined;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <Panel as="div" className={`px-5 py-4 ${className}`}>
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
        {icon ? <span aria-hidden="true">{icon}</span> : null}
        {label}
      </p>
      <p className="tabular mt-2.5 text-2xl font-semibold leading-none tracking-[-0.02em] text-ink">
        {value === undefined ? "—" : value}
      </p>
    </Panel>
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
        Start a case, then send the deposit statement to the private address Clawback opens for it.
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
