/**
 * The local Node development site the `db-node-*` tasks set up, fill, and
 * delete: the env and database a task targets, the dev credentials it writes,
 * and the setup every task that creates a site shares.
 *
 * Targets resolve with the defaults `mise run dev-node` uses — the database and
 * media under `packages/core/data` unless `DATA_DIR`, `DATABASE_URL`, or
 * `LOCAL_STORAGE_PATH` say otherwise — so a task acts on the site the dev
 * server serves.
 *
 * Not in `dev/scripts/`: everything there is a script the runner can run.
 */

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { getCliSiteResolutionMode } from "../bin/lib/site-selection.js";
import {
  resolveDatabaseDialect,
  type DatabaseDialect,
} from "../src/db/dialect.js";
import { getEnvString } from "../src/lib/env.js";
import { verifyPassword } from "../src/lib/password.js";
import {
  applyNodeRuntimeEnvDefaults,
  createNodeBindings,
  resolveDatabasePath,
} from "../src/node/request-handler.js";
import { setUpNodeInstance } from "../src/runtime/node.js";
import type { SetUpInstanceResult } from "../src/services/bootstrap.js";
import type { Bindings } from "../src/types/bindings.js";
import {
  readScriptEnvFile,
  resolveScriptEnvPath,
  writeScriptEnvValues,
} from "./script-env.js";
import {
  DEFAULT_DEV_PASSWORD,
  DEFAULT_SITE_LANGUAGE,
  DEFAULT_SITE_NAME,
  DEV_EMAIL,
} from "./scripts/dev-auth-db.mjs";

const coreDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultDataDir = resolve(coreDir, "data");
const defaultPort = "3000";

export interface NodeDevEnv {
  /** The env file read, and written to. Null when `JANT_ENV_FILE` is empty. */
  envPath: string | null;
  /** The env file's own values, without the process environment. */
  fileValues: Record<string, string>;
  /** The file, the process environment over it, and the runtime defaults. */
  env: Bindings;
}

export interface NodeDevCredentials {
  email: string;
  password: string;
  devApiToken: string;
}

/**
 * Whether the dev credentials sign in to the site after setup:
 * - `ok`: they do
 * - `no-account`: the site's account has another address
 * - `wrong-password`: the dev account has another password
 */
export type NodeDevSignIn = "ok" | "no-account" | "wrong-password";

export interface NodeDevSetup extends SetUpInstanceResult {
  signIn: NodeDevSignIn;
}

export interface NodeDevTargetRequirements {
  /** The mise task, named in errors. */
  task: string;
  /** Refuse Postgres: the task deletes or restores database files. */
  sqliteOnly?: boolean;
  /** Refuse storage other than the local filesystem: the task writes or deletes media. */
  localStorage?: boolean;
}

export interface NodeDevTarget {
  dialect: DatabaseDialect;
  /** The SQLite file, or the Postgres URL with its password masked. */
  database: string;
  /** The SQLite file. Null on Postgres. */
  sqlitePath: string | null;
  /** The local media directory. Null when no local storage path resolves. */
  localStoragePath: string | null;
}

/**
 * Load the env a Node dev task runs with.
 *
 * @returns The env file, its values, and the runtime env built from them
 * @throws {Error} When `JANT_ENV_FILE` names a file that does not exist
 * @example
 * ```ts
 * const devEnv = loadNodeDevEnv();
 * await migrate(devEnv.env);
 * ```
 */
export function loadNodeDevEnv(): NodeDevEnv {
  const envPath = resolveScriptEnvPath();
  const fileValues = readScriptEnvFile(envPath);
  const env = { ...fileValues, ...process.env } as Bindings;
  applyNodeRuntimeEnvDefaults(env, { cwd: coreDir, defaultDataDir });
  return { envPath, fileValues, env };
}

/**
 * Pick the dev account's password: the task's argument, then `DEMO_PASSWORD`
 * from the process environment, then from the env file, then the default.
 *
 * @param devEnv - From `loadNodeDevEnv`
 * @param cliPassword - The task's password argument, if any
 * @returns The password
 * @example
 * ```ts
 * resolveNodeDevPassword(loadNodeDevEnv(), ""); // "jant-dev-debug-login"
 * ```
 */
