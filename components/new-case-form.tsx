"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { AppShell } from "./app-shell";
import { useDemoUser } from "./demo-user";

export function NewCaseForm() {
  const router = useRouter();
  const { userId, error: userError } = useDemoUser();
  const createCase = useMutation(api.cases.create);
  const [jurisdiction, setJurisdiction] = useState("");
  const [deposit, setDeposit] = useState("");
  const [deductions, setDeductions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const depositAmount = Number(deposit);
    const totalDeductions = Number(deductions);
    if (!userId) return setError(userError ?? "Your workspace is still loading. Try again in a moment.");
    if (!jurisdiction.trim()) return setError("Enter the state or jurisdiction for this case.");
    if (!Number.isFinite(depositAmount) || depositAmount < 0) return setError("Enter a valid deposit amount.");
    if (!Number.isFinite(totalDeductions) || totalDeductions < 0) return setError("Enter a valid deductions amount.");
    setSaving(true); setError(null);
    try { const caseId = await createCase({ userId, jurisdiction: jurisdiction.trim(), depositAmount, totalDeductions }); router.push(`/cases/${caseId}`); } catch (reason) { setError(reason instanceof Error ? reason.message : "The case could not be created."); setSaving(false); }
  }

  return <AppShell><div className="mx-auto max-w-3xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10"><Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-[#69737d] hover:text-[#173f35]"><ArrowLeft size={16} /> Back to dashboard</Link><div className="mt-8"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#82908a]">New case</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Start a recovery case</h1><p className="mt-2 text-sm text-[#69737d]">Add the figures from your security-deposit statement. Analysis comes next.</p></div><form onSubmit={submit} className="mt-8 rounded-xl border border-[#e4e7eb] bg-white p-5 sm:p-7"><div className="space-y-6"><Field label="Jurisdiction" hint="The state or local jurisdiction that governs the rental"><input value={jurisdiction} onChange={(event) => setJurisdiction(event.target.value)} placeholder="e.g. California" /></Field><div className="grid gap-6 sm:grid-cols-2"><Field label="Deposit amount" hint="The original security deposit"><div className="relative"><span className="pointer-events-none absolute left-3 top-2.5 text-sm text-[#89929b]">$</span><input className="pl-7" type="number" min="0" step="0.01" value={deposit} onChange={(event) => setDeposit(event.target.value)} placeholder="0.00" /></div></Field><Field label="Total deductions" hint="The amount withheld on the statement"><div className="relative"><span className="pointer-events-none absolute left-3 top-2.5 text-sm text-[#89929b]">$</span><input className="pl-7" type="number" min="0" step="0.01" value={deductions} onChange={(event) => setDeductions(event.target.value)} placeholder="0.00" /></div></Field></div></div>{error ? <p className="mt-5 rounded-lg border border-[#e6c9c5] bg-[#fff7f6] px-3 py-2.5 text-sm text-[#9c4338]">{error}</p> : null}<div className="mt-8 flex flex-col-reverse gap-3 border-t border-[#edf0f2] pt-5 sm:flex-row sm:justify-end"><Link href="/" className="inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-medium text-[#69737d] hover:bg-[#f6f7f9]">Cancel</Link><button disabled={saving} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#173f35] px-4 text-sm font-semibold text-white hover:bg-[#235b4c] disabled:cursor-not-allowed disabled:opacity-60">{saving ? "Creating case..." : <><CheckCircle2 size={17} /> Create case</>}</button></div></form></div></AppShell>;
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) { return <label className="block"><span className="text-sm font-semibold text-[#26323b]">{label}</span><span className="mt-1 block text-xs text-[#89929b]">{hint}</span><div className="mt-2 [&_input]:h-10 [&_input]:w-full [&_input]:rounded-lg [&_input]:border [&_input]:border-[#dce1e4] [&_input]:bg-white [&_input]:px-3 [&_input]:text-sm [&_input]:outline-none [&_input]:transition-colors [&_input]:focus:border-[#6d9387] [&_input]:focus:ring-2 [&_input]:focus:ring-[#dcebe5]">{children}</div></label>; }