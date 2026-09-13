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
    throw new Error("AgentMail accepted the inbox request but returned an unexpected response.");
  }

  return { inboxId: parsed.data.inbox_id };
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
    attachments: (message.attachments ?? []).map((attachment) => ({
      attachmentId: attachment.attachment_id ?? undefined,
      filename: attachment.filename ?? undefined,
      contentType: attachment.content_type ?? undefined,
      size: attachment.size ?? undefined,
      inline: attachment.inline ?? undefined,
    })),
  };
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
