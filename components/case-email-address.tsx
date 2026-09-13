"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { Check, Copy, Loader2, Mail, RefreshCw } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * The case's inbound address. Every case has its own AgentMail inbox, so a
 * statement that arrives there can only belong to this case.
 */
export function CaseEmailAddress({
  caseId,
  userId,
  inboxId,
  inboxStatus,
  inboxError,
}: {
  caseId: string;
  userId: Id<"users">;
  inboxId?: string;
  inboxStatus?: string;
  inboxError?: string;
}) {
  const retryProvision = useAction(api.cases.retryInboxProvision);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setRetrying(true);
    setError(null);

    try {
      await retryProvision({ caseId: caseId as Id<"cases">, userId });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The address could not be set up.");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <section className="rounded-xl border border-[#e4e7eb] bg-white p-5">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-[#edf4f1] text-[#235b4c]">
          <Mail size={16} />
        </span>
        <div>
          <h2 className="text-sm font-semibold">Case email address</h2>
          <p className="mt-0.5 text-xs text-[#89929b]">
            Statements sent here are attached to this case automatically.
          </p>
        </div>
      </div>

      {inboxId ? (
        <AddressChip address={inboxId} />
      ) : inboxStatus === "FAILED" ? (
        <div className="mt-4 rounded-lg border border-[#e6c9c5] bg-[#fff7f6] px-4 py-3">
          <p className="text-sm text-[#9c4338]">
            {inboxError ?? "The case email address could not be set up."}
          </p>
          <button
            type="button"
            onClick={retry}
            disabled={retrying}
            className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg border border-[#cbd8d3] bg-white px-3 text-xs font-semibold text-[#235b4c] hover:bg-[#f6faf8] disabled:opacity-60"
          >
            {retrying ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {retrying ? "Setting up…" : "Set up email address"}
          </button>
        </div>
      ) : (
        <p className="mt-4 inline-flex items-center gap-2 text-sm text-[#89929b]">
          <Loader2 size={15} className="animate-spin" /> Setting up the case email address…
        </p>
      )}

      {error ? (
        <p className="mt-3 text-xs leading-5 text-[#9c4338]">{error}</p>
      ) : null}
    </section>
  );
}

function AddressChip({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be blocked; the address is still readable below.
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-lg border border-[#dce1e4] bg-[#fbfcfc] px-3 py-2.5 font-mono text-xs text-[#35414b]">
        {address}
      </code>
      <button
        type="button"
        onClick={copy}
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#cbd8d3] px-3 text-xs font-semibold text-[#235b4c] hover:bg-[#f6faf8]"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
