/**
 * Turns anything thrown by the email pipeline into a short message that is
 * safe to store on a record and show in the UI.
 *
 * Provider responses are truncated and stripped of anything that looks like a
 * credential, so a failure can never leak an API key into the database.
 */

const CREDENTIAL_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{6,}/g,
  /\bam_[A-Za-z0-9_-]{6,}/g,
  /\bfc-[A-Za-z0-9_-]{6,}/g,
  /\bwhsec_[A-Za-z0-9+/_=-]{6,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{6,}=*/gi,
  /\b(?:api[_-]?key|authorization|secret)["'\s:=]+[A-Za-z0-9._~+/-]{6,}/gi,
];

const MAX_LENGTH = 300;
const FALLBACK_MESSAGE = "The statement could not be processed.";

export function redactCredentials(value: string): string {
  return CREDENTIAL_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, "[redacted]"),
    value
  );
}

export function toSafeMessage(error: unknown, fallback = FALLBACK_MESSAGE): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  const cleaned = redactCredentials(raw).replace(/\s+/g, " ").trim();

  return cleaned ? cleaned.slice(0, MAX_LENGTH) : fallback;
}
