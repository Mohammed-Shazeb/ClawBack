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
  Quote,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { Badge, MicroLabel, Panel, type Tone } from "./ui/primitives";

type LetterStatus = "DRAFT" | "AWAITING_APPROVAL" | "APPROVED" | "SENT";

/** The deduction shape the evidence panel needs. Supplied by the case page. */
export type LetterDeduction = {
  _id: string;
  description: string;
  amount?: number;
  assessment?: string;
  potentiallyDisputableAmount?: number;
  assessmentSourceIds?: string[];
};

export type LetterSource = {
  _id: string;
  deductionId?: string;
  title: string;
  url: string;
  authority: string;
  jurisdiction: string;
  relevantText?: string;
};

const STATUS_TONE: Record<LetterStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  AWAITING_APPROVAL: { label: "Awaiting approval", tone: "attention" },
  APPROVED: { label: "Approved", tone: "accent" },
  SENT: { label: "Sent", tone: "accent" },
};

/**
 * The dispute letter workflow: a document, the evidence it rests on, an explicit
 * human approval step, and — once approved — an explicit send.
 *
 * Sending is never automatic. Generation produces a draft, approval marks it
 * ready, and only a separate, deliberate action hands it to the mail provider.
 */
export function CaseLetter({
  caseId,
  userId,
  potentiallyDisputableAmount,
  landlordEmail,
  deductions = [],
}: {
  caseId: string;
  userId: Id<"users">;
  potentiallyDisputableAmount: number;
  /** The renter-supplied envelope address. Never inferred by Clawback. */
  landlordEmail?: string;
  deductions?: LetterDeduction[];
}) {
  const caseKey = caseId as Id<"cases">;

  const letter = useQuery(api.letters.getForCase, { caseId: caseKey, userId });
  const readiness = useQuery(api.letters.getDraftReadiness, { caseId: caseKey, userId });
  const supportingSources = useQuery(api.letters.getSupportingSources, { caseId: caseKey, userId });

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
    return recipient !== stored.recipient || subject !== stored.subject || body !== stored.body;
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
  const [emailBuffer, setEmailBuffer] = useState<string | null>(null);
  const address = emailBuffer ?? landlordEmail ?? "";
  const addressDirty = address.trim() !== (landlordEmail ?? "").trim();
  const addressValid = /^[^@\s]+@[^@.\s]+(\.[^@.\s]+)+$/.test(address.trim());

  // Which piece of evidence the reader is currently looking at. The link runs
  // both ways: choosing a source lights up the paragraphs that rest on it, and
  // choosing one of those paragraphs selects the source it rests on.
  const [evidenceId, setEvidenceId] = useState<string | null>(null);

  const paragraphs = useMemo(() => splitParagraphs(stored?.body ?? ""), [stored?.body]);

  /**
   * The link between the letter and its evidence is *derived*, never stored.
   *
   * The drafting rules deliberately forbid putting a source label, URL or id
   * inside the letter body (rule 10), so there are no citation markers to click.
   * A paragraph is therefore tied to a source by naming the authority that source
   * comes from, or the deduction that source supports. A paragraph naming neither
   * is tied to nothing, and nothing is highlighted — the connection between a
   * paragraph and a source is never implied, only shown when the text itself
   * carries it.
   */
  const paragraphSources = useMemo(() => {
    const sources = supportingSources ?? [];

    const needlesFor = (source: LetterSource) => {
      const deduction = deductions.find((item) => item._id === source.deductionId);
      return [source.authority, deduction?.description ?? ""].filter(
        (needle) => needle.trim().length >= 4
      );
    };

    return paragraphs.map((paragraph) => {
      const haystack = paragraph.toLowerCase();
      return sources.filter((source) =>
        needlesFor(source).some((needle) => haystack.includes(needle.toLowerCase()))
      );
    });
  }, [paragraphs, supportingSources, deductions]);

  const isHighlighted = (index: number) =>
    evidenceId !== null &&
    (paragraphSources[index] ?? []).some((source) => source._id === evidenceId);

  /**
   * Brings the matching source into view when a paragraph is chosen. The panel
   * can be taller than the letter, so without this the highlight can land off
   * screen and the connection would be invisible.
   */
  function revealSource(id: string | null) {
    setEvidenceId(id);
    if (!id || typeof document === "undefined") return;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

    document
      .getElementById(`source-${id}`)
      ?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }

  return (
    <Panel as="section" className="overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">Dispute letter</h2>
            {stored ? <Badge tone={STATUS_TONE[stored.status].tone}>{STATUS_TONE[stored.status].label}</Badge> : null}
          </div>
          <p className="mt-0.5 text-xs leading-5 text-ink-secondary">
            Drafted from the assessed deductions and the official sources found for this case.
          </p>
        </div>
      </header>

      <div className="px-5 py-5">
        {/* --- Not ready: no confidence is faked --- */}
        {readiness && !readiness.ready && !stored ? (
          <div className="rounded-md border border-attention-line bg-attention-soft px-4 py-3.5">
            <p className="flex items-start gap-2 text-xs leading-5 text-attention">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              {readiness.reason}
            </p>
            <p className="mt-2 text-[11px] leading-5 text-attention/80">
              Clawback will not draft a confident dispute letter without an assessed deduction that
              is supported by an official source. Finish research and assessment first.
            </p>
          </div>
        ) : null}

        {/* --- Generating: real backend state, no fake progress bar --- */}
        {generating ? (
          <p className="flex items-center gap-2 text-[13px] text-ink-secondary">
            <Loader2 size={15} className="animate-spin text-accent" aria-hidden="true" />
            Drafting the letter from the evidence on this case…
          </p>
        ) : null}

        {/* --- Failed: the real reason --- */}
        {failed ? (
          <div className="rounded-md border border-danger-line bg-danger-soft px-4 py-3.5">
            <p className="flex items-start gap-2 text-xs leading-5 text-danger">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              {stored?.pipelineError ?? "The letter could not be drafted. No letter was saved."}
            </p>
            <div className="mt-3">
              <ActionButton
                icon={<RefreshCw size={13} aria-hidden="true" />}
                label={busy === "draft" ? "Retrying…" : "Try again"}
                onClick={() => run("draft", () => draftLetter({ caseId: caseKey, userId }))}
                disabled={busy !== null}
              />
            </div>
          </div>
        ) : null}

        {/* --- No letter yet, and nothing blocking --- */}
        {!stored && !generating && readiness?.ready ? (
          <div>
            <p className="text-[13px] leading-6 text-ink-secondary">
              The deductions on this case have been assessed against official sources. Clawback can
              draft a dispute letter from that evidence for you to review.
            </p>
            <div className="mt-4">
              <ActionButton
                primary
                icon={<FileText size={14} aria-hidden="true" />}
                label={busy === "draft" ? "Drafting…" : "Draft dispute letter"}
                onClick={() => run("draft", () => draftLetter({ caseId: caseKey, userId }))}
                disabled={busy !== null}
              />
            </div>
          </div>
        ) : null}

        {/* --- The document --- */}
        {stored && ready ? (
          <div className="space-y-4">
            {sent ? (
              <Banner
                tone="accent"
                icon={<Send size={14} aria-hidden="true" />}
                title="Dispute sent"
                body={`Sent to ${landlordEmail ?? "the landlord"} ${formatDateTime(stored.sentAt)}. Any reply from the landlord appears in the communication section below.`}
              />
            ) : approved ? (
              <Banner
                tone="accent"
                icon={<ShieldCheck size={14} aria-hidden="true" />}
                title="Approved — ready to send"
                body={`Approved ${formatDateTime(stored.approvedAt)}. Nothing has been sent yet — use Send dispute below when you are ready.`}
              />
            ) : awaiting ? (
              <Banner
                tone="attention"
                icon={<Check size={14} aria-hidden="true" />}
                title="Awaiting your approval"
                body="Review the letter, then approve it to mark it ready to send. Approving does not send anything."
              />
            ) : null}

            {/* --- Sending: the address and the explicit send action --- */}
            {approved ? (
              <div className="rounded-md border border-line bg-surface-muted px-4 py-3.5">
                <Field
                  label="Send to"
                  value={address}
                  onChange={(value) => setEmailBuffer(value)}
                  placeholder="landlord@example.com"
                  hint="The landlord's email address. Clawback will not guess it, and the letter is only sent once you confirm."
                />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <ActionButton
                    icon={<Save size={13} aria-hidden="true" />}
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
                    icon={<Send size={14} aria-hidden="true" />}
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
                  <p className="mt-2 text-[11px] text-attention">Save the address before sending.</p>
                ) : null}
              </div>
            ) : null}

            {/* --- Document + the evidence it rests on --- */}
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]">
              <article className="rounded-md border border-line bg-surface">
                <div className="border-b border-line px-5 py-4">
                  {editing ? (
                    <div className="space-y-3">
                      <Field label="To" value={recipient} onChange={setRecipient} />
                      <Field label="Subject" value={subject} onChange={setSubject} />
                    </div>
                  ) : (
                    <dl className="space-y-1.5 text-[13px]">
                      <div className="flex gap-2">
                        <dt className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                          To
                        </dt>
                        <dd className="text-ink">{stored.recipient}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                          Subject
                        </dt>
                        <dd className="font-medium text-ink">{stored.subject}</dd>
                      </div>
                    </dl>
                  )}
                </div>

                <div className="px-5 py-5">
                  {editing ? (
                    <textarea
                      value={body}
                      onChange={(event) => setBody(event.target.value)}
                      rows={22}
                      aria-label="Letter body"
                      className="w-full resize-y rounded-md border border-line bg-surface px-4 py-3.5 text-[13px] leading-7 text-ink outline-none focus:border-accent"
                      spellCheck={false}
                    />
                  ) : (
                    <div className="space-y-4 text-[13px] leading-7 text-ink">
                      {paragraphs.map((paragraph, index) => {
                        const target = (paragraphSources[index] ?? [])[0];
                        const highlighted = isHighlighted(index);

                        // A paragraph that names no source stays plain prose. Only
                        // the paragraphs the letter actually rests on are
                        // interactive, so the affordance never over-claims.
                        if (!target) {
                          return (
                            <p key={index} className="whitespace-pre-wrap">
                              {paragraph}
                            </p>
                          );
                        }

                        return (
                          <button
                            key={index}
                            type="button"
                            onClick={() => revealSource(highlighted ? null : target._id)}
                            aria-pressed={highlighted}
                            title={`Show the evidence behind this paragraph — ${target.authority}`}
                            className={`-mx-2 block w-full whitespace-pre-wrap rounded border-l-2 px-2 text-left transition-colors ${
                              highlighted
                                ? "border-accent bg-accent-soft/50"
                                : "border-transparent hover:border-line-strong hover:bg-surface-muted"
                            }`}
                          >
                            {paragraph}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
                  <p className="text-[11px] text-ink-muted">
                    v{stored.version}
                    {stored.editedAt ? ` · edited ${formatDateTime(stored.editedAt)}` : ""}
                    {isDirty ? " · unsaved changes" : ""}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {locked ? null : editing ? (
                      <>
                        <ActionButton
                          icon={<X size={13} aria-hidden="true" />}
                          label="Cancel"
                          onClick={() => {
                            setEditing(false);
                            resetBuffer();
                            setError(null);
                          }}
                          disabled={busy !== null}
                        />
                        <ActionButton
                          primary
                          icon={<Save size={13} aria-hidden="true" />}
                          label={busy === "save" ? "Saving…" : "Save"}
                          onClick={() =>
                            run(
                              "save",
                              async () => {
                                await saveEdits({ caseId: caseKey, userId, recipient, subject, body });
                                setEditing(false);
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
                        icon={<Pencil size={13} aria-hidden="true" />}
                        label="Edit"
                        onClick={() => setEditing(true)}
                        disabled={busy !== null}
                      />
                    )}
                  </div>
                </footer>
              </article>

              <SupportingEvidence
                sources={supportingSources ?? []}
                deductions={deductions}
                loading={supportingSources === undefined}
                requestedAmount={stored.potentiallyDisputableAmount ?? potentiallyDisputableAmount}
                selectedId={evidenceId}
                onSelect={revealSource}
              />
            </div>

            {/* --- Workflow actions --- */}
            <div className="flex flex-wrap items-center gap-2">
              {!locked ? (
                <ActionButton
                  icon={<RefreshCw size={13} aria-hidden="true" />}
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
                  icon={<Check size={13} aria-hidden="true" />}
                  label={busy === "present" ? "Presenting…" : "Present for approval"}
                  onClick={() => run("present", () => presentForApproval({ caseId: caseKey, userId }))}
                  disabled={busy !== null || editing || isDirty}
                />
              ) : null}

              {!locked ? (
                <ActionButton
                  primary
                  icon={<ShieldCheck size={14} aria-hidden="true" />}
                  label={busy === "approve" ? "Approving…" : "Approve"}
                  onClick={() => run("approve", () => approveLetter({ caseId: caseKey, userId }))}
                  disabled={busy !== null || editing || isDirty}
                />
              ) : (
                <ActionButton
                  icon={<FileText size={13} aria-hidden="true" />}
                  label={busy === "new" ? "Starting…" : "Start a new draft"}
                  onClick={() =>
                    run(
                      "new",
                      () => startNewDraft({ caseId: caseKey, userId }),
                      "The finalised letter was archived. Draft a new one when you are ready."
                    )
                  }
                  disabled={busy !== null}
                />
              )}
            </div>

            {editing || isDirty ? (
              <p className="text-[11px] text-ink-muted">
                Save your edits before regenerating, presenting or approving — those actions use the
                stored letter.
              </p>
            ) : null}

            {locked ? (
              <p className="text-[11px] text-ink-muted">
                {sent
                  ? "A sent letter is locked so the record of what was sent cannot change. Start a new draft to send a revision."
                  : "An approved letter is locked so it cannot change after approval. Start a new draft to revise it."}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* --- Feedback --- */}
        {error ? (
          <p
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-md border border-danger-line bg-danger-soft px-3.5 py-3 text-xs leading-5 text-danger"
          >
            <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : null}

        {notice ? (
          <p className="mt-4 rounded-md border border-accent-line bg-accent-soft px-3.5 py-3 text-xs leading-5 text-accent">
            {notice}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

function splitParagraphs(value: string): string[] {
  return value.split(/\n{2,}/).filter((paragraph) => paragraph.trim().length > 0);
}

/**
 * The evidence the letter rests on, grouped by the deduction it supports.
 * Selecting an item connects it to the paragraphs that cite it.
 */
function SupportingEvidence({
  sources,
  deductions,
  loading,
  requestedAmount,
  selectedId,
  onSelect,
}: {
  sources: LetterSource[];
  deductions: LetterDeduction[];
  loading: boolean;
  requestedAmount: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const disputable = deductions.filter(
    (deduction) => deduction.assessment === "POTENTIALLY_DISPUTABLE"
  );

  const groups = disputable
    .map((deduction) => ({
      deduction,
      sources: sources.filter((source) => source.deductionId === deduction._id),
    }))
    .filter((group) => group.sources.length > 0);

  return (
    <aside className="rounded-md border border-line bg-surface-muted/60" aria-label="Supporting evidence">
      <div className="border-b border-line px-4 py-3.5">
        <MicroLabel>Supporting evidence</MicroLabel>
        <p className="mt-1.5 flex items-baseline justify-between gap-2">
          <span className="text-[11px] text-ink-secondary">Requested refund</span>
          <span className="tabular text-[13px] font-semibold text-ink">
            {formatCurrency(requestedAmount)}
          </span>
        </p>
      </div>

      {loading ? (
        <p className="px-4 py-4 text-[11px] text-ink-muted">Loading evidence…</p>
      ) : groups.length === 0 ? (
        <p className="px-4 py-4 text-[11px] leading-5 text-ink-muted">
          No source is attached to this letter yet. A letter is only drafted from deductions that
          cite an official source.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {groups.map(({ deduction, sources: groupSources }) => (
            <li key={deduction._id} className="px-4 py-3.5">
              <p className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-xs font-medium text-ink">
                  {deduction.description}
                </span>
                <span className="tabular shrink-0 text-xs font-semibold text-attention">
                  {formatCurrency(deduction.potentiallyDisputableAmount ?? deduction.amount)}
                </span>
              </p>

              <ul className="mt-2 space-y-1.5">
                {groupSources.map((source, index) => (
                  <SourceRow
                    key={source._id}
                    source={source}
                    index={index + 1}
                    selected={source._id === selectedId}
                    onSelect={() => onSelect(source._id === selectedId ? null : source._id)}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <p className="border-t border-line px-4 py-3 text-[10px] leading-5 text-ink-muted">
        The letter asks the landlord to review these deductions. It is not a legal conclusion, and
        Clawback does not guarantee any outcome.
      </p>
    </aside>
  );
}

/**
 * One source behind the letter.
 *
 * The title, the authority and the link are always visible so the claim can be
 * checked without selecting anything; selecting reveals the passage the letter
 * actually rests on. Nothing is summarised away — the reader can always reach
 * the original text.
 */
function SourceRow({
  source,
  index,
  selected,
  onSelect,
}: {
  source: LetterSource;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li id={`source-${source._id}`} className="scroll-mt-28">
      <div
        className={`overflow-hidden rounded border transition-colors ${
          selected ? "border-accent-line bg-accent-soft" : "border-line bg-surface"
        }`}
      >
        <div className="flex items-stretch">
          <button
            type="button"
            onClick={onSelect}
            aria-expanded={selected}
            className="flex min-w-0 flex-1 items-start gap-2 px-2.5 py-2 text-left"
          >
            <Quote
              size={11}
              aria-hidden="true"
              className={`mt-0.5 shrink-0 ${selected ? "text-accent" : "text-ink-muted"}`}
            />
            <span className="min-w-0">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
                Source {String(index).padStart(2, "0")}
              </span>
              <span className="mt-0.5 block truncate text-[11px] font-medium text-ink">
                {source.title}
              </span>
              <span className="mt-0.5 block truncate text-[10px] text-ink-muted">
                {source.authority} · {source.jurisdiction}
              </span>
            </span>
          </button>

          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${source.title} — ${source.authority} in a new tab`}
            className="flex shrink-0 items-center border-l border-line px-2 text-ink-muted transition-colors hover:text-accent"
          >
            <ExternalLink size={11} aria-hidden="true" />
          </a>
        </div>

        {selected ? (
          <div className="animate-fade border-t border-accent-line px-2.5 py-2">
            {source.relevantText ? (
              <blockquote className="border-l-2 border-accent pl-2 text-[11px] leading-5 text-ink-secondary">
                {source.relevantText}
              </blockquote>
            ) : (
              <p className="text-[10px] italic text-ink-muted">
                No passage was retrieved from this source, so none is quoted.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function Banner({
  tone,
  icon,
  title,
  body,
}: {
  tone: Tone;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  const styles =
    tone === "accent"
      ? "border-accent-line bg-accent-soft text-accent"
      : "border-attention-line bg-attention-soft text-attention";

  return (
    <div className={`flex items-start gap-2.5 rounded-md border px-4 py-3 ${styles}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>
        <p className="text-xs font-semibold">{title}</p>
        <p className="mt-1 text-[11px] leading-5 opacity-90">{body}</p>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
        {label}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1.5 w-full rounded-md border border-line bg-surface px-3.5 py-2.5 text-[13px] text-ink outline-none transition-colors focus:border-accent"
      />
      {hint ? <span className="mt-1.5 block text-[11px] leading-5 text-ink-muted">{hint}</span> : null}
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
      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        primary
          ? "bg-accent text-white hover:bg-accent-strong"
          : "border border-line bg-surface text-ink hover:border-line-strong"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
