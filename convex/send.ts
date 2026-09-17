/**
 * The send contract: what makes a dispute sendable, and what makes a second
 * send the same send.
 *
 * Kept free of any Convex runtime import (only `import type`, which is erased)
 * so the rules below can be exercised offline by `npm run verify`. `outbound.ts`
 * is the pipeline that supplies the data; this module is the policy.
 */

import type { LetterPipelineStatus, LetterStatus, OutboundSendStatus } from "./validators";

/**
 * How long a claim may sit in SENDING before it is treated as abandoned. A
 * crashed action would otherwise block the case's retries forever. Well above
 * the provider's own request timeout, so a slow-but-live send is never stolen.
 */
export const STALE_SEND_CLAIM_MS = 10 * 60 * 1000;

/**
 * A deterministic key for "this exact approved document".
 *
 * The letter's `version` is monotonic and bumped by every generation and every
 * explicit save, so (letter id, version) identifies one immutable revision of
 * the document. Two attempts to send that revision share a key; a revised
 * letter gets a new one and may legitimately be sent again.
 */
export function sendIdempotencyKey(letterId: string, version: number): string {
  return `send:${letterId}:v${version}`;
}

/**
 * Whether a string is usable as an envelope recipient. Deliberately permissive
 * — the goal is to catch empty or obviously malformed input, not to reimplement
 * RFC 5322 and reject a real address.
 */
export function isSendableEmail(value: string | undefined): boolean {
  if (!value) return false;

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 320) return false;
  if (/\s/.test(trimmed)) return false;

  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(trimmed);
}

/** The document being sent, reduced to the fields the rules depend on. */
export type SendableLetter = {
  status: LetterStatus;
  pipelineStatus: LetterPipelineStatus;
  subject: string;
  body: string;
};

export type SendRequest = {
  /** The live letter for the case, or null when none exists. */
  letter: SendableLetter | null;
  /** The case's AgentMail sending address. */
  inboxId: string | undefined;
  /**
   * The envelope recipient. This is the landlord's address as supplied by the
   * renter, not the salutation printed on the letter.
   */
  landlordEmail: string | undefined;
};

/**
 * Machine-readable refusal reasons. The pipeline maps these to renter-facing
 * copy; keeping the codes stable lets the UI and the tests agree on meaning.
 */
export const SEND_REFUSAL_CODES = [
  "NO_LETTER",
  "ALREADY_SENT",
  "NOT_APPROVED",
  "NOT_READY",
  "NO_SUBJECT",
  "NO_BODY",
  "NO_INBOX",
  "NO_RECIPIENT",
] as const;

export type SendRefusalCode = (typeof SEND_REFUSAL_CODES)[number];

export type SendRefusal = {
  code: SendRefusalCode;
  message: string;
};

function refuse(code: SendRefusalCode, message: string): SendRefusal {
  return { code, message };
}

/**
 * Every precondition for sending, in the order a renter would want to hear
 * about them. Returns `null` when the letter may be sent.
 *
 * This is the single source of truth for Step 3 of the brief: an unapproved
 * draft, an empty subject or body, a missing inbox or a missing recipient all
 * stop the send here, before anything is claimed or written.
 */
export function validateSendRequest(request: SendRequest): SendRefusal | null {
  const { letter, inboxId, landlordEmail } = request;

  if (!letter) {
    return refuse("NO_LETTER", "There is no letter to send yet.");
  }

  if (letter.status === "SENT") {
    return refuse("ALREADY_SENT", "This letter has already been sent.");
  }

  if (letter.status !== "APPROVED") {
    return refuse(
      "NOT_APPROVED",
      "Only an approved letter can be sent. Approve the letter first."
    );
  }

  if (letter.pipelineStatus !== "READY") {
    return refuse("NOT_READY", "The letter is not ready to send yet.");
  }

  if (letter.subject.trim().length === 0) {
    return refuse("NO_SUBJECT", "The letter needs a subject before it can be sent.");
  }

  if (letter.body.trim().length === 0) {
    return refuse("NO_BODY", "The letter needs a body before it can be sent.");
  }

  if (!inboxId || inboxId.trim().length === 0) {
    return refuse(
      "NO_INBOX",
      "This case has no sending address yet, so the dispute cannot be sent."
    );
  }

  if (!isSendableEmail(landlordEmail)) {
    return refuse(
      "NO_RECIPIENT",
      "Add the landlord's email address before sending — Clawback will not guess it."
    );
  }

  return null;
}

/** The outbound row already recorded for this document, if any. */
export type ExistingSend = {
  sendStatus: OutboundSendStatus;
  /** How long ago the claim was last touched. */
  ageMs: number;
};

/**
 * What to do about a document that already has an outbound record.
 *
 * This is the idempotency decision table for Step 5, kept pure so every branch
 * — including the stale-claim boundary that a live test cannot reach — is
 * checkable without a deployment.
 *
 *   SENT                      -> refuse; the landlord already has this copy.
 *   SENDING, claim still fresh -> refuse; the first attempt is still running.
 *   SENDING, claim stale       -> reuse; the original attempt is gone.
 *   FAILED                     -> reuse; retry the same document, one record.
 */
export type SendClaimDecision = "REFUSE_ALREADY_SENT" | "REFUSE_IN_FLIGHT" | "REUSE";

export function decideSendClaim(
  existing: ExistingSend,
  staleAfterMs: number = STALE_SEND_CLAIM_MS
): SendClaimDecision {
  if (existing.sendStatus === "SENT") return "REFUSE_ALREADY_SENT";
  if (existing.sendStatus === "SENDING" && existing.ageMs < staleAfterMs) {
    return "REFUSE_IN_FLIGHT";
  }

  return "REUSE";
}

/** Renter-facing copy for a refused duplicate attempt. */
export function duplicateSendMessage(decision: SendClaimDecision): string {
  return decision === "REFUSE_ALREADY_SENT"
    ? "This letter has already been sent to the landlord."
    : "This letter is already being sent.";
}
