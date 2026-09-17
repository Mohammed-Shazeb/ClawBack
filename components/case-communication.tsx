"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, ChevronDown, Loader2, RefreshCw } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatCurrency, formatDateTime } from "@/lib/format";

type Analysis = {
  summary: string;
  acceptsDispute: boolean;
  rejectsDispute: boolean;
  requestsMoreInformation: boolean;
  offersPartialReimbursement: boolean;
  offeredAmount?: number;
  providesNewEvidence: boolean;
  newEvidenceSummary?: string;
  followUpQuestions: string[];
  missingInformation: string[];
};

/**
 * The case's correspondence: the dispute that was sent, and anything the
 * landlord sent back.
 *
 * The landlord's own words are always shown as written. The structured reading
 * sits alongside them and is labelled as a reading, never presented as a legal
 * position or as a substitute for the message.
 */
export function CaseCommunication({
  caseId,
  userId,
}: {
  caseId: string;
  userId: Id<"users">;
}) {
  const messages = useQuery(api.emails.listCommunication, {
    caseId: caseId as Id<"cases">,
    userId,
  });

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (messages === undefined) {
    return (
      <section className="rounded-xl border border-[#e4e7eb] bg-white">
        <CommunicationHeader />
        <p className="p-5 text-sm text-[#89929b]">Loading messages…</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-[#e4e7eb] bg-white">
      <CommunicationHeader />

      {messages.length === 0 ? (
        <div className="p-5">
          <p className="text-sm text-[#4a5660]">No messages yet.</p>
          <p className="mt-1 text-xs leading-5 text-[#89929b]">
            Approve the dispute letter and send it. Anything the landlord sends back will appear
            here, attached to this case.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[#edf0f2]">
          {messages.map((message) => {
            const outbound = message.direction === "OUTBOUND";
            const at = message.sentAt ?? message.receivedAt ?? message.createdAt;
            const isOpen = expanded[message._id] ?? !outbound;

            return (
              <div key={message._id} className="p-5">
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${
                      outbound ? "bg-[#edf4f1] text-[#235b4c]" : "bg-[#eef1f6] text-[#3f5673]"
                    }`}
                  >
                    {outbound ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {outbound ? "You → Landlord" : "Landlord → You"}
                    </p>
                    <p className="mt-0.5 text-xs text-[#89929b]">{formatDateTime(at)}</p>
                    <p className="mt-1.5 truncate text-xs text-[#4a5660]">{message.subject}</p>

                    <div className="mt-2">
                      <DirectionStatus message={message} />
                    </div>

                    {!outbound ? (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded((current) => ({ ...current, [message._id]: !isOpen }))
                          }
                          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[#235b4c] hover:underline"
                        >
                          <ChevronDown
                            size={13}
                            className={isOpen ? "rotate-180 transition-transform" : "transition-transform"}
                          />
                          {isOpen ? "Hide response" : "View response"}
                        </button>

                        {isOpen ? (
                          <ResponseDetail messageId={message._id} userId={userId} message={message} />
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CommunicationHeader() {
  return (
    <div className="border-b border-[#edf0f2] px-5 py-4">
      <h2 className="text-sm font-semibold">Communication</h2>
      <p className="mt-1 text-xs text-[#89929b]">
        The dispute sent to the landlord, and their replies
      </p>
    </div>
  );
}

type Message = {
  _id: string;
  direction: string;
  body: string;
  sendStatus?: string;
  sendError?: string;
  responseAnalysisStatus?: string;
  responseAnalysis?: Analysis;
  responseAnalysisError?: string;
};

function DirectionStatus({ message }: { message: Message }) {
  if (message.direction === "OUTBOUND") {
    if (message.sendStatus === "SENT") {
      return <p className="text-xs text-[#235b4c]">Dispute letter sent</p>;
    }
    if (message.sendStatus === "SENDING") {
      return (
        <p className="flex items-center gap-1.5 text-xs text-[#69737d]">
          <Loader2 size={12} className="animate-spin" /> Sending…
        </p>
      );
    }
    if (message.sendStatus === "FAILED") {
      return (
        <p className="flex items-start gap-1.5 text-xs leading-5 text-[#9c4338]">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {message.sendError ?? "Sending failed."} You can retry from the dispute letter above.
        </p>
      );
    }
    return <p className="text-xs text-[#89929b]">Send not started</p>;
  }

  if (message.responseAnalysisStatus === "COMPLETED" && message.responseAnalysis) {
    return <p className="text-xs text-[#3f5673]">Response received and read</p>;
  }
  if (message.responseAnalysisStatus === "FAILED") {
    return (
      <p className="flex items-start gap-1.5 text-xs leading-5 text-[#8a6d2f]">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
        Response received. It could not be read automatically.
      </p>
    );
  }
  if (
    message.responseAnalysisStatus === "PENDING" ||
    message.responseAnalysisStatus === "ANALYZING"
  ) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-[#69737d]">
        <Loader2 size={12} className="animate-spin" /> Response received. Reading it…
      </p>
    );
  }

  return <p className="text-xs text-[#3f5673]">Response received</p>;
}

function ResponseDetail({
  messageId,
  userId,
  message,
}: {
  messageId: string;
  userId: Id<"users">;
  message: Message;
}) {
  const retryAnalysis = useMutation(api.responses.retryResponseAnalysis);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analysis = message.responseAnalysis;

  return (
    <div className="mt-3 space-y-3">
      {/* The landlord's own words, always shown as written. */}
      <div className="rounded-lg border border-[#e4e7eb] bg-[#fbfcfc] px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#a0a8ae]">
          What the landlord wrote
        </p>
        <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-[#26323b]">
          {message.body || "This message had no readable text."}
        </p>
      </div>

      {analysis ? (
        <div className="rounded-lg border border-[#e4e7eb] px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#a0a8ae]">
            What the reply appears to say
          </p>
          <p className="mt-2 text-[13px] leading-6 text-[#26323b]">{analysis.summary}</p>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <Flag on={analysis.acceptsDispute} label="Accepts the dispute" />
            <Flag on={analysis.rejectsDispute} label="Rejects the dispute" />
            <Flag on={analysis.requestsMoreInformation} label="Asks for more information" />
            <Flag
              on={analysis.offersPartialReimbursement}
              label={
                analysis.offeredAmount !== undefined
                  ? `Offers ${formatCurrency(analysis.offeredAmount)}`
                  : "Offers to pay"
              }
            />
            <Flag on={analysis.providesNewEvidence} label="Provides new material" />
          </div>

          {analysis.newEvidenceSummary ? (
            <Detail label="New material described" value={analysis.newEvidenceSummary} />
          ) : null}

          {analysis.followUpQuestions.length > 0 ? (
            <ListDetail label="The reply asks for" items={analysis.followUpQuestions} />
          ) : null}

          {analysis.missingInformation.length > 0 ? (
            <ListDetail label="Left unclear" items={analysis.missingInformation} />
          ) : null}

          <p className="mt-3 border-t border-[#edf0f2] pt-2.5 text-[11px] leading-5 text-[#89929b]">
            This is an automatic reading of the message, not legal advice and not a statement
            about your rights.
          </p>
        </div>
      ) : null}

      {message.responseAnalysisStatus === "FAILED" ? (
        <div className="rounded-lg border border-[#e6dfc9] bg-[#fffdf6] px-4 py-3">
          <p className="text-xs leading-5 text-[#8a6d2f]">
            {message.responseAnalysisError ??
              "This reply could not be read automatically. The message itself is stored above."}
          </p>
          <div className="mt-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await retryAnalysis({ emailId: messageId as Id<"emails">, userId });
                } catch (reason) {
                  setError(
                    reason instanceof Error ? reason.message : "The reply could not be re-read."
                  );
                } finally {
                  setBusy(false);
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e4e7eb] bg-white px-2.5 py-1.5 text-xs font-medium text-[#35414b] hover:border-[#cfd6da] disabled:opacity-50"
            >
              <RefreshCw size={12} />
              {busy ? "Retrying…" : "Try reading it again"}
            </button>
          </div>
          {error ? <p className="mt-2 text-[11px] text-[#9c4338]">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function Flag({ on, label }: { on: boolean; label: string }) {
  if (!on) return null;

  return (
    <span className="inline-flex items-center rounded-full bg-[#eef1f6] px-2.5 py-1 text-[11px] font-medium text-[#3f5673]">
      {label}
    </span>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#a0a8ae]">
        {label}
      </p>
      <p className="mt-1 text-xs leading-5 text-[#4a5660]">{value}</p>
    </div>
  );
}

function ListDetail({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="mt-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#a0a8ae]">
        {label}
      </p>
      <ul className="mt-1 space-y-1">
        {items.map((item) => (
          <li key={item} className="text-xs leading-5 text-[#4a5660]">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
