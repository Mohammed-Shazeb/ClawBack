"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BriefcaseBusiness, FileText, LayoutDashboard, Settings, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

const navigation = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/cases", label: "Cases", icon: BriefcaseBusiness },
  { href: "/evidence", label: "Evidence", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-[#f6f7f9] text-[#18212b]">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-[#e4e7eb] bg-white px-5 py-6 lg:flex lg:flex-col">
        <Link href="/" className="flex items-center gap-3 px-2"><span className="flex size-9 items-center justify-center rounded-xl bg-[#173f35] text-white"><ShieldCheck size={19} /></span><span className="text-lg font-semibold tracking-[-0.03em]">clawback</span></Link>
        <nav className="mt-12 space-y-1"><p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8b949e]">Workspace</p>{navigation.map(({ href, label, icon: Icon }) => { const active = href === "/" ? pathname === "/" : pathname.startsWith(href); return <Link key={href} href={href} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${active ? "bg-[#edf4f1] text-[#173f35]" : "text-[#69737d] hover:bg-[#f4f5f6] hover:text-[#18212b]"}`}><Icon size={17} />{label}</Link>; })}</nav>
        <div className="mt-auto rounded-xl border border-[#e4e7eb] bg-[#fafbfb] p-3"><p className="text-xs font-semibold text-[#35414b]">Demo workspace</p><p className="mt-1 text-xs leading-5 text-[#89929b]">Your recovery cases stay organized here.</p></div>
      </aside>
      <main className="min-h-screen lg:pl-64">
        <header className="flex h-16 items-center justify-between border-b border-[#e4e7eb] bg-white px-5 sm:px-8 lg:px-10"><Link href="/" className="flex items-center gap-2.5 lg:hidden"><ShieldCheck size={20} className="text-[#173f35]" /><span className="font-semibold tracking-[-0.03em]">clawback</span></Link><div className="ml-auto flex items-center gap-3 text-sm text-[#69737d]"><span className="hidden sm:inline">Demo workspace</span><span className="flex size-8 items-center justify-center rounded-full bg-[#dcebe5] text-xs font-semibold text-[#235b4c]">DR</span></div></header>
        <div className="border-b border-[#e4e7eb] bg-white px-5 py-2 lg:hidden"><nav className="flex gap-1 overflow-x-auto">{navigation.map(({ href, label }) => <Link key={href} href={href} className="whitespace-nowrap rounded-md px-3 py-2 text-xs font-medium text-[#69737d] hover:bg-[#f4f5f6]">{label}</Link>)}</nav></div>
        {children}
      </main>
    </div>
  );
}