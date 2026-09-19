/**
 * Starts the whole local stack in one command.
 *
 * Clawback needs three long-lived processes, and two of them fail *silently*:
 * if the Convex deployment or the mock providers stop, the UI degrades to a
 * permanent loading state with no error, and `verify:e2e` sits mute until every
 * wait times out. Both have died mid-session more than once.
 *
 * So this script exists to make those two things loud:
 *
 *   * every child's output is prefixed, so it is obvious which one is talking;
 *   * a child that exits unexpectedly is reported as a failure and takes the
 *     rest down, rather than leaving a half-dead stack;
 *   * Convex's own "functions ready" line is called out, because that is the
 *     only proof the deployment actually received the current code.
 *
 * Dependency-free on purpose — a process manager is not worth a package here.
 * Run with `npm run stack`. Ctrl+C stops everything.
 */
import { spawn } from "node:child_process";
import { createConnection } from "node:net";

const SERVICES = [
  {
    name: "convex",
    command: "npx convex dev",
    // The deployment API. If this is up, the app can talk to its backend.
    ports: [3210],
    readyWhen: /Convex functions ready!/,
    readyNote: "deployment is up and has the current functions",
  },
  {
    name: "mocks",
    command: "node scripts/mock-providers.mjs",
    // Firecrawl / OpenAI / AgentMail stand-ins.
    ports: [4590],
    readyWhen: /mocks up/,
    readyNote: "mock providers listening on 4590 / 4591 / 4592",
  },
  {
    name: "next",
    command: "npm run dev",
    ports: [3000],
    readyWhen: /Ready in|Local:\s+http/,
    readyNote: "the app is serving on http://localhost:3000",
  },
];

const COLORS = { convex: "\x1b[36m", mocks: "\x1b[35m", next: "\x1b[33m", reset: "\x1b[0m" };

function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    const done = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(1000);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/** Prefixes each complete line, holding partial lines until they finish. */
function pipeWithPrefix(stream, name, onLine) {
  let buffer = "";

  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      console.log(`${COLORS[name]}[${name}]${COLORS.reset} ${line}`);
      onLine(line);
    }
  });
}

const children = [];
let shuttingDown = false;

/**
 * Kills a child *and its descendants*.
 *
 * `shell: true` means the handle held here is `cmd.exe`, not the server it
 * launched. A plain `kill()` therefore terminates the shell and can leave
 * `convex dev` / `next dev` running and detached — which is precisely how these
 * services get orphaned, and an orphaned backend answers nothing while still
 * holding its port. On Windows `taskkill /T` walks the tree; elsewhere the shell
 * forwards the signal to its child.
 */
function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) killTree(child);

  // Give children a moment to exit cleanly, then leave regardless.
  setTimeout(() => process.exit(code), 700).unref();
}

async function main() {
  console.log("Clawback local stack\n");

  const startable = [];

  for (const service of SERVICES) {
    const inUse = await Promise.all(service.ports.map(isPortInUse));
    if (inUse.some(Boolean)) {
      console.log(
        `${COLORS[service.name]}•${COLORS.reset} ${service.name} already listening on ` +
          `${service.ports.join(", ")} — leaving it alone`
      );
      continue;
    }
    startable.push(service);
  }

  if (startable.length === 0) {
    console.log("\nEverything is already running. Nothing to start.");
    return;
  }

  console.log();

  for (const service of startable) {
    const child = spawn(service.command, {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      // Keep the child in this process group so Ctrl+C reaches it.
      windowsHide: true,
    });

    children.push(child);

    let announcedReady = false;
    const onLine = (line) => {
      if (announcedReady) return;
      if (!service.readyWhen.test(line)) return;
      announcedReady = true;
      console.log(`${COLORS[service.name]}✓${COLORS.reset} ${service.name}: ${service.readyNote}`);
    };

    pipeWithPrefix(child.stdout, service.name, onLine);
    pipeWithPrefix(child.stderr, service.name, onLine);

    child.on("exit", (code, signal) => {
      if (shuttingDown) return;

      // An unexpected exit is the failure mode this script exists to surface.
      console.error(
        `\n${COLORS[service.name]}✗${COLORS.reset} ${service.name} stopped unexpectedly ` +
          `(${signal ?? `exit ${code}`}). Shutting the stack down so nothing is left half-running.`
      );
      shutdown(1);
    });

    child.on("error", (error) => {
      console.error(`${COLORS[service.name]}✗${COLORS.reset} ${service.name} could not start: ${error.message}`);
      shutdown(1);
    });
  }

  console.log(
    "\nStarted. Press Ctrl+C to stop everything.\n" +
      "The app is at http://localhost:3000 once next reports Ready.\n"
  );
}

process.on("SIGINT", () => {
  console.log("\nStopping the stack…");
  shutdown(0);
});
process.on("SIGTERM", () => shutdown(0));

main().catch((error) => {
  console.error(error);
  shutdown(1);
});
