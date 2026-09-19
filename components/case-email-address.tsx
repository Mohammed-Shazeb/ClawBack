"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { Check, Copy, Loader2, Mail, RefreshCw } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Panel, PanelHead } from "./ui/primitives";

/**
 * Turns a stored provisioning failure into something a renter can act on.
 *
 * The raw error is kept on the case for debugging and is still shown on hover,
 * but it is a provider JSON body — a blob of codes and a console URL. The case
 * worth translating is the plan limit, because it is the one failure whose fix is
 * an action the renter can take (free an address, or upgrade), rather than
 * something to wait out or report.
 */
function readableInboxError(raw: string): string {
  if (/inbox limit exceeded|limit_exceeded/i.test(raw)) {
    return "Your email provider's plan limits how many addresses exist, and they are all in use. Free one up in AgentMail — or upgrade the plan — then set this address up again.";
  }
  return raw;
}

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
    <Panel as="section" aria-label="Case email address">
      <PanelHead
        icon={<Mail size={14} aria-hidden="true" />}
        title="Case email address"
        description="Statements sent here are attached to this case automatically."
      />

      <div className="px-5 py-4">
        {inboxId ? (
          <AddressChip address={inboxId} />
        ) : inboxStatus === "FAILED" ? (
          <div className="rounded-md border border-danger-line bg-danger-soft px-3.5 py-3">
            <p className="text-xs leading-5 text-danger" title={inboxError}>
              {inboxError
                ? readableInboxError(inboxError)
                : "The case email address could not be set up."}
            </p>
            <button
              type="button"
              onClick={retry}
              disabled={retrying}
              className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-[11px] font-semibold text-ink transition-colors hover:border-line-strong disabled:opacity-60"
            >
              {retrying ? (
                <Loader2 size={12} className="animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw size={12} aria-hidden="true" />
              )}
              {retrying ? "Setting up…" : "Set up email address"}
            </button>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-xs text-ink-secondary">
            <Loader2 size={13} className="animate-spin text-accent" aria-hidden="true" />
            Setting up the case email address…
          </p>
        )}

        {error ? <p className="mt-3 text-[11px] leading-5 text-danger">{error}</p> : null}
      </div>
    </Panel>
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
    <div className="flex flex-wrap items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-surface-muted px-3 py-2 font-mono text-[11px] text-ink">
        {address}
      </code>
      <button
        type="button"
        onClick={copy}
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-[11px] font-semibold text-ink transition-colors hover:border-line-strong"
      >
        {copied ? (
          <Check size={12} className="text-accent" aria-hidden="true" />
        ) : (
          <Copy size={12} aria-hidden="true" />
        )}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
