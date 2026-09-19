"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  Loader2,
  RefreshCw,
} from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { Badge, MicroLabel, Panel, PanelHead } from "./ui/primitives";

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
      <Panel as="section" aria-label="Communication">
        <CommunicationHeader />
        <p className="px-5 py-4 text-xs text-ink-muted">Loading messages…</p>
      </Panel>
    );
  }

  return (
    <Panel as="section" aria-label="Communication">
      <CommunicationHeader />

      {messages.length === 0 ? (
        <div className="px-5 py-5">
          <p className="text-[13px] text-ink">No messages yet.</p>
          <p className="mt-1.5 text-xs leading-5 text-ink-secondary">
            Approve the dispute letter and send it. Anything the landlord sends back will appear
            here, attached to this case.
          </p>
        </div>
      ) : (
        <ol className="divide-y divide-line">
          {messages.map((message) => {
            const outbound = message.direction === "OUTBOUND";
            const at = message.sentAt ?? message.receivedAt ?? message.createdAt;
            const isOpen = expanded[message._id] ?? !outbound;

            return (
              <li key={message._id} className="px-5 py-4">
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border ${
                      outbound
                        ? "border-accent-line bg-accent-soft text-accent"
                        : "border-line bg-surface-muted text-ink-secondary"
                    }`}
                  >
                    {outbound ? <ArrowUpRight size={12} /> : <ArrowDownLeft size={12} />}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <p className="text-[13px] font-medium text-ink">
                        {outbound ? "You → Landlord" : "Landlord → You"}
                      </p>
                      <p className="text-[11px] text-ink-muted">{formatDateTime(at)}</p>
                    </div>

                    <p className="mt-1 truncate text-[11px] text-ink-secondary">{message.subject}</p>

                    <div className="mt-1.5">
                      <DirectionStatus message={message} />
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((current) => ({ ...current, [message._id]: !isOpen }))
                      }
                      aria-expanded={isOpen}
                      className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-accent transition-colors hover:underline"
                    >
                      <ChevronDown
                        size={12}
                        aria-hidden="true"
                        className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
                      />
                      {outbound
                        ? isOpen
                          ? "Hide what was sent"
                          : "View what was sent"
                        : isOpen
                          ? "Hide response"
                          : "View response"}
                    </button>

                    {isOpen ? (
                      outbound ? (
                        <SentDetail message={message} />
                      ) : (
                        <ResponseDetail
                          messageId={message._id}
                          userId={userId}
                          message={message}
                        />
                      )
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

function CommunicationHeader() {
  return (
    <PanelHead
      title="Communication"
      description="The dispute sent to the landlord, and their replies"
    />
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
      return (
        <Badge tone="accent">
          <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />
          Dispute letter sent
        </Badge>
      );
    }
    if (message.sendStatus === "SENDING") {
      return (
        <p className="flex items-center gap-1.5 text-[11px] text-ink-secondary">
          <Loader2 size={11} className="animate-spin" aria-hidden="true" /> Sending…
        </p>
      );
    }
    if (message.sendStatus === "FAILED") {
      return (
        <p className="flex items-start gap-1.5 text-[11px] leading-5 text-danger">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
          {message.sendError ?? "Sending failed."} You can retry from the dispute letter above.
        </p>
      );
    }
    return <p className="text-[11px] text-ink-muted">Send not started</p>;
  }

  if (message.responseAnalysisStatus === "COMPLETED" && message.responseAnalysis) {
    return (
      <Badge tone="accent">
        <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />
        Response received and read
      </Badge>
    );
  }
  if (message.responseAnalysisStatus === "FAILED") {
    return (
      <p className="flex items-start gap-1.5 text-[11px] leading-5 text-attention">
        <AlertTriangle size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
        Response received. It could not be read automatically.
      </p>
    );
  }
  if (
    message.responseAnalysisStatus === "PENDING" ||
    message.responseAnalysisStatus === "ANALYZING"
  ) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-ink-secondary">
        <Loader2 size={11} className="animate-spin" aria-hidden="true" /> Response received.
        Reading it…
      </p>
    );
  }

  return (
    <Badge tone="neutral">
      <span className="size-1.5 rounded-full bg-ink-muted" aria-hidden="true" />
      Response received
    </Badge>
  );
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
      <div className="rounded-md border border-line bg-surface-muted px-4 py-3">
        <MicroLabel>What the landlord wrote</MicroLabel>
        <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-ink">
          {message.body || "This message had no readable text."}
        </p>
      </div>

      {analysis ? (
        <div className="rounded-md border border-line bg-surface px-4 py-3">
          <MicroLabel>What the reply appears to say</MicroLabel>
          <p className="mt-2 text-[13px] leading-6 text-ink">{analysis.summary}</p>

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

          <p className="mt-3 border-t border-line pt-2.5 text-[11px] leading-5 text-ink-muted">
            This is an automatic reading of the message, not legal advice and not a statement
            about your rights.
          </p>
        </div>
      ) : null}

      {message.responseAnalysisStatus === "FAILED" ? (
        <div className="rounded-md border border-attention-line bg-attention-soft px-4 py-3">
          <p className="text-[11px] leading-5 text-attention">
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
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-[11px] font-semibold text-ink transition-colors hover:border-line-strong disabled:opacity-50"
            >
              <RefreshCw size={11} aria-hidden="true" />
              {busy ? "Retrying…" : "Try reading it again"}
            </button>
          </div>
          {error ? <p className="mt-2 text-[11px] text-danger">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The exact message that left the building.
 *
 * A sent dispute is immutable, but the letter section above always shows the
 * *current* letter — which, after a revision, is no longer what the landlord
 * received. This renders the message as it was stored at send time, never
 * re-rendered from the letter, so the record of what was sent survives a
 * revision.
 */
function SentDetail({ message }: { message: Message }) {
  return (
    <div className="mt-3 rounded-md border border-line bg-surface-muted px-4 py-3">
      <MicroLabel>What was sent</MicroLabel>
      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-ink">
        {message.body || "This message had no stored text."}
      </p>
      <p className="mt-3 border-t border-line pt-2.5 text-[11px] leading-5 text-ink-muted">
        The message exactly as it was sent. A sent dispute cannot be edited, so this remains the
        record of what the landlord received even after a new draft.
      </p>
    </div>
  );
}

function Flag({ on, label }: { on: boolean; label: string }) {
  if (!on) return null;

  return <Badge tone="neutral">{label}</Badge>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3">
      <MicroLabel>{label}</MicroLabel>
      <p className="mt-1 text-[11px] leading-5 text-ink-secondary">{value}</p>
    </div>
  );
}

function ListDetail({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="mt-3">
      <MicroLabel>{label}</MicroLabel>
      <ul className="mt-1.5 space-y-1">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-[11px] leading-5 text-ink-secondary">
            <span aria-hidden="true" className="mt-1.5 size-1 shrink-0 rounded-full bg-ink-muted" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
