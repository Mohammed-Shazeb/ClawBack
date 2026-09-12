"use client";

import Link from "next/link";
import { ArrowLeft, Clock3, FileText, Gavel, Mail, ScanSearch } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "./app-shell";
import { useDemoUser } from "./demo-user";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function CaseOverview({ caseId }: { caseId: string }) {
  const { userId, error: userError } = useDemoUser();
  const id = caseId as Id<"cases">;
  const caseData = useQuery(api.cases.get, userId ? { caseId: id, userId } : "skip");
  const timeline = useQuery(api.cases.getTimeline, userId ? { caseId: id, userId } : "skip");
  if (caseData === null) return <AppShell><div className="mx-auto max-w-6xl px-5 py-8"><Link href="/cases" className="inline-flex items-center gap-2 text-sm text-[#69737d]"><ArrowLeft size={16} /> All cases</Link><p className="mt-8 rounded-lg border border-[#e6c9c5] bg-[#fff7f6] px-4 py-3 text-sm text-[#9c4338]">Case not found or you do not have access to it.</p></div></AppShell>;
  if (caseData === undefined) return <AppShell><div className="mx-auto max-w-6xl px-5 py-8"><p className="text-sm text-[#89929b]">Loading case...</p></div></AppShell>;
  const error = userError;
  return <AppShell><div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10"><Link href="/cases" className="inline-flex items-center gap-2 text-sm font-medium text-[#69737d] hover:text-[#173f35]"><ArrowLeft size={16} /> All cases</Link>{error ? <p className="mt-8 rounded-lg border border-[#e6c9c5] bg-[#fff7f6] px-4 py-3 text-sm text-[#9c4338]">{error}</p> : caseData === undefined ? <p className="mt-8 text-sm text-[#89929b]">Loading case...</p> : <><div className="mt-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#82908a]">Case {caseId.slice(-6).toUpperCase()}</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">{caseData.jurisdiction} recovery</h1><p className="mt-2 text-sm text-[#69737d]">Created {new Date(caseData.createdAt).toLocaleDateString()}</p></div><span className="w-fit rounded-full bg-[#edf4f1] px-3 py-1.5 text-xs font-semibold text-[#235b4c]">{caseData.status}</span></div><div className="mt-8 grid gap-4 sm:grid-cols-3"><Money label="Deposit" value={caseData.depositAmount} /><Money label="Total deductions" value={caseData.totalDeductions} /><Money label="Potentially disputable" value={caseData.potentiallyDisputableAmount} /></div><div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]"><section className="rounded-xl border border-[#e4e7eb] bg-white"><div className="border-b border-[#edf0f2] px-5 py-4"><h2 className="text-sm font-semibold">Timeline</h2><p className="mt-1 text-xs text-[#89929b]">Actions recorded for this case</p></div>{timeline === undefined ? <p className="p-5 text-sm text-[#89929b]">Loading timeline...</p> : <div className="p-5">{timeline.map((event) => <div key={event._id} className="relative flex gap-3 pb-6 last:pb-0"><span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-[#edf4f1] text-[#235b4c]"><Clock3 size={14} /></span><div><p className="text-sm font-medium">{event.description}</p><p className="mt-1 text-xs text-[#89929b]">{new Date(event.createdAt).toLocaleString()}</p></div></div>)}</div>}</section><section className="space-y-3"><FutureBlock icon={<ScanSearch size={17} />} title="Deductions" text="Statement analysis will appear here." /><FutureBlock icon={<FileText size={17} />} title="Evidence" text="Evidence collection is not started yet." /><FutureBlock icon={<Gavel size={17} />} title="Sources & dispute letter" text="Applicable regulations and drafting will appear here." /><FutureBlock icon={<Mail size={17} />} title="Response" text="Landlord communication will appear here." /></section></div></>}</div></AppShell>;
}

function Money({ label, value }: { label: string; value: number }) { return <div className="rounded-xl border border-[#e4e7eb] bg-white p-5"><p className="text-xs text-[#89929b]">{label}</p><p className="mt-3 text-xl font-semibold tracking-[-0.03em]">{currency.format(value)}</p></div>; }
function FutureBlock({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) { return <div className="flex gap-3 rounded-xl border border-dashed border-[#d9dfe1] bg-[#fbfcfc] p-4"><span className="text-[#82908a]">{icon}</span><div><h3 className="text-sm font-semibold text-[#35414b]">{title}</h3><p className="mt-1 text-xs leading-5 text-[#89929b]">{text}</p></div></div>; }