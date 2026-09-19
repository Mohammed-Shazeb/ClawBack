/**
 * Verifies the authenticated path against a real deployment.
 *
 * Why this exists separately from the other suites:
 *
 *   - `verify` proves the *decision* is correct, offline. It cannot prove that a
 *     real session token reaches it.
 *   - `verify:e2e` runs against a **local** deployment, and Convex's auth
 *     provider discovery does not work there — a token presented to the local
 *     backend is rejected with `AuthProviderDiscoveryFailed` before any function
 *     runs, so no local check can exercise the authenticated path.
 *
 * So this script talks to a deployment that genuinely accepts tokens, and proves
 * the one property the whole migration exists for: **a session's identity
 * overrides whatever `userId` the caller claims.**
 *
 * The token is minted here with the deployment's own `JWT_PRIVATE_KEY`, using
 * the same claims Convex Auth emits — `sub: userId|sessionId`, `iss` the site
 * URL, `aud: "convex"`, RS256. It is therefore indistinguishable from a token a
 * real sign-in would produce, which is what makes this a fair test rather than a
 * simulation.
 *
 * The check is built to *discriminate*: the claimed id is chosen to own at least
 * one case, so "the session won" (0 cases) and "the argument won" (≥1 case) are
 * different answers. A check that cannot fail is not a check.
 *
 * Usage:
 *   npm run verify:auth                     # the deployment in .env.local
 *   CONVEX_DEPLOYMENT=dev:foo npm run verify:auth
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { SignJWT, importPKCS8 } from "jose";

let checks = 0;
let failed = 0;

function check(name, passed, detail) {
  checks += 1;
  console.log(`${passed ? "ok  " : "FAIL"} ${name}${!passed && detail !== undefined ? ` — ${detail}` : ""}`);
  if (!passed) failed += 1;
}

function section(name) {
  console.log(`\n${name}`);
}

/** The deployment this run targets, and the two URLs it exposes. */
function resolveDeployment() {
  const raw =
    process.env.CONVEX_DEPLOYMENT ??
    /^CONVEX_DEPLOYMENT=(.*)$/m.exec(readFileSync(".env.local", "utf8"))?.[1] ??
    "";
  const name = raw.replace(/#.*$/, "").trim();
  const slug = name.replace(/^[a-z]+:/, "");

  const isLocal = name.startsWith("anonymous:");
  return {
    name,
    isLocal,
    convex: process.env.CONVEX_URL ?? (isLocal ? "http://127.0.0.1:3210" : `https://${slug}.convex.cloud`),
    site: process.env.CONVEX_SITE_URL ?? (isLocal ? "http://127.0.0.1:3211" : `https://${slug}.convex.site`),
  };
}

async function call(base, kind, path, args, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${base}/api/${kind}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ path, args }),
  });

  return JSON.parse((await res.text()) || "{}");
}

/**
 * A Convex response is either `{status:"success", value}` or
 * `{status:"error", errorMessage}`. Anything else — `AuthProviderDiscoveryFailed`
 * being the one that matters here — is reported as such rather than being
 * mistaken for a successful empty result.
 */
function outcome(response) {
  if (response.status === "success") return { kind: "ok", value: response.value };
  if (response.status === "error") return { kind: "error", message: String(response.errorMessage) };
  return { kind: "other", message: `${response.code ?? "unknown"}: ${response.message ?? ""}` };
}

/**
 * The stored value has its newlines replaced by spaces, which is what the
 * official CLI writes. The header and footer contain spaces of their own, so the
 * PEM is rebuilt from the space-separated parts rather than by replacing every
 * space with a newline (which mangles `-----BEGIN PRIVATE KEY-----`).
 */
function toPem(raw) {
  const parts = raw.trim().split(/\s+/);
  return `${parts.slice(0, 3).join(" ")}\n${parts.slice(3, -3).join("\n")}\n${parts.slice(-3).join(" ")}\n`;
}

