/**
 * Delivery for Convex Auth's sign-in email.
 *
 * Routed through AgentMail rather than a new provider on purpose: the app
 * already holds working AgentMail credentials, so adding a magic-link sender
 * costs no new account and no new secret. Set `AUTH_EMAIL_INBOX` to the inbox
 * that should send it — the inbox *is* the sender, so no `from` is passed.
 *
 * `AUTH_EMAIL_TRANSPORT=log` writes the link to the Convex logs instead, which
 * is how a local run completes a sign-in without a mail provider. It is
 * dev-only by intent — a logged sign-in link is a credential sitting in a log
 * file — so it never engages implicitly; it has to be asked for by name.
 *
 * Every misconfiguration here fails loudly rather than silently dropping the
 * mail, because the symptom of a silent drop is "sign-in does nothing", which
 * is indistinguishable from a dozen other faults.
 */

const DEFAULT_BASE_URL = "https://api.agentmail.to/v0";

export async function sendSignInEmail({
  to,
  url,
  token,
}: {
  to: string;
  url: string;
  token: string;
}): Promise<void> {
  const transport = process.env.AUTH_EMAIL_TRANSPORT ?? "agentmail";

  const text = [
    "Use the link below to sign in to Clawback.",
    "",
    url,
    "",
    `If the link does not work, enter this code: ${token}`,
    "",
    "The link expires in one hour. If you did not ask to sign in, ignore this message.",
  ].join("\n");

  if (transport === "log") {
    console.log(`[auth] sign-in link for ${to}: ${url}`);
    return;
  }

  if (transport !== "agentmail") {
    throw new Error(
      `Unknown AUTH_EMAIL_TRANSPORT "${transport}". Use "agentmail" or "log".`
    );
  }

  const apiKey = process.env.AGENTMAIL_API_KEY;
  const inboxId = process.env.AUTH_EMAIL_INBOX;
  const baseUrl = (process.env.AGENTMAIL_API_BASE_URL ?? DEFAULT_BASE_URL).replace(
    /\/+$/,
    ""
  );

  if (!apiKey) {
    throw new Error(
      "AGENTMAIL_API_KEY is not set, so the sign-in email cannot be sent."
    );
  }

  if (!inboxId) {
    throw new Error(
      "AUTH_EMAIL_INBOX is not set. Point it at the AgentMail inbox that should send " +
        "sign-in mail, or set AUTH_EMAIL_TRANSPORT=log for local development."
    );
  }

  const response = await fetch(
    `${baseUrl}/inboxes/${encodeURIComponent(inboxId)}/messages/send`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ to, subject: "Sign in to Clawback", text }),
    }
  );

  if (!response.ok) {
    // Never echo the body into the error for a 2xx-less response without a cap:
    // a provider error can quote the request, and the request holds the link.
    const detail = await response.text().catch(() => "");
    throw new Error(
      `AgentMail refused the sign-in email (${response.status}): ${detail.slice(0, 200)}`
    );
  }
}