export function resolveNodeDevPassword(
  devEnv: NodeDevEnv,
  cliPassword: string | undefined,
): string {
  return (
    cliPassword?.trim() ||
    process.env.DEMO_PASSWORD?.trim() ||
    devEnv.fileValues.DEMO_PASSWORD?.trim() ||
    DEFAULT_DEV_PASSWORD
  );
}

/**
 * Give the run its dev credentials, generating the secrets the env lacks.
 *
 * Sets `AUTH_SECRET`, `DEV_API_TOKEN`, `DEMO_EMAIL`, and `DEMO_PASSWORD` on
 * `devEnv.env`. With `write`, also in the env file, so `mise run dev-node`
 * signs in with the same secret and accepts the same `/__dev/login` token.
 *
 * @param devEnv - From `loadNodeDevEnv`; its `env` is updated in place
 * @param options - The task's password argument, and whether to write the file
 * @returns The credentials the task prints
 * @example
 * ```ts
 * const credentials = applyNodeDevCredentials(devEnv, { cliPassword, write: true });
 * ```
 */
export function applyNodeDevCredentials(
  devEnv: NodeDevEnv,
  options: { cliPassword: string | undefined; write: boolean },
): NodeDevCredentials {
  const password = resolveNodeDevPassword(devEnv, options.cliPassword);
  const values = {
    AUTH_SECRET:
      getEnvString(devEnv.env, "AUTH_SECRET") ??
      randomBytes(32).toString("base64url"),
    DEV_API_TOKEN:
      getEnvString(devEnv.env, "DEV_API_TOKEN") ??
      `jnt_dev_${randomBytes(16).toString("hex")}`,
    DEMO_EMAIL: DEV_EMAIL,
    DEMO_PASSWORD: password,
  };

  Object.assign(devEnv.env, values);
  if (options.write) {
    writeScriptEnvValues(devEnv.envPath, values);
  }

  return {
    email: DEV_EMAIL,
    password,
    devApiToken: values.DEV_API_TOKEN,
  };
}

/**
 * Resolve the database and media a task acts on, refusing targets it cannot.
 *
 * Every task needs single-site mode and a database that outlives the run.
 * `requirements` adds what only some tasks need.
 *
 * @param env - `loadNodeDevEnv().env`
 * @param requirements - The task's name and what it needs
 * @returns The resolved target
 * @throws {Error} When the target does not meet the requirements
 * @example
 * ```ts
 * const target = resolveNodeDevTarget(env, { task: "db-node-clean", sqliteOnly: true, localStorage: true });
 * ```
 */
export function resolveNodeDevTarget(
  env: Bindings,
  requirements: NodeDevTargetRequirements,
): NodeDevTarget {
  const { task } = requirements;

  if (getCliSiteResolutionMode(env) !== "single-site") {
    throw new Error(
      `${task} only supports single-site local development. Set SITE_RESOLUTION_MODE=single-site for this workflow.`,
    );
  }

  const databaseUrl = getEnvString(env, "DATABASE_URL") ?? "";
  const dialect = resolveDatabaseDialect(databaseUrl);
  if (dialect === "pg" && requirements.sqliteOnly) {
    throw new Error(`${task} only supports Node SQLite development databases.`);
  }

  const sqlitePath =
    dialect === "sqlite" ? resolveDatabasePath(databaseUrl, coreDir) : null;
  if (sqlitePath === ":memory:") {
    throw new Error(`${task} cannot target an in-memory SQLite database.`);
  }

  const storageDriver = getEnvString(env, "STORAGE_DRIVER");
  if (requirements.localStorage && storageDriver && storageDriver !== "local") {
    throw new Error(
      `${task} only supports STORAGE_DRIVER=local or an unset storage driver.`,
    );
  }

  const localStoragePath = getEnvString(env, "LOCAL_STORAGE_PATH");

  return {
    dialect,
    database: sqlitePath ?? maskDatabasePassword(databaseUrl),
    sqlitePath,
    localStoragePath: localStoragePath
      ? isAbsolute(localStoragePath)
        ? localStoragePath
        : resolve(coreDir, localStoragePath)
      : null,
  };
}