async function main() {
  const deployment = resolveDeployment();
  console.log(`Verifying the authenticated path against ${deployment.name}`);

  section("The deployment is configured for authentication");

  const discovery = await fetch(`${deployment.site}/.well-known/openid-configuration`).catch(
    () => null
  );
  check("the site host serves an OpenID configuration", discovery?.status === 200, `status ${discovery?.status}`);

  const key = execSync("npx convex env get JWT_PRIVATE_KEY", {
    encoding: "utf8",
    env: { ...process.env, CONVEX_DEPLOYMENT: deployment.name },
  }).trim();
  check("the deployment has a JWT signing key", key.includes("BEGIN PRIVATE KEY"));

  // This script fabricates the two users it needs rather than reading rows out of
  // the database, so it needs demo mode — the only path that accepts a caller
  // supplied id. If demo mode is off, every user call below is refused and the
  // run would fail with a confusing error rather than a diagnosis.
  const demoProbe = await call(deployment.convex, "mutation", "users:ensureDemo", {});
  check(
    "demo identity is enabled, so the two probe users can be created",
    outcome(demoProbe).kind === "ok",
    `${outcome(demoProbe).kind}: ${String(outcome(demoProbe).message ?? "").slice(0, 80)}`
  );

  if (failed > 0) {
    console.log(
      `\n${checks - failed}/${checks} checks passed — the deployment is not usable for this test.`
    );
    process.exit(1);
  }

  // A user that owns at least one case, so "the session won" and "the argument
  // won" give different answers. `cases:create` is used rather than
  // `createWithInbox` so this needs no mail provider. A case is only created if
  // the demo user has none, so repeated runs do not pile up rows on the
  // deployment.
  const owner = outcome(demoProbe).value;

  const owned = await call(deployment.convex, "query", "cases:list", { userId: owner });
  let ownerCaseCount = (outcome(owned).value ?? []).length;

  if (ownerCaseCount === 0) {
    await call(deployment.convex, "mutation", "cases:create", {
      userId: owner,
      jurisdiction: "California",
      depositAmount: 1500,
      totalDeductions: 0,
    });
    ownerCaseCount = (
      outcome(await call(deployment.convex, "query", "cases:list", { userId: owner })).value ?? []
    ).length;
  }

  check(
    "the claimed user owns at least one case, so the test can discriminate",
    ownerCaseCount > 0,
    `owner has ${ownerCaseCount}`
  );

  // A separate, empty user: the token is signed for this one, so if the argument
  // were still trusted the answer would be the owner's cases instead of none.
  const strangerResponse = await call(deployment.convex, "mutation", "users:createOrGet", {
    email: `auth-probe-${Date.now()}@clawback.local`,
  });
  const stranger = outcome(strangerResponse).value;
  check(
    "a second, empty user exists to sign the token for",
    typeof stranger === "string" && stranger.length > 0,
    JSON.stringify(strangerResponse).slice(0, 120)
  );

  if (failed > 0) {
    console.log(`\n${checks - failed}/${checks} checks passed — could not create the probe users.`);
    process.exit(1);
  }

  const token = await new SignJWT({ sub: `${stranger}|verify-auth-session` })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt()
    .setIssuer(deployment.site)
    .setAudience("convex")
    .setExpirationTime("1h")
    .sign(await importPKCS8(toPem(key), "RS256"));

  section("A session token is accepted");

  const asSession = outcome(await call(deployment.convex, "query", "cases:list", {}, token));

  if (asSession.kind === "other") {
    // Not a defect in the app: the local backend cannot reach its own site host
    // for auth discovery, so it rejects every token before the function runs.
    console.log(
      `\n  The deployment rejected the token before running any function:\n` +
        `    ${asSession.message}\n\n` +
        `  ${deployment.isLocal ? "This is expected on a local backend" : "This deployment is misconfigured"} — ` +
        `Convex cannot fetch the auth configuration from ${deployment.site}.\n` +
        `  The authenticated path is NOT verified by this run.`
    );
    console.log(`\n${checks - failed}/${checks} checks passed (authenticated path NOT verified)`);
    process.exit(deployment.isLocal ? 0 : 1);
  }

  check("a session token is accepted on a function call", asSession.kind === "ok", asSession.message);

  section("The session's identity overrides the userId the caller claims");

  const claiming = await call(deployment.convex, "query", "cases:list", { userId: owner }, token);
  const claimingCount = (outcome(claiming).value ?? []).length;

  check(
    "claiming the case owner's id does not return their cases",
    claimingCount === 0,
    `expected the token owner's empty list, got ${claimingCount} — the argument is still being trusted`
  );

  const ownList = (outcome(await call(deployment.convex, "query", "cases:list", {}, token)).value ?? [])
    .length;
  check("the token owner's own list is the one returned", ownList === 0, String(ownList));

  // The mirror image: with no session, the claimed id is exactly what demo mode
  // is for. If this broke, the demo would stop working.
  const asDemo = (outcome(await call(deployment.convex, "query", "cases:list", { userId: owner })).value ?? [])
    .length;
  check("without a session the claimed id still resolves", asDemo === ownerCaseCount, String(asDemo));

  section("Identity is readable only for the caller");

  const current = outcome(await call(deployment.convex, "query", "users:current", {}, token));
  check(
    "users:current returns the session's own row",
    current.kind === "ok" && current.value?._id === stranger,
    JSON.stringify(current).slice(0, 120)
  );

  const anonymous = outcome(await call(deployment.convex, "query", "users:current", {}));
  check("users:current is null when nobody is signed in", anonymous.kind === "ok" && anonymous.value === null);

  section("An anonymous caller is refused");

  // No session and no claimed id. `ALLOW_DEMO_IDENTITY=true` does not help here:
  // demo mode accepts a *claimed* id, and there is none to accept.
  const noId = outcome(await call(deployment.convex, "query", "cases:list", {}));
  check(
    "an anonymous caller with no id is refused",
    noId.kind === "error",
    `${noId.kind}: ${String(noId.message ?? "").slice(0, 80)}`
  );

  console.log(`\n${checks - failed}/${checks} checks passed`);

  if (failed > 0) {
    console.error(`${failed} check(s) failed`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
