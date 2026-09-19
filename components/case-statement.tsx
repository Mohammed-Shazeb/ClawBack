"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { AlertTriangle, CheckCircle2, Loader2, Paperclip, RefreshCw } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDateTime, formatFileSize } from "@/lib/format";
import { Badge, Panel, PanelHead } from "./ui/primitives";

export type StatementEmail = {
  _id: string;
  direction: string;
  subject: string;
  sender?: string;
  recipient?: string;
  receivedAt?: number;
  processingStatus?: string;
  processingError?: string;
  attachments: Array<{ filename?: string; contentType?: string; size?: number }>;
  createdAt?: number;
};

/**
 * Live statement state for a case: what arrived, what is being read, and what
 * failed. Everything here comes from Convex subscriptions, so no refresh is
 * needed after a webhook.
 *
 * The progression shown is the real pipeline's own — received, then read, then
 * itemized. Nothing is staged, and no step is displayed before it has actually
 * happened.
 */
export function CaseStatement({
  userId,
  emails,
  deductionCount,
}: {
  userId: Id<"users">;
  emails: StatementEmail[] | undefined;
  deductionCount: number;
}) {
  const retryProcessing = useMutation(api.emails.retryProcessing);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyzing = emails?.find(
    (email) => email.processingStatus === "RECEIVED" || email.processingStatus === "PROCESSING"
  );
  const failed = emails?.find((email) => email.processingStatus === "FAILED");
  const processed = emails?.find((email) => email.processingStatus === "PROCESSED");

  async function retry(emailId: string) {
    setRetryingId(emailId);
    setError(null);

    try {
      await retryProcessing({ emailId: emailId as Id<"emails">, userId });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The statement could not be retried.");
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <Panel as="section" className="overflow-hidden" aria-label="Statement">
      <PanelHead title="Statement" description="Inbound mail for this case" />

      <div className="px-5 py-4">
        {emails === undefined ? (
          <p className="text-xs text-ink-muted">Loading statement activity…</p>
        ) : emails.length === 0 ? (
          <p className="text-xs leading-5 text-ink-secondary">
            Nothing has arrived yet. Send the deposit statement to the case email address above.
          </p>
        ) : (
          <div className="space-y-3">
            {analyzing ? (
              <StatusBanner
                tone="working"
                icon={<Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                title="Reading the statement"
                text="The email was received and is being read into structured deductions."
                progress
              />
            ) : null}

            {!analyzing && failed ? (
              <StatusBanner
                tone="error"
                icon={<AlertTriangle size={14} aria-hidden="true" />}
                title="Statement could not be read"
                text={failed.processingError ?? "The statement could not be read."}
                action={
                  <button
                    type="button"
                    onClick={() => retry(failed._id)}
                    disabled={retryingId === failed._id}
                    className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-[11px] font-semibold text-ink transition-colors hover:border-line-strong disabled:opacity-60"
                  >
                    {retryingId === failed._id ? (
                      <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <RefreshCw size={12} aria-hidden="true" />
                    )}
                    {retryingId === failed._id ? "Retrying…" : "Retry reading"}
                  </button>
                }
              />
            ) : null}

            {!analyzing && !failed && processed ? (
              <StatusBanner
                tone="done"
                icon={<CheckCircle2 size={14} aria-hidden="true" />}
                title="Statement read"
                text={`${deductionCount} deduction${
                  deductionCount === 1 ? "" : "s"
                } itemized from the statement.`}
              />
            ) : null}

            {error ? (
              <p className="rounded-md border border-danger-line bg-danger-soft px-3 py-2.5 text-[11px] leading-5 text-danger">
                {error}
              </p>
            ) : null}

            <ul className="space-y-2">
              {emails.map((email) => (
                <EmailRow key={email._id} email={email} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}

const TONES = {
  working: "border-line bg-surface-muted text-ink-secondary",
  done: "border-accent-line bg-accent-soft text-accent",
  error: "border-danger-line bg-danger-soft text-danger",
} as const;

function StatusBanner({
  tone,
  icon,
  title,
  text,
  action,
  progress = false,
}: {
  tone: keyof typeof TONES;
  icon: React.ReactNode;
  title: string;
  text: string;
  action?: React.ReactNode;
  /** Shows the indeterminate working line. Only used while work is really running. */
  progress?: boolean;
}) {
  return (
    <div className={`overflow-hidden rounded-md border ${TONES[tone]}`}>
      <div className="flex items-start gap-2.5 px-3.5 py-3">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <div className="min-w-0">
          <p className="text-xs font-semibold">{title}</p>
          <p className="mt-1 text-[11px] leading-5 opacity-90">{text}</p>
          {action}
        </div>
      </div>
      {progress ? (
        <div
          className="h-px w-full bg-accent-line"
          role="presentation"
          aria-hidden="true"
        >
          <div className="animate-sweep h-px w-1/3 bg-accent" />
        </div>
      ) : null}
    </div>
  );
}

const STATUS_TONE: Record<string, "neutral" | "accent" | "danger"> = {
  RECEIVED: "neutral",
  PROCESSING: "accent",
  PROCESSED: "accent",
  FAILED: "danger",
};

const STATUS_LABEL: Record<string, string> = {
  RECEIVED: "Received",
  PROCESSING: "Reading",
  PROCESSED: "Read",
  FAILED: "Could not be read",
  SENT: "Sent",
};

function EmailRow({ email }: { email: StatementEmail }) {
  const status = email.processingStatus ?? (email.direction === "OUTBOUND" ? "SENT" : "RECEIVED");

  return (
    <li className="rounded-md border border-line px-3.5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-ink">{email.subject || "(no subject)"}</p>
          <p className="mt-1 truncate text-[11px] text-ink-muted">
            {email.sender ?? "Unknown sender"} · {formatDateTime(email.receivedAt ?? email.createdAt)}
          </p>
        </div>
        <Badge tone={STATUS_TONE[status] ?? "neutral"}>
          {STATUS_LABEL[status] ?? status}
        </Badge>
      </div>

      {email.attachments.length > 0 ? (
        <div className="mt-2.5 border-t border-line pt-2.5">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-secondary">
            <Paperclip size={11} aria-hidden="true" />
            {email.attachments.length} attachment{email.attachments.length === 1 ? "" : "s"}
          </p>
          <ul className="mt-1 space-y-0.5">
            {email.attachments.map((attachment, index) => (
              <li key={`${email._id}-${index}`} className="text-[11px] text-ink-muted">
                {attachment.filename ?? attachment.contentType ?? "Unnamed attachment"}
                {attachment.size ? ` · ${formatFileSize(attachment.size)}` : ""}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-ink-muted">
            Attachment contents are not read yet — only the email text is analyzed.
          </p>
        </div>
      ) : null}
    </li>
  );
}
