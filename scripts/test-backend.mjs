/**
 * Start the local Convex backend used by the mock-provider e2e suite.
 *
 * Why this wrapper exists: the app points at a **cloud** dev deployment, but
 * `verify:e2e` can never run against it — the suite needs the mock providers on
 * 127.0.0.1:4590-4592, and Convex's cloud cannot reach a localhost mock. So the
 * e2e suite needs a *local* backend on 3210/3211 while the app stays on cloud.
 *
 * `npx convex dev --env-file .env.test` selects that local deployment, but it
 * still **rewrites `.env.local`** — the file the app reads — silently repointing
 * the whole app at localhost.
 *
 * The first version of this script restored `.env.local` in an `exit` handler.
 * That does not work: killing the process (Ctrl+C in some shells, a task manager,
 * a supervisor) skips those handlers entirely, and the app is left pointed at a
 * backend that is no longer running. So the restore happens **during** the run:
 * `.env.local` is put back the moment the CLI changes it.
 *
 * The guard is deliberately **not time-boxed**. It was, for one version: a fixed
 * 60s window measured from spawn. That window is measured from the wrong moment.
 * On a cold cache `convex dev` downloads the backend binary *before* it touches
 * `.env.local`, and that download can outlast 60s — so the guard expired exactly
 * when the file was about to be rewritten, which is the one moment it exists to
 * cover. The guard now lives as long as the backend does.
 *
 * Usage:
 *   npm run test:backend      # then, in another terminal: npm run verify:e2e
 *
 * Requires the mock providers (`npm run mocks`) to be listening.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const ENV_LOCAL = ".env.local";
/**
 * How often to check the file. The guard runs for as long as the backend does —
 * see the note below on why it must not be time-boxed.
 */
const POLL_MS = 400;

if (!existsSync(ENV_LOCAL)) {
  console.error(`[test-backend] ${ENV_LOCAL} not found; nothing to protect. Aborting.`);
  process.exit(1);
}

const saved = readFileSync(ENV_LOCAL, "utf8");
const targetLine = (saved.match(/^CONVEX_DEPLOYMENT=.*$/m) ?? ["(no CONVEX_DEPLOYMENT)"])[0];

let restores = 0;

function restoreIfChanged() {
  try {
    if (readFileSync(ENV_LOCAL, "utf8") !== saved) {
      writeFileSync(ENV_LOCAL, saved);
      restores += 1;
    }
  } catch {
    // A transient read/write failure is not worth aborting the dev server for;
    // the next tick tries again.
  }
}

console.log(`[test-backend] guarding ${ENV_LOCAL}; keeping ${targetLine}`);
console.log("[test-backend] starting the local backend on 3210/3211 for the e2e suite…");

const child = spawn("npx", ["convex", "dev", "--env-file", ".env.test"], {
  stdio: "inherit",
  shell: true,
});

const guard = setInterval(restoreIfChanged, POLL_MS);

// Best-effort only. The guard above is what actually protects the file.
process.on("exit", () => {
  clearInterval(guard);
  restoreIfChanged();
});

child.on("exit", (code) => {
  clearInterval(guard);
  restoreIfChanged();
  console.log(
    `[test-backend] backend exited (${code ?? 0}); restored ${ENV_LOCAL} ${restores} time(s); left on ${targetLine}.`
  );
  process.exit(code ?? 0);
});
