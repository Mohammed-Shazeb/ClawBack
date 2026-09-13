/**
 * AgentMail delivers webhooks through Svix, which signs each delivery with an
 * HMAC-SHA256 of `{svix-id}.{svix-timestamp}.{rawBody}` using the endpoint's
 * `whsec_...` secret.
 *
 * The implementation is intentionally dependency free: Convex functions run in
 * a V8 isolate with WebCrypto but without Node's `crypto` module, so base64
 * handling is done here rather than pulled in from a package.
 */

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const SECRET_PREFIX = "whsec_";

/** Svix rejects deliveries older than five minutes; we match that window. */
const TIMESTAMP_TOLERANCE_SECONDS = 300;

export type SvixVerificationInput = {
  rawBody: string;
  headers: Headers;
  secret: string;
};

export async function verifySvixSignature({
  rawBody,
  headers,
  secret,
}: SvixVerificationInput): Promise<boolean> {
  const messageId = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatureHeader = headers.get("svix-signature");

  if (!messageId || !timestamp || !signatureHeader) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;

  const ageSeconds = Math.abs(Date.now() / 1000 - timestampSeconds);
  if (ageSeconds > TIMESTAMP_TOLERANCE_SECONDS) return false;

  const keyBytes = base64ToBytes(
    secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret
  );
  if (!keyBytes) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signedContent = `${messageId}.${timestamp}.${rawBody}`;
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent))
  );
  const expected = bytesToBase64(digest);

  // The header is a space separated list of `version,signature` pairs.
  return signatureHeader.split(" ").some((part) => {
    const [version, signature] = part.split(",");
    return (
      version === "v1" &&
      typeof signature === "string" &&
      constantTimeEquals(signature, expected)
    );
  });
}

function constantTimeEquals(a: string, b: string): boolean {  if (a.length !== b.length) return false;

  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return difference === 0;
}

/** Copies the bytes into a plain ArrayBuffer, which is what WebCrypto accepts. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let encoded = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first: number = bytes[index];
    const second: number | undefined = bytes[index + 1];
    const third: number | undefined = bytes[index + 2];

    encoded += BASE64_ALPHABET[first >> 2];
    encoded += BASE64_ALPHABET[((first & 0b11) << 4) | (second === undefined ? 0 : second >> 4)];
    encoded +=
      second === undefined
        ? "="
        : BASE64_ALPHABET[((second & 0b1111) << 2) | (third === undefined ? 0 : third >> 6)];
    encoded += third === undefined ? "=" : BASE64_ALPHABET[third & 0b111111];
  }

  return encoded;
}

export function base64ToBytes(value: string): Uint8Array | null {
  const cleaned = value.trim().replace(/=+$/, "");
  if (!cleaned) return new Uint8Array();
  if (!/^[A-Za-z0-9+/_-]+$/.test(cleaned)) return null;

  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const character of cleaned.replace(/-/g, "+").replace(/_/g, "/")) {
    const digit = BASE64_ALPHABET.indexOf(character);
    if (digit < 0) return null;

    buffer = (buffer << 6) | digit;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return new Uint8Array(bytes);
}
