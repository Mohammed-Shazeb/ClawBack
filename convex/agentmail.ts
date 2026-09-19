import { z } from "zod";

import { redactCredentials } from "./errors";
import type { EmailAttachment } from "./validators";

/**
 * AgentMail (https://docs.agentmail.to) server-side integration.
 *
 * The inbox id *is* the inbox's email address, so one inbox per case gives us
 * deterministic routing: an inbound message carries `inbox_id`, and the matching
 * case is the only case that message can belong to.
 */

const DEFAULT_API_BASE_URL = "https://api.agentmail.to/v0";
const REQUEST_TIMEOUT_MS = 30_000;
const attachmentResponseSchema = z.object({
  download_url: z.string().url(),
  content_type: z.string().nullish(),
});

/**
 * Why a response failed to parse.
 *
 * A bare "unexpected response" is undiagnosable: it does not say which field
 * was missing or the wrong type, so a provider whose shape differs from ours
 * looks identical to a transient network problem. This is the same lesson as
 * the letter validator — the reason has to name what did not match.
 */
function describeParseFailure(error: z.ZodError): string {
  const detail = error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ")
    .slice(0, 300);

  return `unexpected response (${detail})`;
}

const inboxSchema = z.object({
  inbox_id: z.string().min(1),
  display_name: z.string().nullish(),
  client_id: z.string().nullish(),
});

/**
 * Address fields arrive either as a bare address, a list of addresses, or a
 * list of `{ email }` objects depending on the payload source, so all three
 * shapes are accepted and normalized to a single address.
 */
const addressSchema = z.union([
  z.string(),
  z.array(z.string()),
  z.array(z.object({ email: z.string().nullish() })),
]);

const messageSchema = z.object({
  message_id: z.string().min(1),
  inbox_id: z.string().min(1),
  thread_id: z.string().nullish(),
  timestamp: z.string().nullish(),
  created_at: z.string().nullish(),
  from: addressSchema.nullish(),
  from_: addressSchema.nullish(),
  to: addressSchema.nullish(),
  subject: z.string().nullish(),
  text: z.string().nullish(),
  extracted_text: z.string().nullish(),
  preview: z.string().nullish(),
  labels: z.array(z.string()).nullish(),
  /**
   * Reply threading. Providers expose this either as first-class fields or only
   * inside the raw headers, so both are accepted; the headers are matched
   * case-insensitively.
   */
  in_reply_to: z.string().nullish(),
  references: z.union([z.string(), z.array(z.string())]).nullish(),
  headers: z.record(z.string(), z.union([z.string(), z.number()])).nullish(),
  attachments: z
    .array(
      z.object({
        attachment_id: z.string().nullish(),
        filename: z.string().nullish(),
        content_type: z.string().nullish(),
        size: z.number().nullish(),
        inline: z.boolean().nullish(),
      })
    )
    .nullish(),
});

/**
 * What `POST /inboxes/{id}/messages/send` actually returns.
 *
 * It is NOT the same shape as a message object. A message carries `inbox_id`,
 * `from`, `to`, `subject`, `labels` and so on; the send endpoint answers with
 * only `message_id` and `thread_id`. Parsing the send result with
 * `messageSchema` therefore failed on the missing `inbox_id` — and it failed
 * *after* the provider had already delivered, so every send was recorded as a
 * failure while the landlord received the letter.
 *
 * Extra fields are tolerated so a provider that returns more still parses.
 */
export const sentMessageSchema = z.object({
  message_id: z.string().min(1),
  thread_id: z.string().nullish(),
});

/** What a send returns: the stored message, with its thread. */
export type SentMessage = {
  externalMessageId: string;
  threadId?: string;
  recipient?: string;
  subject: string;
};

export const agentMailWebhookEventSchema = z.object({
  event_type: z.string(),
  event_id: z.string().nullish(),
  message: messageSchema.nullish(),
});

