/**
 * First-deploy setup for a Cloudflare project.
 *
 * `create-jant` writes `database_id = "local"` into `wrangler.toml`: enough for
 * `npm run dev`, which only touches the local D1, and a placeholder no remote
 * command can use. `jant deploy` sees it and creates what the site needs on
 * Cloudflare before the first deploy — the D1 database, the R2 buckets, and a
 * production `AUTH_SECRET` — so a new project deploys with one command.
 *
 * Every step looks before it creates. A database or bucket with the configured
 * name is reused, and an `AUTH_SECRET` the Worker already has is never
 * replaced, so a rerun after a failure, or a project scaffolded again under the
 * same name, picks up where the last run stopped.
 */

import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { parse as parseToml } from "smol-toml";
import {
  readWranglerDatabaseConfig,
  resolveWranglerConfigPath,
} from "./migration-artifacts.js";
import { runLocalWrangler } from "./wrangler-cli.js";
import { extractWranglerJson } from "./wrangler-json.js";

/** The `database_id` create-jant writes for local development. */
export const PLACEHOLDER_DATABASE_ID = "local";

/**
 * Where the first deploy sends the author next. Written out here rather than
 * through `getJantDocsUrl()`, which lives in the TypeScript runtime the CLI
 * doesn't load; the CLI always links the released docs.
 */
export const BEFORE_GOING_LIVE_URL =
  "https://jant.me/docs/deployment#before-going-live";

const R2_DASHBOARD_URL = "https://dash.cloudflare.com/?to=/:account/r2";

/**
 * Whether the D1 binding still has no real database behind it.
 *
 * A config with no such binding needs no setup: whatever needs the database
 * later reports the missing binding itself.
 *
 * @param {{ configPath?: string, env?: string, database?: string }} options
 * @returns {boolean} True when `database_id` is missing or create-jant's placeholder
 * @example
 * needsFirstDeploySetup({ configPath: "wrangler.toml" }); // true right after `npm create jant`
 */
export function needsFirstDeploySetup(options = {}) {
  let databaseId;
  try {
    ({ databaseId } = readWranglerDatabaseConfig(options));
  } catch {
    return false;
  }
  return !databaseId || databaseId === PLACEHOLDER_DATABASE_ID;
}

function wranglerOutput(error) {
  return `${error?.stdout ?? ""}\n${error?.stderr ?? ""}\n${error?.message ?? ""}`;
}

/**
 * The first error line Wrangler printed, without its color codes and banner.
 *
 * @param {unknown} error - What `runLocalWrangler` threw
 * @returns {string} One line to show the author
 */
function wranglerErrorLine(error) {
  const lines = wranglerOutput(error)
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const errorLine = lines.find((line) => line.startsWith("✘"));
  const detail = errorLine
    ? lines[lines.indexOf(errorLine) + 1]
    : lines.find((line) => !line.startsWith("🪵"));
  const head = errorLine?.replace(/^✘\s*\[ERROR\]\s*/, "");
  return [head, detail].filter(Boolean).join(" ") || "unknown error";
}

function isInteractive(io) {
  return Boolean(io.stdin.isTTY && io.stdout.isTTY) && !process.env.CI;
}

function contextArgs(context) {
  const args = ["--config", context.configPath];
  if (context.env) args.push("--env", context.env);
  return args;
}

function readJson(output) {
  return JSON.parse(extractWranglerJson(output).trim());
}

/**
 * Make sure Wrangler is signed in, running `wrangler login` when a person is
 * at the terminal. A script or coding agent gets an error that says what to
 * run instead, since the sign-in happens in a browser.
 */
function ensureSignedIn(context) {
  const whoami = () => {
    try {
      return readJson(context.wrangler(["whoami", "--json"]));
    } catch (error) {
      try {
        return readJson(String(error?.stdout ?? ""));
      } catch {
        throw new Error(
          `Could not check the Cloudflare sign-in: ${wranglerErrorLine(error)}`,
        );
      }
    }
  };

  let user = whoami();
  if (user.loggedIn) return user;

  if (!isInteractive(context.io)) {
    throw new Error(
      "Not signed in to Cloudflare. Run `npx wrangler login` and finish the sign-in in the browser, or set CLOUDFLARE_API_TOKEN. Then deploy again.",
    );
  }

  context.log("Not signed in to Cloudflare. Opening the browser to sign in...");
  context.wrangler(["login"], { stdio: "inherit" });
  user = whoami();
  if (!user.loggedIn) {
    throw new Error(
      "Cloudflare sign-in didn't finish. Run `npx wrangler login`, then deploy again.",
    );
  }
  return user;
}

