"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { AlertTriangle, CheckCircle2, Loader2, Paperclip, RefreshCw } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDateTime, formatFileSize } from "@/lib/format";

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
    <section className="overflow-hidden rounded-xl border border-[#e4e7eb] bg-white">
      <div className="border-b border-[#edf0f2] px-5 py-4">
        <h2 className="text-sm font-semibold">Statement</h2>
        <p className="mt-1 text-xs text-[#89929b]">Inbound mail for this case</p>
      </div>

      <div className="px-5 py-4">
        {emails === undefined ? (
          <p className="text-sm text-[#89929b]">Loading statement activity…</p>
        ) : emails.length === 0 ? (
          <p className="text-sm text-[#89929b]">
            Nothing has arrived yet. Send the deposit statement to the case email address
            above.
          </p>
        ) : (
          <div className="space-y-3">
            {analyzing ? (
              <StatusBanner
                tone="working"
                icon={<Loader2 size={16} className="animate-spin" />}
                title="Analyzing statement…"
                text="The email was received and is being read into structured deductions."
              />
            ) : null}

            {!analyzing && failed ? (
              <StatusBanner
                tone="error"
                icon={<AlertTriangle size={16} />}
                title="Statement could not be analyzed"
                text={failed.processingError ?? "The statement could not be read."}
                action={
                  <button
                    type="button"
                    onClick={() => retry(failed._id)}
                    disabled={retryingId === failed._id}
                    className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg border border-[#cbd8d3] bg-white px-3 text-xs font-semibold text-[#235b4c] hover:bg-[#f6faf8] disabled:opacity-60"
                  >
                    {retryingId === failed._id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    {retryingId === failed._id ? "Retrying…" : "Retry analysis"}
                  </button>
                }
              />
            ) : null}

            {!analyzing && !failed && processed ? (
              <StatusBanner
                tone="done"
                icon={<CheckCircle2 size={16} />}
                title="Statement analyzed"
                text={`${deductionCount} deduction${
                  deductionCount === 1 ? "" : "s"
                } extracted from the statement.`}
              />
            ) : null}

            {error ? (
              <p className="rounded-lg border border-[#e6c9c5] bg-[#fff7f6] px-3 py-2.5 text-xs text-[#9c4338]">
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
    </section>
  );
}

const TONES = {
  working: "border-[#d8e5e0] bg-[#f4f9f7] text-[#235b4c]",
  done: "border-[#d8e5e0] bg-[#f4f9f7] text-[#235b4c]",
  error: "border-[#e6c9c5] bg-[#fff7f6] text-[#9c4338]",
} as const;

function StatusBanner({
  tone,
  icon,
  title,
  text,
  action,
}: {
  tone: keyof typeof TONES;
  icon: React.ReactNode;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${TONES[tone]}`}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5">{icon}</span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-xs leading-5 opacity-90">{text}</p>
          {action}
        </div>
      </div>
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  RECEIVED: "bg-[#f3f5f5] text-[#69737d]",
  PROCESSING: "bg-[#edf4f1] text-[#235b4c]",
  PROCESSED: "bg-[#edf4f1] text-[#235b4c]",
  FAILED: "bg-[#fff1ef] text-[#9c4338]",
};

function EmailRow({ email }: { email: StatementEmail }) {
  const status = email.processingStatus ?? (email.direction === "OUTBOUND" ? "SENT" : "RECEIVED");

  return (
    <li className="rounded-lg border border-[#edf0f2] px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {email.subject || "(no subject)"}
          </p>
          <p className="mt-1 truncate text-xs text-[#89929b]">
            {email.sender ?? "Unknown sender"} · {formatDateTime(email.receivedAt ?? email.createdAt)}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
            STATUS_STYLES[status] ?? STATUS_STYLES.RECEIVED
          }`}
        >
          {status}
        </span>
      </div>

      {email.attachments.length > 0 ? (
        <div className="mt-2.5 border-t border-[#f2f4f5] pt-2.5">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#69737d]">
            <Paperclip size={12} />
            {email.attachments.length} attachment
            {email.attachments.length === 1 ? "" : "s"}
          </p>
          <ul className="mt-1 space-y-0.5">
            {email.attachments.map((attachment, index) => (
              <li key={`${email._id}-${index}`} className="text-[11px] text-[#89929b]">
                {attachment.filename ?? attachment.contentType ?? "Unnamed attachment"}
                {attachment.size ? ` · ${formatFileSize(attachment.size)}` : ""}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-[#a0a8ae]">
            Attachment contents are not read yet — only the email text is analyzed.
          </p>
        </div>
      ) : null}
    </li>
  );
}
