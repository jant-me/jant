import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function stripSurroundingQuotes(value) {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

function fileExists(envPath) {
  try {
    readFileSync(envPath, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Locate `.env.node` for CLI auto-load.
 *
 * `JANT_ENV_FILE` overrides the search whenever it is set: a path names the
 * file to load, and an empty value means "load nothing". The empty form is
 * what keeps a developer's `packages/core/.env.node` out of the test suite —
 * see the `env` block in `vitest.config.ts`.
 *
 * Without the override, the search order is:
 *   1. `<cwd>/.env.node`             — user's site directory
 *   2. `<bin>/../../.env.node`        — `packages/core/.env.node` (in-repo dev)
 *
 * @param {string} [cwd] - Directory searched first, and the base a relative
 *   `JANT_ENV_FILE` resolves against. Defaults to `process.cwd()`.
 * @param {Record<string, string | undefined>} [env] - Environment to read
 *   `JANT_ENV_FILE` from. Defaults to `process.env`.
 * @returns {string | null} The env file to load, or `null` when there is none.
 * @throws {Error} When `JANT_ENV_FILE` names a file that does not exist.
 * @example
 * findNodeEnvPath(process.cwd(), { JANT_ENV_FILE: "" }); // null
 * findNodeEnvPath(process.cwd(), { JANT_ENV_FILE: "./staging.env" });
 */
export function findNodeEnvPath(cwd = process.cwd(), env = process.env) {
  const override = env.JANT_ENV_FILE;
  if (override !== undefined) {
    const trimmed = override.trim();
    if (trimmed === "") {
      return null;
    }

    const overridePath = resolve(cwd, trimmed);
    if (!fileExists(overridePath)) {
      throw new Error(
        `JANT_ENV_FILE points at "${override}", which does not exist. ` +
          "Set it to a readable env file, or to an empty value to skip the env file.",
      );
    }

    return overridePath;
  }

  const candidates = [
    resolve(cwd, ".env.node"),
    resolve(dirname(fileURLToPath(import.meta.url)), "../../.env.node"),
  ];

  for (const candidate of candidates) {
    if (fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Parse the .env.node file and assign keys into `env`. Existing values in
 * `env` are preserved (already-exported shell vars win over file values).
 *
 * Returns a result object useful for debug logging:
 *   { envPath, found, assignedKeys, skippedKeys }
 */
export function loadNodeEnvFile(envPath, env = process.env) {
  const result = {
    envPath,
    found: false,
    assignedKeys: [],
    skippedKeys: [],
  };

  let content;
  try {
    content = readFileSync(envPath, "utf8");
  } catch {
    return result;
  }

  result.found = true;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = stripSurroundingQuotes(trimmed.slice(eqIdx + 1).trim());
    if (key in env) {
      result.skippedKeys.push(key);
      continue;
    }
    env[key] = value;
    result.assignedKeys.push(key);
  }

  return result;
}

/**
 * Auto-locate and load `.env.node` for any DB-touching CLI command.
 *
 * Always called before `resolveCliRuntime()`, so DATABASE_URL / DATA_DIR
 * defined in `.env.node` make `--node` (or auto-detect) work without
 * requiring the user to source the file manually.
 *
 * Honours `JANT_ENV_FILE` through {@link findNodeEnvPath}, so a caller that
 * needs a fully controlled environment can opt out of the file entirely.
 */
export function autoloadNodeEnv(env = process.env) {
  const envPath = findNodeEnvPath(process.cwd(), env);
  if (!envPath) {
    return { envPath: null, found: false, assignedKeys: [], skippedKeys: [] };
  }
  return loadNodeEnvFile(envPath, env);
}