function configuredAccountId(context) {
  if (process.env.CLOUDFLARE_ACCOUNT_ID)
    return process.env.CLOUDFLARE_ACCOUNT_ID;
  const config = parseToml(readFileSync(context.absoluteConfigPath, "utf-8"));
  const scoped = context.env ? config.env?.[context.env] : undefined;
  return scoped?.account_id ?? config.account_id ?? null;
}

/**
 * Pick the account to create resources in when the sign-in reaches more than
 * one, and remember it in `wrangler.toml` so later deploys don't ask again.
 */
async function ensureAccount(user, context) {
  const accounts = Array.isArray(user.accounts) ? user.accounts : [];
  if (accounts.length < 2 || configuredAccountId(context)) return;

  const listing = accounts
    .map((account, index) => `  ${index + 1}. ${account.name} (${account.id})`)
    .join("\n");

  if (!isInteractive(context.io)) {
    throw new Error(
      `This Cloudflare sign-in can use more than one account:\n${listing}\nAdd account_id = "<id>" to wrangler.toml, or set CLOUDFLARE_ACCOUNT_ID, then deploy again.`,
    );
  }

  context.log("This Cloudflare sign-in can use more than one account:");
  context.log(listing);
  const answer = await context.ask(
    `Deploy to which account? [1-${accounts.length}] `,
  );
  const account = accounts[Number.parseInt(answer, 10) - 1];
  if (!account) {
    throw new Error(`"${answer}" isn't one of the listed accounts.`);
  }

  const raw = readFileSync(context.absoluteConfigPath, "utf-8");
  writeFileSync(context.absoluteConfigPath, setAccountId(raw, account.id));
  context.log(`Using ${account.name}. Saved its account_id in wrangler.toml.`);
}

function findD1Database(name, context) {
  const databases = readJson(
    context.wrangler(["d1", "list", "--json", ...contextArgs(context)]),
  );
  return databases.find((database) => database.name === name) ?? null;
}

function ensureD1Database(databaseName, context) {
  const existing = findD1Database(databaseName, context);
  if (existing) {
    context.log(`D1 database ${databaseName}: found, reusing it.`);
    return existing.uuid;
  }

  try {
    context.wrangler(["d1", "create", databaseName, ...contextArgs(context)]);
  } catch (error) {
    throw new Error(
      `Could not create the D1 database ${databaseName}: ${wranglerErrorLine(error)}`,
    );
  }
  const created = findD1Database(databaseName, context);
  if (!created) {
    throw new Error(
      `Created the D1 database ${databaseName}, but it isn't in \`wrangler d1 list\` yet. Deploy again in a minute.`,
    );
  }
  context.log(`D1 database ${databaseName}: created.`);
  return created.uuid;
}

function r2NotEnabled(error) {
  return /code: 10042|enable R2/i.test(wranglerOutput(error));
}

function r2NotEnabledError() {
  return new Error(
    `R2 isn't enabled on this Cloudflare account. Open ${R2_DASHBOARD_URL}, click Enable R2, then deploy again.`,
  );
}

function ensureR2Bucket(bucket, context) {
  const name = String(bucket.bucket_name);
  const jurisdiction = bucket.jurisdiction
    ? ["--jurisdiction", String(bucket.jurisdiction)]
    : [];

  try {
    context.wrangler([
      "r2",
      "bucket",
      "info",
      name,
      "--json",
      ...jurisdiction,
      ...contextArgs(context),
    ]);
    context.log(`R2 bucket ${name}: found, reusing it.`);
    return;
  } catch (error) {
    if (r2NotEnabled(error)) throw r2NotEnabledError();
    if (!/code: 10006|does not exist/i.test(wranglerOutput(error))) {
      throw new Error(
        `Could not check the R2 bucket ${name}: ${wranglerErrorLine(error)}`,
      );
    }
  }

  try {
    context.wrangler([
      "r2",
      "bucket",
      "create",
      name,
      ...jurisdiction,
      ...contextArgs(context),
    ]);
  } catch (error) {
    if (r2NotEnabled(error)) throw r2NotEnabledError();
    throw new Error(
      `Could not create the R2 bucket ${name}: ${wranglerErrorLine(error)}`,
    );
  }
  context.log(`R2 bucket ${name}: created.`);
}

