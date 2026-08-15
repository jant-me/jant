import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve the CLI entry point of the locally installed Wrangler.
 *
 * Wrangler ships an `exports` map (since 4.x) that does not expose
 * `./bin/wrangler.js`, so the executable is derived from the package manifest
 * — `./package.json` stays exported — instead of being resolved directly.
 *
 * @param {string} [cwd] Directory to resolve `wrangler` from first.
 * @returns {string} Absolute path to Wrangler's CLI entry point.
 * @example
 * resolveWranglerBin("/repo/packages/core");
 * // => "/repo/node_modules/.pnpm/wrangler@4.122.0/node_modules/wrangler/bin/wrangler.js"
 */
function resolveWranglerBin(cwd = process.cwd()) {
  const require = createRequire(import.meta.url);
  const fallbackPath = dirname(fileURLToPath(import.meta.url));
  let manifestPath;

  try {
    manifestPath = require.resolve("wrangler/package.json", {
      paths: [cwd, fallbackPath],
    });
  } catch (error) {
    throw new Error(
      [
        "Unable to resolve a local Wrangler installation.",
        "Install `wrangler` in the current project before running this command.",
      ].join(" "),
      { cause: error },
    );
  }

  const manifest = require(manifestPath);
  const binEntry =
    typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.wrangler;

  if (!binEntry) {
    throw new Error(
      `Wrangler ${manifest.version ?? "(unknown version)"} at ${dirname(manifestPath)} declares no \`wrangler\` executable. Reinstall dependencies to get a supported Wrangler build.`,
    );
  }

  return resolve(dirname(manifestPath), binEntry);
}

export function runLocalWrangler(args, options = {}) {
  const {
    cwd = process.cwd(),
    encoding = "utf-8",
    env = process.env,
    stdio = "pipe",
    ...execOptions
  } = options;

  return execFileSync(process.execPath, [resolveWranglerBin(cwd), ...args], {
    ...execOptions,
    cwd,
    encoding,
    env,
    stdio,
  });
}
