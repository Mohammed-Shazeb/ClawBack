"use client";

import Link from "next/link";
import { ArrowUpRight, Plus } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "./app-shell";
import { useDemoUser } from "./demo-user";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function CaseList() {
  const { userId, error } = useDemoUser();
  const cases = useQuery(api.cases.list, userId ? { userId } : "skip");
  return <AppShell><div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10"><div className="flex items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#82908a]">Workspace</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Cases</h1><p className="mt-2 text-sm text-[#69737d]">Every deposit recovery case in one place.</p></div><Link href="/cases/new" className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#173f35] px-4 text-sm font-semibold text-white"><Plus size={17} /> <span className="hidden sm:inline">Create case</span></Link></div>{error ? <p className="mt-6 rounded-lg border border-[#e6c9c5] bg-[#fff7f6] px-4 py-3 text-sm text-[#9c4338]">{error}</p> : null}<div className="mt-8 overflow-hidden rounded-xl border border-[#e4e7eb] bg-white">{cases === undefined ? <div className="p-6 text-sm text-[#89929b]">Loading cases...</div> : cases.length === 0 ? <div className="p-12 text-center text-sm text-[#89929b]">No cases yet. Create one to begin.</div> : <div className="divide-y divide-[#edf0f2]">{cases.map((item) => <Link key={item._id} href={`/cases/${item._id}`} className="grid gap-4 px-5 py-4 hover:bg-[#fafbfb] sm:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_auto] sm:items-center sm:px-6"><div><p className="text-sm font-semibold">Case {item._id.slice(-6).toUpperCase()}</p><p className="mt-1 text-xs text-[#89929b]">{new Date(item.createdAt).toLocaleDateString()}</p></div><p className="text-sm text-[#4a5660]">{item.jurisdiction}</p><p className="text-sm text-[#4a5660]">{currency.format(item.depositAmount)}</p><p className="text-sm text-[#4a5660]">{currency.format(item.totalDeductions)}</p><div><span className="rounded-full bg-[#edf4f1] px-2.5 py-1 text-[11px] font-semibold text-[#235b4c]">{item.status}</span><p className="mt-2 text-xs text-[#89929b]">Disputable: {currency.format(item.potentiallyDisputableAmount)}</p></div><ArrowUpRight size={16} className="text-[#a1abb3]" /></Link>)}</div>}</div></div></AppShell>;
}