export type InboundMessage = {
  externalMessageId: string;
  inboxId: string;
  sender?: string;
  recipient?: string;
  subject: string;
  body: string;
  receivedAt: number;
  /**
   * The provider's thread id. Carried through because it is the reliable way to
   * tie a landlord's reply to the case that sent the dispute — subject lines
   * are user-controlled and are only ever a fallback.
   */
  threadId?: string;
  /** The message this one replies to, when the provider supplies it. */
  inReplyTo?: string;
  /** The conversation's earlier message ids, when the provider supplies them. */
  references: string[];
  attachments: EmailAttachment[];
};

export function isAgentMailConfigured(): boolean {
  return Boolean(process.env.AGENTMAIL_API_KEY);
}

/**
 * Creates the case's inbound inbox. `client_id` makes the call idempotent, so a
 * retry after a timeout returns the inbox that already exists instead of
 * creating a second one.
 */
export async function createCaseInbox({
  caseId,
  localPart,
}: {
  caseId: string;
  localPart: string;
}): Promise<{ inboxId: string }> {
  const domain = process.env.AGENTMAIL_DOMAIN;

  const response = await agentMailRequest("/inboxes", {
    method: "POST",
    body: {
      username: localPart,
      display_name: `Clawback case ${localPart}`,
      client_id: caseId,
      ...(domain ? { domain } : {}),
    },
  });

  const parsed = inboxSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error(
      `AgentMail accepted the inbox request but returned an ${describeParseFailure(parsed.error)}.`
    );
  }

  return { inboxId: parsed.data.inbox_id };
}

/**
 * Sends a message from the case's inbox to the landlord.
 *
 * `client_id` is not available on this endpoint, so idempotency is enforced by
 * the caller: the send pipeline stores a deterministic key for the exact
 * document before calling this, and refuses to call it twice for the same one.
 */
export async function sendCaseMessage({
  inboxId,
  to,
  subject,
  text,
  threadId,
  inReplyTo,
  references,
}: {
  inboxId: string;
  to: string;
  subject: string;
  text: string;
  /** Continue an existing conversation rather than starting a new one. */
  threadId?: string;
  /** The message being replied to, so the provider threads it correctly. */
  inReplyTo?: string;
  references?: string[];
}): Promise<SentMessage> {
  const headers: Record<string, string> = {};
  if (inReplyTo) headers["In-Reply-To"] = inReplyTo;
  if (references && references.length > 0) headers["References"] = references.join(" ");

  const response = await agentMailRequest(
    `/inboxes/${encodeURIComponent(inboxId)}/messages/send`,
    {
      method: "POST",
      body: {
        to,
        subject,
        text,
        ...(threadId ? { thread_id: threadId } : {}),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      },
    }
  );

  const parsed = sentMessageSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error(
      `AgentMail accepted the message but returned an ${describeParseFailure(parsed.error)}.`
    );
  }

  return {
    externalMessageId: parsed.data.message_id,
    threadId: parsed.data.thread_id ?? undefined,
    // The send result carries no addressing, so the values we asked for are the
    // ones that were used.
    recipient: firstAddress(to),
    subject,
  };
}

/**
 * Reads a message's text back from AgentMail. Only needed when a delivery was
 * too large for the webhook payload, which drops the body and keeps metadata.
 */
export async function fetchInboundMessageBody({
  inboxId,
  messageId,
}: {
  inboxId: string;
  messageId: string;
}): Promise<string | null> {
  const response = await agentMailRequest(
    `/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}`,
    { method: "GET" }
  );

  const parsed = messageSchema.safeParse(response);
  if (!parsed.success) return null;

  return parsed.data.text ?? parsed.data.extracted_text ?? null;
}

