import { serve, type ServerType } from "@hono/node-server";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdir, stat } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CLI_API_TOKEN_ENV_VAR } from "../../bin/lib/cli-api-token.js";
import { getCliSiteResolutionMode } from "../../bin/lib/site-selection.js";
import { createApp } from "../../src/app.js";
import { resolveDatabaseDialect } from "../../src/db/dialect.js";
import {
  applyNodeRuntimeEnvDefaults,
  createNodeBindings,
  createNodeRequestHandler,
  migrate,
  resolveDatabasePath,
} from "../../src/node/request-handler.js";
import { setUpNodeInstance } from "../../src/runtime/node.js";
import type { Bindings } from "../../src/types/bindings.js";
import {
  describeScriptEnvPath,
  readScriptEnvFile,
  resolveScriptEnvPath,
  writeScriptEnvValues,
} from "../script-env.js";
import {
  DEFAULT_DEV_PASSWORD,
  DEFAULT_SITE_LANGUAGE,
  DEFAULT_SITE_NAME,
  DEV_EMAIL,
} from "./dev-auth-db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const coreDir = resolve(__dirname, "../..");
const repoRoot = resolve(coreDir, "../..");
const canonicalDir = resolve(
  repoRoot,
  "sites/demo-source/canonical/site-export",
);
const defaultDataDir = resolve(coreDir, "data");
const loopbackHost = "127.0.0.1";

function resolvePassword(
  cliPassword: string | undefined,
  envFileValues: Record<string, string>,
) {
  if (cliPassword) {
    return cliPassword;
  }

  const fromProcess = process.env.DEMO_PASSWORD?.trim();
  if (fromProcess) {
    return fromProcess;
  }

  const fromFile = envFileValues.DEMO_PASSWORD?.trim();
  if (fromFile) {
    return fromFile;
  }

  return DEFAULT_DEV_PASSWORD;
}

function buildRuntimeEnv(
  envPath: string | null,
  envFileValues: Record<string, string>,
  password: string,
  checkOnly: boolean,
) {
  const merged = {
    ...envFileValues,
    ...process.env,
  };

  const authSecret =
    merged.AUTH_SECRET || randomBytes(32).toString("base64url");
  const devApiToken =
    merged.DEV_API_TOKEN || `jnt_dev_${randomBytes(16).toString("hex")}`;

  const nextEnv = {
    ...merged,
    AUTH_SECRET: authSecret,
    DEMO_EMAIL: DEV_EMAIL,
    DEMO_PASSWORD: password,
    DEV_API_TOKEN: devApiToken,
  } as Bindings;

  if (!checkOnly) {
    writeScriptEnvValues(envPath, {
      AUTH_SECRET: authSecret,
      DEV_API_TOKEN: devApiToken,
      DEMO_EMAIL: DEV_EMAIL,
      DEMO_PASSWORD: password,
    });
  }

  applyNodeRuntimeEnvDefaults(nextEnv, {
    cwd: coreDir,
    defaultDataDir,
  });

  return {
    devApiToken,
    env: nextEnv,
  };
}

function resolveLocalPath(pathValue: unknown, cwd: string) {
  if (!pathValue) {
    return null;
  }

  const normalized = String(pathValue).trim();
  if (!normalized) {
    return null;
  }

  return isAbsolute(normalized) ? normalized : resolve(cwd, normalized);
}

function describeDatabaseTarget(env: Bindings) {
  const databaseUrl = String(env.DATABASE_URL ?? "").trim();
  const dialect = resolveDatabaseDialect(databaseUrl);

  if (dialect === "sqlite") {
    return {
      dialect,
      target: resolveDatabasePath(databaseUrl, coreDir),
    };
  }

  try {
    const parsed = new URL(databaseUrl);
    if (parsed.password) {
      parsed.password = "*****";
    }
    return {
      dialect,
      target: parsed.toString(),
    };
  } catch {
    return {
      dialect,
      target: databaseUrl,
    };
  }
}

