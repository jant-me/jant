/**
 * The env file the Node dev scripts read, and write generated credentials to.
 *
 * `packages/core/.env.node` unless `JANT_ENV_FILE` is set, which overrides it
 * the way it overrides the `jant` CLI's auto-load: a path names another file,
 * and an empty value means no file at all — nothing is read, and credentials a
 * script generates last only for that run. The test suite sets it empty, so a
 * dev script a test runs never reads or rewrites a developer's `.env.node`.
 *
 * Not in `dev/scripts/`: everything there is a script the runner can run.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findNodeEnvPath, loadNodeEnvFile } from "../bin/lib/node-env.js";

const coreDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Resolve the env file for this run.
 *
 * @returns The file to read and write, or null when `JANT_ENV_FILE` is empty
 * @throws {Error} When `JANT_ENV_FILE` names a file that does not exist
 * @example
 * ```ts
 * resolveScriptEnvPath(); // "<repo>/packages/core/.env.node"
 * ```
 */
export function resolveScriptEnvPath(): string | null {
  if (process.env.JANT_ENV_FILE === undefined) {
    // Not the CLI's search: a fresh checkout has no `.env.node` yet, and the
    // scripts that write credentials create it here.
    return resolve(coreDir, ".env.node");
  }

  return findNodeEnvPath(process.cwd(), process.env);
}

/**
 * Read an env file's values, parsed the way the CLI parses them.
 *
 * @param envPath - The file from `resolveScriptEnvPath`
 * @returns The file's values, or none when there is no file
 * @example
 * ```ts
 * readScriptEnvFile(resolveScriptEnvPath()).DEMO_PASSWORD;
 * ```
 */
export function readScriptEnvFile(
  envPath: string | null,
): Record<string, string> {
  const values: Record<string, string> = {};
  if (envPath) {
    loadNodeEnvFile(envPath, values);
  }
  return values;
}

/**
 * Set keys in an env file, replacing existing lines and appending new ones.
 *
 * @param envPath - The file from `resolveScriptEnvPath`; null writes nothing
 * @param values - Keys and values to set
 * @example
 * ```ts
 * writeScriptEnvValues(envPath, { DEV_API_TOKEN: token });
 * ```
 */
export function writeScriptEnvValues(
  envPath: string | null,
  values: Record<string, string>,
): void {
  if (!envPath) {
    return;
  }

  let lines = readLines(envPath);
  const appended: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const prefix = `${key}=`;
    let updated = false;
    lines = lines.map((line) => {
      if (!line.startsWith(prefix)) {
        return line;
      }
      updated = true;
      return `${key}=${value}`;
    });

    if (!updated) {
      appended.push(`${key}=${value}`);
    }
  }

  // New keys go in one block, a blank line below the file's own lines.
  const existing = lines.join("\n").replace(/\n+$/u, "").trimEnd();
  const content = [existing, appended.join("\n")]
    .filter((block) => block !== "")
    .join("\n\n");
  writeFileSync(envPath, `${content}\n`, "utf8");
}

/**
 * Describe the env file for a script's summary output.
 *
 * @param envPath - The file from `resolveScriptEnvPath`
 * @returns The path, or a note that no file was used
 * @example
 * ```ts
 * describeScriptEnvPath(null); // "(none: JANT_ENV_FILE is empty)"
 * ```
 */
export function describeScriptEnvPath(envPath: string | null): string {
  return envPath ?? "(none: JANT_ENV_FILE is empty)";
}

function readLines(envPath: string): string[] {
  // Every line, comments and blank lines included, so a write changes only the
  // keys it sets.
  return existsSync(envPath)
    ? readFileSync(envPath, "utf8").split(/\r?\n/)
    : [];
}
