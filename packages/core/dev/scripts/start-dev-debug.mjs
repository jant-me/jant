import { spawn } from "node:child_process";
import { createServer } from "node:net";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_DEBUG_PORT = 19020;
const MAX_PORT_ATTEMPTS = 100;
const CORE_DIR = fileURLToPath(new URL("../../", import.meta.url));
const PNPM_BIN = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

let activeChild = null;

class CommandSignalError extends Error {
  constructor(command, args, signal) {
    super(`${command} ${args.join(" ")} exited with ${signal}.`);
    this.signal = signal;
  }
}

function signalExitCode(signal) {
  return signal === "SIGINT" ? 130 : 143;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (activeChild && !activeChild.killed) {
      activeChild.kill(signal);
      return;
    }

    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();

    server.unref();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}

async function findAvailablePort(startPort) {
  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset += 1) {
    const port = startPort + offset;

    if (await isPortAvailable(port)) {
      return port;
    }
  }

  throw new Error(
    `No free debug port found in ${startPort}-${startPort + MAX_PORT_ATTEMPTS - 1}.`,
  );
}

function runCommand(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: CORE_DIR,
      env,
      stdio: "inherit",
    });

    activeChild = child;

    child.once("error", (error) => {
      activeChild = null;
      reject(error);
    });

    child.once("exit", (code, signal) => {
      activeChild = null;

      if (signal) {
        reject(new CommandSignalError(command, args, signal));
        return;
      }

      if (code !== 0) {
        reject(
          new Error(`${command} ${args.join(" ")} exited with status ${code}.`),
        );
        return;
      }

      resolve();
    });
  });
}

async function main() {
  const debugPort = await findAvailablePort(DEFAULT_DEBUG_PORT);
  const env = { ...process.env, DEBUG_PORT: String(debugPort) };

  if (debugPort === DEFAULT_DEBUG_PORT) {
    console.log(`Using debug port ${debugPort}.`);
  } else {
    console.log(
      `Debug port ${DEFAULT_DEBUG_PORT} is busy. Using ${debugPort} instead.`,
    );
  }

  // Migrate first: the auth setup writes to `site`, `user`, and `account`,
  // which a fresh `.wrangler` does not have yet.
  await runCommand(PNPM_BIN, ["db:migrate:local"], env);
  await runCommand(process.execPath, ["dev/scripts/setup-dev-auth.mjs"], env);
  await runCommand(
    PNPM_BIN,
    ["exec", "vite", "dev", "--port", String(debugPort), "--strictPort"],
    env,
  );
}

try {
  await main();
} catch (error) {
  if (error instanceof CommandSignalError) {
    process.exit(signalExitCode(error.signal));
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