/** Downloads an inbound attachment through AgentMail and returns its image data URL. */
export async function fetchInboundImageAttachment({
  inboxId,
  messageId,
  attachmentId,
  contentType,
}: {
  inboxId: string;
  messageId: string;
  attachmentId: string;
  contentType?: string;
}): Promise<string | null> {
  const response = await agentMailRequest(
    `/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { method: "GET" }
  );
  const parsed = attachmentResponseSchema.safeParse(response);
  if (!parsed.success) return null;

  const fileResponse = await fetch(parsed.data.download_url, {
    signal: requestSignal(),
  });
  if (!fileResponse.ok) return null;

  const bytes = new Uint8Array(await fileResponse.arrayBuffer());
  const type = parsed.data.content_type ?? contentType ?? "image/jpeg";
  return `data:${type};base64,${bytesToBase64(bytes)}`;
}

export function normalizeInboundMessage(
  message: z.infer<typeof messageSchema>
): InboundMessage {
  const receivedAt = parseTimestamp(message.timestamp ?? message.created_at);

  return {
    externalMessageId: message.message_id,
    inboxId: message.inbox_id,
    sender: firstAddress(message.from ?? message.from_),
    recipient: firstAddress(message.to),
    subject: message.subject?.trim() ?? "",
    // Prefer the complete body: extracted_text strips quoted history, which can
    // be exactly where a forwarded statement lives.
    body: (message.text ?? message.extracted_text ?? message.preview ?? "").trim(),
    receivedAt,
    threadId: message.thread_id ?? undefined,
    inReplyTo: message.in_reply_to ?? headerValue(message.headers, "in-reply-to"),
    references: parseReferences(message.references ?? headerValue(message.headers, "references")),
    attachments: (message.attachments ?? []).map((attachment) => ({
      attachmentId: attachment.attachment_id ?? undefined,
      filename: attachment.filename ?? undefined,
      contentType: attachment.content_type ?? undefined,
      size: attachment.size ?? undefined,
      inline: attachment.inline ?? undefined,
    })),
  };
}

/** Case-insensitive header lookup, since providers vary in casing. */
function headerValue(
  headers: Record<string, string | number> | null | undefined,
  name: string
): string | undefined {
  if (!headers) return undefined;

  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return String(value);
  }

  return undefined;
}

/**
 * Normalizes a References header or field into a list of message ids. The header
 * form is a whitespace-separated list; the field form may already be an array.
 */
function parseReferences(
  value: string | string[] | null | undefined
): string[] {
  if (!value) return [];

  const parts = Array.isArray(value) ? value : value.split(/\s+/);

  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/** Deterministic per-case local part, derived from the case id. */
export function caseInboxLocalPart(caseId: string): string {
  return `case-${caseId.replace(/[^a-z0-9]/gi, "").slice(-12).toLowerCase()}`;
}

function firstAddress(value: z.infer<typeof addressSchema> | null | undefined): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value.trim() || undefined;

  const first = value[0];
  if (typeof first === "string") return first.trim() || undefined;
  if (first && typeof first === "object") {
    return first.email?.trim() || undefined;
  }

  return undefined;
}

function parseTimestamp(value: string | null | undefined): number {
  if (!value) return Date.now();

  const parsed = Date.parse(value);

  return Number.isFinite(parsed) ? parsed : Date.now();
}

async function agentMailRequest(
  path: string,
  { method, body }: { method: "GET" | "POST"; body?: Record<string, unknown> }
): Promise<unknown> {
  const apiKey = process.env.AGENTMAIL_API_KEY;
  if (!apiKey) {
    throw new Error("AgentMail is not configured (AGENTMAIL_API_KEY is missing).");
  }

  const baseUrl = (process.env.AGENTMAIL_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(
    /\/+$/,
    ""
  );

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal:
      typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
        ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        : undefined,
  });

  if (!response.ok) {
    const failure = await response.text();
    throw new Error(
      `AgentMail request failed (${response.status}): ${redactCredentials(failure)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200)}`
    );
  }

  return (await response.json()) as unknown;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function requestSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
    ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    : undefined;
}
