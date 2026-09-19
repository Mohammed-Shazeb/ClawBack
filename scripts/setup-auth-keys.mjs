/**
 * Set the JWT signing keys Convex Auth needs on a deployment.
 *
 * `npx @convex-dev/auth` does this too, but it also *writes code* — it would
 * overwrite `convex/auth.ts` and throw away the AgentMail transport configured
 * there. This script does only the part that is safe to automate: generate an
 * RS256 key pair and set `JWT_PRIVATE_KEY` and `JWKS`.
 *
 * The value formats are copied from the official CLI so the two are
 * interchangeable: the private key is the PKCS#8 PEM with its newlines replaced
 * by spaces, and the JWKS is `{"keys":[{"use":"sig", ...jwk}]}`.
 *
 * Usage:
 *   node scripts/setup-auth-keys.mjs
 *   node scripts/setup-auth-keys.mjs --prod
 *
 * The target is whatever `CONVEX_DEPLOYMENT` selects — from the environment if it
 * is set, otherwise from `.env.local`. It is *not* necessarily local: with this
 * project's `.env.local` the default run writes to the cloud dev deployment. To
 * target the local test backend, name it explicitly:
 *
 *   CONVEX_DEPLOYMENT=anonymous:anonymous-ClawBack node scripts/setup-auth-keys.mjs
 *
 * The private key is never printed. It is passed to `convex env set` as an
 * argument, so it is visible in that child process's argv — the same exposure
 * the official CLI accepts. Nothing here writes it to disk.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

const prod = process.argv.includes("--prod");
const deploymentFlag = prod ? " --prod" : "";

/** Which deployment this will actually write to, for the report at the end. */
function resolveTarget() {
  if (process.env.CONVEX_DEPLOYMENT) return process.env.CONVEX_DEPLOYMENT;

  try {
    const line = /^CONVEX_DEPLOYMENT=(.*)$/m.exec(readFileSync(".env.local", "utf8"))?.[1];
    return line ? line.trim() : "(unresolved)";
  } catch {
    return "(unresolved)";
  }
}

const target = resolveTarget();

const { privateKey, publicKey } = await generateKeyPair("RS256", {
  extractable: true,
});

const pkcs8 = (await exportPKCS8(privateKey)).trimEnd().replace(/\n/g, " ");
const jwks = JSON.stringify({
  keys: [{ use: "sig", ...(await exportJWK(publicKey)) }],
});

// Refuse to set anything if the shapes are wrong: a malformed key produces
// tokens that are issued fine and then fail to verify, which presents as
// "sign-in silently does nothing" and is miserable to debug.
if (!pkcs8.includes("BEGIN PRIVATE KEY") || !jwks.includes('"kty"')) {
  console.error(
    "Refusing to set keys: the generated values are not in the expected format."
  );
  process.exit(1);
}

function setVar(name, value) {
  // The JWKS is JSON, so its inner double quotes must be escaped for the shell.
  const escaped = value.replace(/"/g, '\\"');
  execSync(`npx convex env set${deploymentFlag} -- ${name} "${escaped}"`, {
    stdio: ["ignore", "ignore", "inherit"],
  });
}

setVar("JWT_PRIVATE_KEY", pkcs8);
setVar("JWKS", jwks);

const kid = JSON.parse(jwks).keys[0].kid;
console.log(
  `Set JWT_PRIVATE_KEY and JWKS on ${target}${prod ? " (production)" : ""}` +
    (kid ? ` (kid ${kid}).` : ".")
);
