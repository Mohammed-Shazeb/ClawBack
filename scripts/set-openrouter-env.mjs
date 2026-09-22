#!/usr/bin/env node
/**
 * Push the `OPENAI_*` values from `.env.local` onto the Convex deployment.
 *
 * Why this exists: Convex functions read their environment from the
 * *deployment*, not from `.env.local`. Those are two separate stores, and the
 * app silently keeps using the old provider if only one of them is updated —
 * which has already caused one wrong "the model is broken" diagnosis. Re-point
 * the provider in `.env.local`, then run this.
 *
 *   node scripts/set-openrouter-env.mjs          # push
 *   node scripts/set-openrouter-env.mjs --check  # show deployment vs .env.local
 *
 * Only `OPENAI_*` keys are touched. Firecrawl, AgentMail, auth and SITE_URL are
 * left alone.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
  "OPENAI_MAX_TOKENS",
];

const checkOnly = process.argv.includes("--check");

function readLocal() {
  const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  const values = {};

  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!KEYS.includes(key)) continue;
    values[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }

  return values;
}

function readDeployment(key) {
  try {
    return execFileSync("npx", ["convex", "env", "get", key], {
      encoding: "utf8",
      // An unset variable is a normal answer here, not an error to show the
      // user — `convex env get` prints a complaint on stderr for it.
      stdio: ["ignore", "pipe", "ignore"],
      shell: process.platform === "win32",
    }).trim();
  } catch {
    return undefined;
  }
}

/** Never print a secret in full — enough to tell two keys apart, no more. */
function mask(key, value) {
  if (value === undefined) return "(unset)";
  if (key !== "OPENAI_API_KEY") return value;
  return value.length > 12 ? `${value.slice(0, 10)}…${value.slice(-4)}` : "(set)";
}

const local = readLocal();
if (Object.keys(local).length === 0) {
  console.error("No OPENAI_* values found in .env.local — nothing to do.");
  process.exit(1);
}

let changed = 0;
for (const key of KEYS) {
  const want = local[key];
  const have = readDeployment(key);

  if (want === undefined) {
    console.log(`skip    ${key} (not in .env.local)`);
    continue;
  }

  if (checkOnly) {
    const same = want === have;
    console.log(
      `${same ? "ok     " : "DIFFER "}${key}\n          .env.local: ${mask(key, want)}\n          deployment: ${mask(key, have)}`
    );
    if (!same) changed += 1;
    continue;
  }

  if (want === have) {
    console.log(`ok      ${key} (already set)`);
    continue;
  }

  execFileSync("npx", ["convex", "env", "set", key, want], {
    stdio: ["ignore", "ignore", "inherit"],
    shell: process.platform === "win32",
  });
  console.log(`set     ${key} -> ${mask(key, want)}`);
  changed += 1;
}

if (checkOnly) {
  console.log(
    changed === 0
      ? "\nDeployment matches .env.local."
      : `\n${changed} value(s) differ — run without --check to push.`
  );
} else if (changed > 0) {
  console.log("\nDeployment updated. Convex reloads functions automatically.");
} else {
  console.log("\nNothing to change.");
}
