import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { agentMailWebhookEventSchema, normalizeInboundMessage } from "./agentmail";
import { verifySvixSignature } from "./svix";

/**
 * AgentMail inbound webhook.
 *
 * Deliberately thin: verify, validate, hand the message to a mutation, and
 * acknowledge. Extraction is scheduled by the mutation so AgentMail gets its
 * 200 immediately and retries are harmless.
 */

const http = httpRouter();

const PATH = "/agentmail/webhook";

http.route({
  path: PATH,
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.AGENTMAIL_WEBHOOK_SECRET;
    if (!secret) {
      // Fail closed: an unverified endpoint would let anyone forge a statement.
      console.error("AgentMail webhook rejected: AGENTMAIL_WEBHOOK_SECRET is not set");
      return jsonResponse(503, { error: "webhook_not_configured" });
    }

    const rawBody = await request.text();

    const verified = await verifySvixSignature({
      rawBody,
      headers: request.headers,
      secret,
    });

    if (!verified) {
      return jsonResponse(401, { error: "invalid_signature" });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return jsonResponse(400, { error: "invalid_json" });
    }

    const event = agentMailWebhookEventSchema.safeParse(payload);
    if (!event.success) {
      return jsonResponse(400, { error: "invalid_payload" });
    }

    if (event.data.event_type !== "message.received") {
      return jsonResponse(200, { ignored: true });
    }

    if (!event.data.message) {
      return jsonResponse(400, { error: "missing_message" });
    }

    const message = normalizeInboundMessage(event.data.message);

    const result = await ctx.runMutation(internal.emails.ingestInbound, message);

    return jsonResponse(200, {
      received: true,
      emailId: result.emailId,
      created: result.created,
      associated: result.caseId !== null,
    });
  }),
});

export default http;

function jsonResponse(status: number, payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
