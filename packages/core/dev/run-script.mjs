#!/usr/bin/env node

/**
 * Run a TypeScript dev script with `src/` compiled the way Vite compiles it.
 *
 *   node dev/run-script.mjs dev/scripts/reset-node-dev.ts [args...]
 *   node dev/run-script.mjs --check dev/scripts/a.ts [dev/scripts/b.ts ...]
 *
 * Not tsx: `src/` is written for the Vite pipeline. `lib/filter-dimensions.ts`
 * declares its reader-facing names with `msg` from `@lingui/core/macro`, which
 * exists only after the SWC Lingui transform. tsx hands Node the macro package
 * itself, which exports no `msg`, so `db-node-rebuild-demo` died before its
 * first line from 539cd1bf on, and nothing failed. Here the script and every
 * module it reaches go through `vite.config.script.ts`: the transform and
 * `define` globals the builds use.
 *
 * The contract: importing a dev script does no work. The script's entry point
 * is its default export, called with the arguments after the script path. That
 * is what lets `--check` load a script, evaluating everything it imports,
 * without running it — `src/__tests__/dev-scripts.test.ts` checks every script
 * in `dev/scripts/` that way.
 */

import { resolve } from "node:path";
import { createServer, isRunnableDevEnvironment } from "vite";

const coreDir = resolve(import.meta.dirname, "..");

function printUsage() {
  console.error("Usage: node dev/run-script.mjs <script.ts> [args...]");
  console.error("       node dev/run-script.mjs --check <script.ts>...");
}

/**
 * Import a dev script through the module runner and return its entry point.
 *
 * @param runner - The SSR environment's module runner
 * @param scriptPath - Path to the script, relative to the working directory
 * @returns The script's default export
 */
async function loadEntryPoint(runner, scriptPath) {
  const module = await runner.import(resolve(scriptPath));
  if (typeof module.default !== "function") {
    throw new Error(
      `${scriptPath} has no default export to run. A dev script exports its entry point as default and does no work when imported.`,
    );
  }
  return module.default;
}

const argv = process.argv.slice(2);
const checkOnly = argv[0] === "--check";
const scripts = checkOnly ? argv.slice(1) : argv.slice(0, 1);

if (scripts.length === 0) {
  printUsage();
  process.exit(2);
}

// Vite sets NODE_ENV for the dev server it believes it is starting. A script is
// not one, and everything it spawns inherits the value: `db-node-load-demo`'s
// `pnpm build` shipped Lit's development bundle into the export theme. The
// script gets the environment it was started with.
const startingNodeEnv = process.env.NODE_ENV;
const server = await createServer({
  configFile: resolve(coreDir, "vite.config.script.ts"),
});
if (startingNodeEnv === undefined) {
  delete process.env.NODE_ENV;
} else {
  process.env.NODE_ENV = startingNodeEnv;
}

try {
  const environment = server.environments.ssr;
  if (!isRunnableDevEnvironment(environment)) {
    throw new Error("The Vite SSR environment cannot run modules.");
  }

  if (checkOnly) {
    for (const script of scripts) {
      await loadEntryPoint(environment.runner, script);
      console.log(`Loaded ${script}`);
    }
  } else {
    const main = await loadEntryPoint(environment.runner, scripts[0]);
    await main(argv.slice(1));
  }
} catch (error) {
  // Print before closing the server. Closing turns the runner's source maps
  // off, and a stack formatted after that points into the transformed code.
  console.error(error);
  await server.close();
  process.exit(1);
}

await server.close();