/**
 * Delete a SQLite target's database, its WAL files, and its media directory.
 *
 * @param target - From `resolveNodeDevTarget` with `sqliteOnly`
 * @returns The paths that existed and were deleted
 * @example
 * ```ts
 * const removed = await removeNodeDevSqlite(target);
 * ```
 */
export async function removeNodeDevSqlite(
  target: NodeDevTarget,
): Promise<string[]> {
  if (!target.sqlitePath) {
    throw new Error("Only a SQLite target has database files to delete.");
  }

  const paths = [
    target.sqlitePath,
    `${target.sqlitePath}-shm`,
    `${target.sqlitePath}-wal`,
    ...(target.localStoragePath ? [target.localStoragePath] : []),
  ];
  const removed = paths.filter((path) => existsSync(path));
  for (const path of removed) {
    await rm(path, { recursive: true, force: true });
  }
  return removed;
}

/**
 * Set up the local site with the dev account, as the `/setup` screens would,
 * and check that the dev credentials sign in to it.
 *
 * A site that finished setup is left unchanged, account and password included,
 * so on one set up another way the credentials may not sign in. The check says
 * which part differs.
 *
 * @param env - A migrated runtime env with dev credentials applied
 * @param credentials - From `applyNodeDevCredentials`
 * @returns What setup found and did, and whether the credentials sign in
 * @example
 * ```ts
 * const { outcome, signIn } = await setUpNodeDevSite(devEnv.env, credentials);
 * ```
 */
export async function setUpNodeDevSite(
  env: Bindings,
  credentials: NodeDevCredentials,
): Promise<NodeDevSetup> {
  const { bindings, close } = await createNodeBindings(env);
  try {
    const setup = await setUpNodeInstance(bindings, {
      email: credentials.email,
      password: credentials.password,
      siteName: DEFAULT_SITE_NAME,
      siteLanguage: DEFAULT_SITE_LANGUAGE,
    });
    return { ...setup, signIn: await checkSignIn(bindings, credentials) };
  } finally {
    await close();
  }
}

/**
 * Print the local dev server's sign-in and auto-login URLs.
 *
 * @param env - The runtime env, for `PORT`
 * @param credentials - From `applyNodeDevCredentials`
 * @example
 * ```ts
 * printNodeDevSignIn(devEnv.env, credentials);
 * ```
 */
export function printNodeDevSignIn(
  env: Bindings,
  credentials: NodeDevCredentials,
): void {
  const baseUrl = `http://localhost:${getEnvString(env, "PORT") ?? defaultPort}`;
  console.log("Browser sign-in:");
  console.log(`  ${baseUrl}/signin`);
  console.log("");
  console.log("Auto-login:");
  console.log(
    `  ${baseUrl}/__dev/login?token=${credentials.devApiToken}&redirect=/settings`,
  );
}

async function checkSignIn(
  bindings: Bindings,
  credentials: NodeDevCredentials,
): Promise<NodeDevSignIn> {
  const nodeDatabase = bindings.NODE_DATABASE;
  if (!nodeDatabase) {
    throw new Error("Node database binding is missing.");
  }

  const { db, schema } = nodeDatabase;
  const [account] = await db
    .select({ password: schema.account.password })
    .from(schema.user)
    .innerJoin(
      schema.account,
      and(
        eq(schema.account.userId, schema.user.id),
        eq(schema.account.providerId, "credential"),
      ),
    )
    .where(eq(schema.user.email, credentials.email))
    .limit(1);

  if (!account) {
    return "no-account";
  }

  const matches =
    !!account.password &&
    (await verifyPassword({
      hash: account.password,
      password: credentials.password,
    }));
  return matches ? "ok" : "wrong-password";
}

function maskDatabasePassword(databaseUrl: string): string {
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.password) {
      parsed.password = "*****";
    }
    return parsed.toString();
  } catch {
    return databaseUrl;
  }
}