function workerHasSecret(secretName, context) {
  try {
    const secrets = readJson(
      context.wrangler([
        "secret",
        "list",
        "--format",
        "json",
        ...contextArgs(context),
      ]),
    );
    return secrets.some((secret) => secret.name === secretName);
  } catch (error) {
    // A Worker that was never deployed has no secrets yet.
    if (/Worker ".*" not found|code: 10007/i.test(wranglerOutput(error))) {
      return false;
    }
    throw new Error(
      `Could not read the Worker's secrets: ${wranglerErrorLine(error)}`,
    );
  }
}

/**
 * Write a generated `AUTH_SECRET` to a file `wrangler deploy --secrets-file`
 * reads, so the Worker's first version starts with it. The file is readable by
 * the current user only and removed once the deploy is over.
 */
function writeAuthSecretFile() {
  const dir = mkdtempSync(join(tmpdir(), "jant-deploy-"));
  const path = join(dir, "secrets.json");
  writeFileSync(
    path,
    JSON.stringify({ AUTH_SECRET: randomBytes(32).toString("base64") }),
    { mode: 0o600 },
  );
  return { path, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

function findTableHeader(line) {
  const match = line.match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/);
  return match ? match[1] : null;
}

/**
 * Put a D1 database ID into `wrangler.toml` text, keeping its comments and
 * layout: the `database_id` line of the binding's `[[d1_databases]]` entry is
 * replaced, or added after `database_name` when the entry has none.
 *
 * @param {string} raw - The file's text
 * @param {{ binding: string, databaseId: string, env?: string }} target
 * @returns {string} The updated text
 * @example
 * setD1DatabaseId(raw, { binding: "DB", databaseId: "7c1e…" });
 */
export function setD1DatabaseId(raw, { binding, databaseId, env }) {
  const tableName = env ? `env.${env}.d1_databases` : "d1_databases";
  const lines = raw.split("\n");
  const headers = lines
    .map((line, index) => ({ index, name: findTableHeader(line) }))
    .filter((header) => header.name !== null);
  const blocks = headers.map((header, position) => ({
    name: header.name,
    start: header.index,
    end: headers[position + 1]?.index ?? lines.length,
  }));
  const block = blocks.find(
    ({ name, start, end }) =>
      name === tableName &&
      entryHasBinding(lines.slice(start + 1, end), binding),
  );

  if (!block) {
    throw new Error(`No [[${tableName}]] entry for binding "${binding}".`);
  }

  const { start, end } = block;
  const entry = lines.slice(start + 1, end);
  const idLine = entry.findIndex((line) => /^\s*database_id\s*=/.test(line));
  if (idLine !== -1) {
    lines[start + 1 + idLine] = lines[start + 1 + idLine].replace(
      /^(\s*database_id\s*=\s*)(["'])[^"']*\2/,
      `$1"${databaseId}"`,
    );
  } else {
    const nameLine = entry.findIndex((line) =>
      /^\s*database_name\s*=/.test(line),
    );
    const bindingLine = entry.findIndex((line) => /^\s*binding\s*=/.test(line));
    const after = start + 1 + (nameLine !== -1 ? nameLine : bindingLine);
    lines.splice(after + 1, 0, `database_id = "${databaseId}"`);
  }

  return lines.join("\n");
}

function entryHasBinding(entryLines, binding) {
  return entryLines.some((line) => {
    const match = line.match(/^\s*binding\s*=\s*(["'])([^"']*)\1/);
    return match?.[2] === binding;
  });
}

/**
 * Add a top-level `account_id` to `wrangler.toml` text, after `name` or
 * before the first table. Environments inherit it.
 *
 * @param {string} raw - The file's text
 * @param {string} accountId - The Cloudflare account ID
 * @returns {string} The updated text
 * @example
 * setAccountId('name = "blog"\n[vars]\n', "abc"); // 'name = "blog"\naccount_id = "abc"\n[vars]\n'
 */
export function setAccountId(raw, accountId) {
  const lines = raw.split("\n");
  const firstTable = lines.findIndex((line) => findTableHeader(line) !== null);
  const topLevel = firstTable === -1 ? lines.length : firstTable;
  const nameLine = lines
    .slice(0, topLevel)
    .findIndex((line) => /^\s*name\s*=/.test(line));
  const insertAt = nameLine !== -1 ? nameLine + 1 : topLevel;
  lines.splice(insertAt, 0, `account_id = "${accountId}"`);
  return lines.join("\n");
}

function readR2Buckets(context) {
  const config = parseToml(readFileSync(context.absoluteConfigPath, "utf-8"));
  const scoped = context.env ? config.env?.[context.env] : config;
  const buckets = scoped?.r2_buckets;
  return Array.isArray(buckets)
    ? buckets.filter((bucket) => bucket?.bucket_name)
    : [];
}

/**
 * Create what a first deploy needs on Cloudflare and point `wrangler.toml` at
 * the D1 database.
 *
 * Call it only when {@link needsFirstDeploySetup} says so. The returned
 * `restore` puts the placeholder back, for a deploy that fails: the next run
 * then sets up again, reusing what this one created, and still hands the
 * Worker its `AUTH_SECRET`.
 *
 * @param {{ configPath: string, env?: string, database: string }} options
 * @param {object} [deps] - Injected for tests
 * @returns {Promise<{ secretsFile: string | null, restore: () => void, cleanup: () => void }>}
 * @example
 * const setup = await runFirstDeploySetup({ configPath: "wrangler.toml", database: "DB" });
 */
export async function runFirstDeploySetup(options, deps = {}) {
  const io = deps.io ?? { stdin: process.stdin, stdout: process.stdout };
  const context = {
    configPath: options.configPath,
    absoluteConfigPath: resolveWranglerConfigPath(options.configPath),
    env: options.env,
    io,
    log: deps.log ?? ((message) => console.log(message)),
    wrangler:
      deps.wrangler ??
      ((args, runOptions = {}) => runLocalWrangler(args, runOptions)),
    ask:
      deps.ask ??
      (async (question) => {
        const readline = createInterface({
          input: io.stdin,
          output: io.stdout,
        });
        try {
          return (await readline.question(question)).trim();
        } finally {
          readline.close();
        }
      }),
  };

  const { databaseName } = readWranglerDatabaseConfig({
    configPath: options.configPath,
    env: options.env,
    database: options.database,
  });
  if (!databaseName) {
    throw new Error(
      `Add database_name to the [[d1_databases]] entry for "${options.database}" in ${options.configPath}, then deploy again.`,
    );
  }

  context.log("First deploy: setting up Cloudflare resources...");
  const user = ensureSignedIn(context);
  await ensureAccount(user, context);

  const databaseId = ensureD1Database(databaseName, context);
  for (const bucket of readR2Buckets(context)) {
    ensureR2Bucket(bucket, context);
  }

  let secrets = null;
  if (workerHasSecret("AUTH_SECRET", context)) {
    context.log("AUTH_SECRET: already set on the Worker, keeping it.");
  } else {
    secrets = writeAuthSecretFile();
    context.log("AUTH_SECRET: generated. It goes to the Worker as a secret.");
  }

  const configured = readFileSync(context.absoluteConfigPath, "utf-8");
  const updated = setD1DatabaseId(configured, {
    binding: options.database,
    databaseId,
    env: options.env,
  });
  writeFileSync(context.absoluteConfigPath, updated);
  if (
    readWranglerDatabaseConfig({
      configPath: options.configPath,
      env: options.env,
      database: options.database,
    }).databaseId !== databaseId
  ) {
    writeFileSync(context.absoluteConfigPath, configured);
    secrets?.remove();
    throw new Error(
      `Could not write the database ID to ${options.configPath}. Set database_id = "${databaseId}" in the [[d1_databases]] entry for "${options.database}", then deploy again.`,
    );
  }
  context.log(`Wrote database_id to ${options.configPath}.`);

  return {
    secretsFile: secrets?.path ?? null,
    // Back to the placeholder, keeping an account_id chosen above.
    restore: () => writeFileSync(context.absoluteConfigPath, configured),
    cleanup: () => secrets?.remove(),
  };
}
