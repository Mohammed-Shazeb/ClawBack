"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { Check, Copy, Loader2, Mail, RefreshCw } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { useCurrentUser } from "@/components/current-user";
import { useCaseData } from "./case-data-provider";

/**
 * The case's inbound address, shown in the main UI.
 *
 * Every case has its own AgentMail inbox, so a statement that arrives there can
 * only belong to this case. The empty state already tells the renter to forward
 * the statement to "a private address" — this is the panel that finally names
 * it. Without it the instruction pointed at something the app never revealed.
 *
 * Three states, and none of them is decoration: the address exists (`inboxId`),
 * the provider refused to create it (`inboxStatus === "FAILED"` — what the
 * fourth case onward hits on a three-inbox plan), or it is still being created.
 * The failure is the only one the renter can act on, so it gets the retry.
 */
export function CaseInboxAddress() {
  const { caseId, inboxId, inboxStatus, inboxError } = useCaseData();
  const { userId } = useCurrentUser();
  const retryProvision = useAction(api.cases.retryInboxProvision);

  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    if (!caseId) return;

    setRetrying(true);
    setError(null);

    try {
      await retryProvision({ caseId, userId: userId ?? undefined });
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "The address could not be set up.",
      );
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4 shadow-flat">
      <div className="flex items-start gap-3">
        <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium text-foreground">Your case address</p>
          <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">
            Forward your landlord&apos;s deduction statement here. Mail that arrives is
            attached to this case and nothing else.
          </p>

          <div className="mt-3">
            {inboxId ? (
              <AddressChip address={inboxId} />
            ) : inboxStatus === "FAILED" ? (
              <>
                <p
                  className="text-[12px] leading-5 text-danger"
                  title={inboxError ?? undefined}
                >
                  {inboxError
                    ? readableInboxError(inboxError)
                    : "This case's address could not be set up."}
                </p>
                <button
                  type="button"
                  onClick={retry}
                  disabled={retrying}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] font-medium text-foreground transition-colors hover:border-border-strong disabled:opacity-60"
                >
                  {retrying ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                  )}
                  {retrying ? "Setting up…" : "Try setting it up again"}
                </button>
              </>
            ) : (
              <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                Setting up this case&apos;s address…
              </p>
            )}
          </div>

          {error ? (
            <p className="mt-3 text-[12px] leading-5 text-danger">{error}</p>
          ) : null}
        </div>
      </div>
    </div>
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
      // Clipboard access can be blocked. The address stays readable either way,
      // so a failed copy is not worth an error state.
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-surface-sunken px-3 py-2 font-mono text-[12px] text-foreground">
        {address}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${address}`}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] font-medium text-foreground transition-colors hover:border-border-strong"
      >
        {copied ? (
          <Check className="size-3.5 text-accent" aria-hidden="true" />
        ) : (
          <Copy className="size-3.5" aria-hidden="true" />
        )}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/**
 * Turns a stored provisioning failure into something a renter can act on.
 *
 * The raw error is a provider JSON body — codes and a console URL — and is kept
 * on the case for debugging and still shown on hover. The case worth translating
 * is the plan limit, because it is the one whose fix is an action the renter can
 * take (free an address, or upgrade) rather than something to wait out.
 */
function readableInboxError(raw: string): string {
  if (/inbox limit exceeded|limit_exceeded/i.test(raw)) {
    return "Your email provider's plan limits how many addresses exist, and they are all in use. Free one up in AgentMail — or upgrade the plan — then try again.";
  }
  return raw;
}