function assertLocalImportConfig(env: Bindings) {
  if (getCliSiteResolutionMode(env) !== "single-site") {
    throw new Error(
      "db-node-load-demo only supports single-site local development. Set SITE_RESOLUTION_MODE=single-site for this workflow.",
    );
  }

  const databaseUrl = String(env.DATABASE_URL ?? "").trim();
  const dialect = resolveDatabaseDialect(databaseUrl);
  if (dialect === "sqlite") {
    const databasePath = resolveDatabasePath(databaseUrl, coreDir);
    if (databasePath === ":memory:") {
      throw new Error(
        "db-node-load-demo cannot target an in-memory SQLite database.",
      );
    }
  }

  const storageDriver = String(env.STORAGE_DRIVER ?? "").trim();
  if (storageDriver && storageDriver !== "local") {
    throw new Error(
      "db-node-load-demo only supports STORAGE_DRIVER=local or an unset storage driver.",
    );
  }

  return {
    ...describeDatabaseTarget(env),
    localStoragePath: resolveLocalPath(env.LOCAL_STORAGE_PATH, coreDir),
  };
}

async function assertCanonicalSiteExport() {
  const configPath = resolve(canonicalDir, "hugo.toml");
  const configStat = await stat(configPath).catch(() => null);
  if (!configStat?.isFile()) {
    throw new Error(
      [
        "Missing canonical demo site export at sites/demo-source/canonical/site-export.",
        "Run `mise run demo-source-export-canonical-site-export` first.",
      ].join("\n"),
    );
  }

  const contentStat = await stat(resolve(canonicalDir, "content")).catch(
    () => null,
  );
  if (!contentStat?.isDirectory()) {
    throw new Error(
      "Canonical demo site-export is missing its content/ directory.",
    );
  }
}

async function openNodeDatabase(env: Bindings) {
  const { bindings, close } = await createNodeBindings(env);
  const nodeDatabase = bindings.NODE_DATABASE;
  if (!nodeDatabase) {
    await close();
    throw new Error("Node database binding is missing.");
  }

  return {
    bindings,
    close,
    async query<T extends Record<string, unknown>>(sql: string) {
      const result = await nodeDatabase.rawQuery.prepare(sql).all<T>();
      return result.results ?? [];
    },
  };
}

function normalizeCount(value: unknown) {
  const count = Number(value);
  return Number.isFinite(count) ? count : 0;
}

async function assertEmptyImportTarget(env: Bindings) {
  const opened = await openNodeDatabase(env);

  try {
    const [counts] = await opened.query<{
      collectionCount: unknown;
      collectionDirectoryCount: unknown;
      mediaCount: unknown;
      pathCount: unknown;
      postCount: unknown;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM post) AS postCount,
        (SELECT COUNT(*) FROM collection) AS collectionCount,
        (SELECT COUNT(*) FROM media) AS mediaCount,
        (SELECT COUNT(*) FROM path_registry) AS pathCount,
        (SELECT COUNT(*) FROM collection_directory_item) AS collectionDirectoryCount
    `);

    const details = {
      posts: normalizeCount(counts?.postCount),
      collections: normalizeCount(counts?.collectionCount),
      media: normalizeCount(counts?.mediaCount),
      paths: normalizeCount(counts?.pathCount),
      collectionDirectoryItems: normalizeCount(
        counts?.collectionDirectoryCount,
      ),
    };

    const hasContent = Object.values(details).some((count) => count > 0);
    if (!hasContent) {
      return details;
    }

    throw new Error(
      [
        "Local import target is not empty.",
        `Counts: posts=${details.posts}, collections=${details.collections}, media=${details.media}, paths=${details.paths}, collection_directory_items=${details.collectionDirectoryItems}`,
        "Use a fresh dedicated local database for this workflow. This task will not clear a PostgreSQL database automatically.",
      ].join("\n"),
    );
  } finally {
    await opened.close();
  }
}

function buildHelpText() {
  return [
    "Usage: node dev/run-script.mjs dev/scripts/import-node-demo-site-export.ts [password] [--check]",
    "",
    "Bootstrap a local single-site Node runtime and import sites/demo-source/canonical/site-export.",
    "",
    "The import runs `jant site import` against a temporary server on 127.0.0.1, the same API path a remote site uses.",
    "",
    "This task is intended for local PostgreSQL or SQLite development databases with local filesystem storage.",
  ].join("\n");
}

/**
 * Serve the app on a free loopback port for the length of the import.
 *
 * `jant site import` is an API client, so the canonical export goes in through
 * the routes a remote site exposes. The server runs in this process, compiled
 * by the script runner, so nothing has to be built first: the import only
 * calls API routes, and no static assets are served.
 *
 * @param env - Runtime bindings for the local database and storage
 * @returns The server's base URL and a function that stops it
 */
async function startLoopbackServer(env: Bindings) {
  const handler = await createNodeRequestHandler({
    env,
    app: createApp(),
    assetRoot: null,
  });

  let server: ServerType;
  let port: number;
  try {
    ({ server, port } = await new Promise<{
      server: ServerType;
      port: number;
    }>((resolveListening, rejectListening) => {
      const listening = serve(
        { fetch: handler.fetch, hostname: loopbackHost, port: 0 },
        (info: AddressInfo) => {
          listening.off("error", rejectListening);
          resolveListening({ server: listening, port: info.port });
        },
      );
      listening.once("error", rejectListening);
    }));
  } catch (error) {
    await handler.close();
    throw error;
  }

  return {
    url: `http://${loopbackHost}:${port}`,
    async close() {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error?: Error) =>
          error ? rejectClose(error) : resolveClose(),
        );
      });
      await handler.close();
    },
  };
}

