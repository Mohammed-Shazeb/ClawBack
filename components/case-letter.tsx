"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  FileText,
  Loader2,
  Pencil,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatCurrency, formatDateTime } from "@/lib/format";

type LetterStatus = "DRAFT" | "AWAITING_APPROVAL" | "APPROVED" | "SENT";

/**
 * The dispute letter workflow: an editable document, the evidence it rests on,
 * an explicit human approval step, and — once approved — an explicit send.
 *
 * Sending is never automatic. Generation produces a draft, approval marks it
 * ready, and only a separate, deliberate action hands it to the mail provider.
 */
export function CaseLetter({
  caseId,
  userId,
  potentiallyDisputableAmount,
  landlordEmail,
}: {
  caseId: string;
  userId: Id<"users">;
  potentiallyDisputableAmount: number;
  /** The renter-supplied envelope address. Never inferred by Clawback. */
  landlordEmail?: string;
}) {
  const caseKey = caseId as Id<"cases">;

  const letter = useQuery(api.letters.getForCase, { caseId: caseKey, userId });
  const readiness = useQuery(api.letters.getDraftReadiness, { caseId: caseKey, userId });
  const supportingSources = useQuery(api.letters.getSupportingSources, {
    caseId: caseKey,
    userId,
  });

  const draftLetter = useMutation(api.letters.draftLetter);
  const saveEdits = useMutation(api.letters.saveLetterEdits);
  const presentForApproval = useMutation(api.letters.presentForApproval);
  const approveLetter = useMutation(api.letters.approveLetter);
  const startNewDraft = useMutation(api.letters.startNewDraft);
  const sendLetter = useMutation(api.outbound.sendLetter);
  const saveLandlordEmail = useMutation(api.outbound.setLandlordEmail);

  // Local edit buffer. The stored draft is only ever changed by an explicit
  // Save, so an abandoned edit can never overwrite the generated letter.
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const stored = letter ?? null;
  const version = stored?.version ?? 0;

  /**
   * The buffer is keyed to the stored draft's identity and version, so a
   * regeneration or an external update resets it instead of being edited on top
   * of. Deriving it this way avoids a sync effect that would fight the user's
   * in-progress typing.
   */
  const [buffer, setBuffer] = useState({ key: "", recipient: "", subject: "", body: "" });

  const storedKey = stored ? `${stored._id}:${version}` : "";
  const recipient = buffer.key === storedKey ? buffer.recipient : (stored?.recipient ?? "");
  const subject = buffer.key === storedKey ? buffer.subject : (stored?.subject ?? "");
  const body = buffer.key === storedKey ? buffer.body : (stored?.body ?? "");

  const setRecipient = (value: string) => setBuffer({ key: storedKey, recipient: value, subject, body });
  const setSubject = (value: string) => setBuffer({ key: storedKey, recipient, subject: value, body });
  const setBody = (value: string) => setBuffer({ key: storedKey, recipient, subject, body: value });

  /** Drops the buffer so the fields fall back to the stored draft. */
  const resetBuffer = () => setBuffer({ key: "", recipient: "", subject: "", body: "" });

  const isDirty = useMemo(() => {
    if (!stored) return false;
    return (
      recipient !== stored.recipient || subject !== stored.subject || body !== stored.body
    );
  }, [stored, recipient, subject, body]);

  async function run(label: string, action: () => Promise<unknown>, successNotice?: string) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (successNotice) setNotice(successNotice);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That action could not be completed.");
    } finally {
      setBusy(null);
    }
  }

  const generating = stored?.pipelineStatus === "GENERATING";
  const failed = stored?.pipelineStatus === "FAILED";
  const ready = stored?.pipelineStatus === "READY";
  const approved = stored?.status === "APPROVED";
  const awaiting = stored?.status === "AWAITING_APPROVAL";
  const sent = stored?.status === "SENT";
  /** A letter that has been approved or sent can no longer be changed. */
  const locked = approved || sent;

  // The envelope address is entered by the renter; Clawback never guesses it.
  // The buffer falls back to the stored value so a save re-renders cleanly.
  const [emailBuffer, setEmailBuffer] = useState<string | null>(null);
  const address = emailBuffer ?? landlordEmail ?? "";
  const addressDirty = address.trim() !== (landlordEmail ?? "").trim();
  const addressValid = /^[^@\s]+@[^@.\s]+(\.[^@.\s]+)+$/.test(address.trim());

  return (
    <section className="overflow-hidden rounded-xl border border-[#e4e7eb] bg-white">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[#edf0f2] px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold">Dispute letter</h2>
          <p className="mt-1 text-xs text-[#89929b]">
            Drafted from the assessed deductions and the official sources found for this case.
          </p>
        </div>
        {stored ? <LetterStatusPill status={stored.status} /> : null}
      </header>

      <div className="px-5 py-5">
        {/* --- Not ready: no confidence is faked --- */}
        {readiness && !readiness.ready && !stored ? (
          <div className="rounded-lg border border-[#e6dfc9] bg-[#fffdf6] px-4 py-3.5">
            <p className="flex items-start gap-2 text-xs leading-5 text-[#8a6d2f]">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              {readiness.reason}
            </p>
            <p className="mt-2 text-[11px] leading-5 text-[#a08b5a]">
              Clawback will not draft a confident dispute letter without an assessed deduction
              that is supported by an official source. Finish research and assessment first.
            </p>
          </div>
        ) : null}

        {/* --- Generating: real backend state, no fake progress bar --- */}
        {generating ? (
          <p className="flex items-center gap-2 text-sm text-[#69737d]">
            <Loader2 size={15} className="animate-spin text-[#6d9387]" />
            Drafting the letter from the evidence on this case…
          </p>
        ) : null}

        {/* --- Failed: the real reason --- */}
        {failed ? (
          <div className="rounded-lg border border-[#e6c9c5] bg-[#fff7f6] px-4 py-3.5">
            <p className="flex items-start gap-2 text-xs leading-5 text-[#9c4338]">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              {stored?.pipelineError ??
                "The letter could not be drafted. No letter was saved."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <ActionButton
                icon={<RefreshCw size={13} />}
                label={busy === "draft" ? "Retrying…" : "Try again"}
                onClick={() =>
                  run("draft", () => draftLetter({ caseId: caseKey, userId }))
                }
                disabled={busy !== null}
              />
            </div>
          </div>
        ) : null}

        {/* --- No letter yet, and nothing blocking --- */}
        {!stored && !generating && readiness?.ready ? (
          <div>
            <p className="text-sm text-[#4a5660]">
              The deductions on this case have been assessed against official sources. Clawback
              can draft a dispute letter from that evidence for you to review.
            </p>
            <div className="mt-4">
              <ActionButton
                primary
                icon={<FileText size={14} />}
                label={busy === "draft" ? "Drafting…" : "Draft dispute letter"}
                onClick={() => run("draft", () => draftLetter({ caseId: caseKey, userId }))}
                disabled={busy !== null}
              />
            </div>
          </div>
        ) : null}

        {/* --- The letter document --- */}
        {stored && ready ? (
          <div className="space-y-4">
            {sent ? (
              <div className="flex items-start gap-2.5 rounded-lg border border-[#c9e0d6] bg-[#f4faf7] px-4 py-3">
                <Send size={15} className="mt-0.5 shrink-0 text-[#235b4c]" />
                <div>
                  <p className="text-xs font-semibold text-[#235b4c]">Dispute sent</p>
                  <p className="mt-1 text-[11px] leading-5 text-[#4c7a6b]">
                    Sent to {landlordEmail ?? "the landlord"} {formatDateTime(stored.sentAt)}. Any
                    reply from the landlord will appear in the communication section below.
                  </p>
                </div>
              </div>
            ) : approved ? (
              <div className="flex items-start gap-2.5 rounded-lg border border-[#c9e0d6] bg-[#f4faf7] px-4 py-3">
                <ShieldCheck size={15} className="mt-0.5 shrink-0 text-[#235b4c]" />
                <div>
                  <p className="text-xs font-semibold text-[#235b4c]">Approved — ready to send</p>
                  <p className="mt-1 text-[11px] leading-5 text-[#4c7a6b]">
                    Approved {formatDateTime(stored.approvedAt)}. Nothing has been sent yet — use
                    Send dispute below when you are ready.
                  </p>
                </div>
              </div>
            ) : null}

            {awaiting ? (
              <div className="flex items-start gap-2.5 rounded-lg border border-[#d9dfe1] bg-[#fbfcfc] px-4 py-3">
                <Check size={15} className="mt-0.5 shrink-0 text-[#235b4c]" />
                <p className="text-xs leading-5 text-[#4a5660]">
                  This letter is awaiting your approval. Review it, then approve it to mark it
                  ready to send.
                </p>
              </div>
            ) : null}

            {/* --- Sending: the address and the explicit send action --- */}
            {approved ? (
              <div className="rounded-lg border border-[#d9dfe1] bg-[#fbfcfc] px-4 py-3.5">
                <Field
                  label="Send to"
                  value={address}
                  onChange={(value) => setEmailBuffer(value)}
                  placeholder="landlord@example.com"
                />
                <p className="mt-2 text-[11px] leading-5 text-[#89929b]">
                  The landlord&apos;s email address. Clawback will not guess it, and the letter is
                  only sent once you confirm.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <ActionButton
                    icon={<Save size={13} />}
                    label={busy === "address" ? "Saving…" : "Save address"}
                    onClick={() =>
                      run(
                        "address",
                        async () => {
                          await saveLandlordEmail({
                            caseId: caseKey,
                            userId,
                            landlordEmail: address.trim(),
                          });
                          setEmailBuffer(null);
                        },
                        "The landlord's address was saved."
                      )
                    }
                    disabled={busy !== null || !addressDirty || !addressValid}
                  />
                  <ActionButton
                    primary
                    icon={<Send size={14} />}
                    label={busy === "send" ? "Sending…" : "Send dispute"}
                    onClick={() => run("send", () => sendLetter({ caseId: caseKey, userId }))}
                    disabled={
                      busy !== null ||
                      !addressValid ||
                      addressDirty ||
                      landlordEmail?.trim() !== address.trim()
                    }
                  />
                </div>
                {addressDirty ? (
                  <p className="mt-2 text-[11px] text-[#8a6d2f]">
                    Save the address before sending.
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* The document itself: the visual hero. */}
            <article className="rounded-lg border border-[#e4e7eb] bg-white">
              <div className="border-b border-[#edf0f2] px-6 py-5">
                {editing ? (
                  <div className="space-y-3">
                    <Field
                      label="To"
                      value={recipient}
                      onChange={setRecipient}
                      placeholder="Property Manager / Landlord"
                    />
                    <Field
                      label="Subject"
                      value={subject}
                      onChange={setSubject}
                      placeholder="Request for Review of Security Deposit Deductions"
                    />
                  </div>
                ) : (
                  <>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#a0a8ae]">
                      To
                    </p>
                    <p className="mt-1 text-sm text-[#35414b]">{stored.recipient}</p>
                    <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#a0a8ae]">
                      Subject
                    </p>
                    <p className="mt-1 text-base font-semibold tracking-[-0.02em] text-[#18212b]">
                      {stored.subject}
                    </p>
                  </>
                )}
              </div>

              <div className="px-6 py-6">
                {editing ? (
                  <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    rows={22}
                    className="w-full resize-y rounded-lg border border-[#d9dfe1] bg-white px-4 py-3.5 text-[13px] leading-7 text-[#26323b] outline-none focus:border-[#6d9387] focus:ring-2 focus:ring-[#dcebe5]"
                    spellCheck={false}
                  />
                ) : (
                  <div className="space-y-4 text-[13px] leading-7 text-[#26323b]">
                    {stored.body.split(/\n{2,}/).map((paragraph, index) => (
                      <p key={index} className="whitespace-pre-wrap">
                        {paragraph}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[#edf0f2] px-6 py-3">
                <p className="text-[11px] text-[#89929b]">
                  Draft v{stored.version}
                  {stored.editedAt ? ` · edited ${formatDateTime(stored.editedAt)}` : ""}
                  {isDirty ? " · unsaved changes" : ""}
                </p>
                <div className="flex flex-wrap gap-2">
                  {/* A locked letter is never editable, so no edit affordance is
                      offered at all — the footer explains how to revise it. */}
                  {locked ? null : editing ? (
                    <>
                      <ActionButton
                        icon={<X size={13} />}
                        label="Cancel"
                        onClick={() => {
                          setEditing(false);
                          // Drop the buffer so the fields fall back to the
                          // stored draft, discarding the abandoned edit.
                          resetBuffer();
                          setError(null);
                        }}
                        disabled={busy !== null}
                      />
                      <ActionButton
                        primary
                        icon={<Save size={13} />}
                        label={busy === "save" ? "Saving…" : "Save"}
                        onClick={() =>
                          run(
                            "save",
                            async () => {
                              await saveEdits({
                                caseId: caseKey,
                                userId,
                                recipient,
                                subject,
                                body,
                              });
                              setEditing(false);
                              // The save bumped the version; dropping the
                              // buffer rebinds the fields to the stored text.
                              resetBuffer();
                            },
                            "Your edits were saved."
                          )
                        }
                        disabled={busy !== null || !isDirty}
                      />
                    </>
                  ) : (
                    <ActionButton
                      icon={<Pencil size={13} />}
                      label="Edit"
                      onClick={() => setEditing(true)}
                      disabled={busy !== null}
                    />
                  )}
                </div>
              </footer>
            </article>

            {/* --- Workflow actions --- */}
            <div className="flex flex-wrap items-center gap-2">
              {!locked ? (
                <ActionButton
                  icon={<RefreshCw size={13} />}
                  label={busy === "regenerate" ? "Regenerating…" : "Regenerate"}
                  onClick={() =>
                    run(
                      "regenerate",
                      () => draftLetter({ caseId: caseKey, userId }),
                      "Regenerating the draft from the latest case information."
                    )
                  }
                  disabled={busy !== null || editing || isDirty}
                />
              ) : null}

              {!locked && !awaiting ? (
                <ActionButton
                  icon={<Check size={13} />}
                  label={busy === "present" ? "Presenting…" : "Present for approval"}
                  onClick={() =>
                    run("present", () => presentForApproval({ caseId: caseKey, userId }))
                  }
                  disabled={busy !== null || editing || isDirty}
                />
              ) : null}

              {!locked ? (
                <ActionButton
                  primary
                  icon={<ShieldCheck size={14} />}
                  label={busy === "approve" ? "Approving…" : "Approve"}
                  onClick={() =>
                    run("approve", () => approveLetter({ caseId: caseKey, userId }))
                  }
                  disabled={busy !== null || editing || isDirty}
                />
              ) : (
                <ActionButton
                  icon={<FileText size={13} />}
                  label={busy === "new" ? "Starting…" : "Start a new draft"}
                  onClick={() =>
                    run(
                      "new",
                      () => startNewDraft({ caseId: caseKey, userId }),
                      "The approved letter was archived. Draft a new one when you are ready."
                    )
                  }
                  disabled={busy !== null}
                />
              )}
            </div>

            {editing || isDirty ? (
              <p className="text-[11px] text-[#89929b]">
                Save your edits before regenerating, presenting or approving — those actions use
                the stored letter.
              </p>
            ) : null}

            {locked ? (
              <p className="text-[11px] text-[#89929b]">
                {sent
                  ? "A sent letter is locked so the record of what was sent cannot change. Start a new draft to send a revision."
                  : "An approved letter is locked so it cannot change after approval. Start a new draft to revise it."}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* --- Feedback --- */}
        {error ? (
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-[#e6c9c5] bg-[#fff7f6] px-3.5 py-3 text-xs leading-5 text-[#9c4338]">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            {error}
          </p>
        ) : null}

        {notice ? (
          <p className="mt-4 rounded-lg border border-[#c9e0d6] bg-[#f4faf7] px-3.5 py-3 text-xs leading-5 text-[#235b4c]">
            {notice}
          </p>
        ) : null}
      </div>

      {/* --- Evidence panel --- */}
      {stored && ready ? (
        <EvidencePanel
          sources={supportingSources ?? []}
          potentiallyDisputableAmount={
            stored.potentiallyDisputableAmount ?? potentiallyDisputableAmount
          }
          loading={supportingSources === undefined}
        />
      ) : null}
    </section>
  );
}

function EvidencePanel({
  sources,
  potentiallyDisputableAmount,
  loading,
}: {
  sources: Array<{
    _id: string;
    title: string;
    url: string;
    authority: string;
    jurisdiction: string;
    relevantText?: string;
  }>;
  potentiallyDisputableAmount: number;
  loading: boolean;
}) {
  return (
    <div className="border-t border-[#edf0f2] bg-[#fbfcfc] px-5 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[#a0a8ae]">
          Supporting evidence
        </h3>
        <p className="text-[11px] text-[#89929b]">
          Requested refund {formatCurrency(potentiallyDisputableAmount)}
        </p>
      </div>

      {loading ? (
        <p className="mt-3 text-xs text-[#89929b]">Loading evidence…</p>
      ) : sources.length === 0 ? (
        <p className="mt-3 text-xs text-[#89929b]">
          No sources are attached to this letter yet.
        </p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {sources.map((source) => (
            <li key={source._id} className="rounded-lg border border-[#e4e7eb] bg-white px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-[#235b4c]">
                    <Check size={13} /> {source.authority}
                  </p>
                  <p className="mt-1 text-sm text-[#26323b]">{source.title}</p>
                  <p className="mt-0.5 text-[11px] text-[#89929b]">{source.jurisdiction}</p>
                </div>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold text-[#235b4c] hover:underline"
                >
                  View source <ExternalLink size={11} />
                </a>
              </div>
              {source.relevantText ? (
                <blockquote className="mt-2.5 border-l-2 border-[#dcebe5] pl-3 text-[11px] leading-5 text-[#4a5660]">
                  {source.relevantText}
                </blockquote>
              ) : (
                <p className="mt-2.5 text-[11px] italic text-[#a0a8ae]">
                  No passage was retrieved from this source.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[11px] leading-5 text-[#a0a8ae]">
        The letter asks the landlord to review these deductions. It is not a legal conclusion,
        and Clawback does not guarantee any outcome.
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#a0a8ae]">
        {label}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1.5 w-full rounded-lg border border-[#d9dfe1] bg-white px-3.5 py-2.5 text-sm text-[#26323b] outline-none focus:border-[#6d9387] focus:ring-2 focus:ring-[#dcebe5]"
      />
    </label>
  );
}

function ActionButton({
  label,
  icon,
  onClick,
  disabled,
  primary,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        primary
          ? "bg-[#173f35] text-white hover:bg-[#235b4c]"
          : "border border-[#d9dfe1] bg-white text-[#35414b] hover:bg-[#f4f5f6]"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function LetterStatusPill({ status }: { status: LetterStatus }) {
  const styles: Record<LetterStatus, string> = {
    DRAFT: "bg-[#f1f2f4] text-[#4a5660]",
    AWAITING_APPROVAL: "bg-[#fdf6e8] text-[#8a6d2f]",
    APPROVED: "bg-[#edf4f1] text-[#235b4c]",
    SENT: "bg-[#edf4f1] text-[#235b4c]",
  };

  return (
    <span
      className={`inline-flex w-fit items-center rounded-full px-3 py-1.5 text-[11px] font-semibold ${styles[status]}`}
    >
      {status === "AWAITING_APPROVAL" ? "Awaiting approval" : status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}
