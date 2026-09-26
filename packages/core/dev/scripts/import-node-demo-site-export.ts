import { serve, type ServerType } from "@hono/node-server";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, stat } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CLI_API_TOKEN_ENV_VAR } from "../../bin/lib/cli-api-token.js";
import { createApp } from "../../src/app.js";
import {
  createNodeBindings,
  createNodeRequestHandler,
  migrate,
} from "../../src/node/request-handler.js";
import type { Bindings } from "../../src/types/bindings.js";
import {
  applyNodeDevCredentials,
  loadNodeDevEnv,
  resolveNodeDevTarget,
  setUpNodeDevSite,
} from "../node-dev-site.js";
import { describeScriptEnvPath } from "../script-env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const coreDir = resolve(__dirname, "../..");
const repoRoot = resolve(coreDir, "../..");
const canonicalDir = resolve(
  repoRoot,
  "sites/demo-source/canonical/site-export",
);
const loopbackHost = "127.0.0.1";

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
      "--url",
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

  const devEnv = loadNodeDevEnv();
  const target = resolveNodeDevTarget(devEnv.env, {
    task: "db-node-load-demo",
    localStorage: true,
  });

  await assertCanonicalSiteExport();

  if (values.check) {
    console.log("Node site-export import prerequisites look good.");
    console.log(`  Env file:       ${describeScriptEnvPath(devEnv.envPath)}`);
    console.log(`  Canonical dir:  ${canonicalDir}`);
    console.log(`  Database:       ${target.database}`);
    console.log(`  Dialect:        ${target.dialect}`);
    console.log(
      `  Local storage:  ${target.localStoragePath ?? "(managed by runtime defaults)"}`,
    );
    process.exit(0);
  }

  const credentials = applyNodeDevCredentials(devEnv, {
    cliPassword: positionals[0],
    write: true,
  });

  console.log("Running local Node migrations...");
  await migrate(devEnv.env);

  // Before setup, so a refused run leaves the database as migrations left it.
  await assertEmptyImportTarget(devEnv.env);

  if (target.localStoragePath) {
    await mkdir(target.localStoragePath, { recursive: true });
  }

  const setup = await setUpNodeDevSite(devEnv.env, credentials);

  const server = await startLoopbackServer(devEnv.env);
  try {
    console.log(
      `Importing canonical demo site-export through ${server.url}...`,
    );
    await runSiteImport(server.url, credentials.devApiToken);
  } finally {
    await server.close();
  }

  console.log(
    "Canonical demo site-export imported into the local Node runtime.",
  );
  console.log(`  Env file:      ${describeScriptEnvPath(devEnv.envPath)}`);
  console.log(`  Database:      ${target.database}`);
  console.log(`  Canonical dir: ${canonicalDir}`);
  console.log(`  Setup:         ${setup.outcome}`);
}