/**
 * Run `jant site import` for the canonical export against a local server.
 *
 * A child process, not an in-process call: the command exits the process on
 * failure, and this process has a server and a database to close. The token
 * goes through the environment so it stays out of the process list. The
 * server accepts `DEV_API_TOKEN` only from a loopback host.
 *
 * @param siteUrl - Base URL of the running local server
 * @param devApiToken - The `DEV_API_TOKEN` the server was started with
 */
async function runSiteImport(siteUrl: string, devApiToken: string) {
  const child = spawn(
    process.execPath,
    [
      resolve(coreDir, "bin/jant.js"),
      "site",
      "import",
      siteUrl,
      "--path",
      canonicalDir,
    ],
    {
      cwd: coreDir,
      env: { ...process.env, [CLI_API_TOKEN_ENV_VAR]: devApiToken },
      stdio: "inherit",
    },
  );

  const [code, signal] = (await once(child, "close")) as [
    number | null,
    NodeJS.Signals | null,
  ];
  if (code !== 0) {
    throw new Error(
      `jant site import failed (${signal ? `signal ${signal}` : `exit code ${code}`}).`,
    );
  }
}

export default async function main(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      check: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(buildHelpText());
    process.exit(0);
  }

  const envPath = resolveScriptEnvPath();
  const envFileValues = readScriptEnvFile(envPath);
  const password = resolvePassword(positionals[0], envFileValues);
  const checkOnly = values.check ?? false;
  const { devApiToken, env } = buildRuntimeEnv(
    envPath,
    envFileValues,
    password,
    checkOnly,
  );
  const config = assertLocalImportConfig(env);

  await assertCanonicalSiteExport();

  if (checkOnly) {
    console.log("Node site-export import prerequisites look good.");
    console.log(`  Env file:       ${describeScriptEnvPath(envPath)}`);
    console.log(`  Canonical dir:  ${canonicalDir}`);
    console.log(`  Database:       ${config.target}`);
    console.log(`  Dialect:        ${config.dialect}`);
    console.log(
      `  Local storage:  ${config.localStoragePath ?? "(managed by runtime defaults)"}`,
    );
    process.exit(0);
  }

  console.log("Running local Node migrations...");
  await migrate(env);

  // Before setup, so a refused run leaves the database as migrations left it.
  await assertEmptyImportTarget(env);

  if (config.localStoragePath) {
    await mkdir(config.localStoragePath, { recursive: true });
  }

  const opened = await openNodeDatabase(env);
  let setup;

  try {
    setup = await setUpNodeInstance(opened.bindings, {
      email: DEV_EMAIL,
      password,
      siteName: DEFAULT_SITE_NAME,
      siteLanguage: DEFAULT_SITE_LANGUAGE,
    });
  } finally {
    await opened.close();
  }

  const server = await startLoopbackServer(env);
  try {
    console.log(
      `Importing canonical demo site-export through ${server.url}...`,
    );
    await runSiteImport(server.url, devApiToken);
  } finally {
    await server.close();
  }

  console.log(
    "Canonical demo site-export imported into the local Node runtime.",
  );
  console.log(`  Env file:      ${describeScriptEnvPath(envPath)}`);
  console.log(`  Database:      ${config.target}`);
  console.log(`  Canonical dir: ${canonicalDir}`);
  console.log(`  Setup:         ${setup.outcome}`);
}
