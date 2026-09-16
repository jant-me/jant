import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { getCliSiteResolutionMode } from "../../bin/lib/site-selection.js";
import { resolveDatabaseDialect } from "../../src/db/dialect.js";
import {
  applyNodeRuntimeEnvDefaults,
  createNodeBindings,
  migrate,
  resolveDatabasePath,
} from "../../src/node/request-handler.js";
import { setUpNodeInstance } from "../../src/runtime/node.js";
import type { Bindings } from "../../src/types/bindings.js";
import {
  DEFAULT_DEV_PASSWORD,
  DEFAULT_SITE_LANGUAGE,
  DEFAULT_SITE_NAME,
  DEV_EMAIL,
} from "./dev-auth-db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const coreDir = resolve(__dirname, "../..");
const repoRoot = resolve(coreDir, "../..");
const envPath = resolve(coreDir, ".env.node");
const canonicalDir = resolve(
  repoRoot,
  "sites/demo-source/canonical/site-export",
);
const defaultDataDir = resolve(coreDir, "data");

function readEnvLines() {
  if (!existsSync(envPath)) {
    return [];
  }

  return readFileSync(envPath, "utf8").split(/\r?\n/);
}

function parseEnvFile(lines: string[]) {
  const values: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!key) {
      continue;
    }

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

function upsertEnvValue(lines: string[], key: string, value: string) {
  const prefix = `${key}=`;
  const nextLines = [];
  let updated = false;

  for (const line of lines) {
    if (line.startsWith(prefix)) {
      nextLines.push(`${key}=${value}`);
      updated = true;
      continue;
    }

    nextLines.push(line);
  }

  if (!updated) {
    if (nextLines.length > 0 && nextLines.at(-1) !== "") {
      nextLines.push("");
    }
    nextLines.push(`${key}=${value}`);
  }

  return nextLines;
}

function resolvePassword(cliPassword: string | undefined) {
  if (cliPassword) {
    return cliPassword;
  }

  const fromProcess = process.env.DEMO_PASSWORD?.trim();
  if (fromProcess) {
    return fromProcess;
  }

  const fromFile = parseEnvFile(readEnvLines()).DEMO_PASSWORD?.trim();
  if (fromFile) {
    return fromFile;
  }

  return DEFAULT_DEV_PASSWORD;
}

function buildRuntimeEnv(password: string, checkOnly: boolean) {
  let lines = readEnvLines();
  const envFileValues = parseEnvFile(lines);
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
    lines = upsertEnvValue(lines, "AUTH_SECRET", authSecret);
    lines = upsertEnvValue(lines, "DEV_API_TOKEN", devApiToken);
    lines = upsertEnvValue(lines, "DEMO_EMAIL", DEV_EMAIL);
    lines = upsertEnvValue(lines, "DEMO_PASSWORD", password);
    writeFileSync(
      envPath,
      `${lines.join("\n").replace(/\n+$/u, "").trimEnd()}\n`,
      "utf8",
    );
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
  const configPath = resolve(canonicalDir, "config.toml");
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
      return result.results;
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
    "Usage: pnpm exec tsx dev/scripts/import-node-demo-site-export.ts [password] [--check]",
    "",
    "Bootstrap a local single-site Node runtime and import sites/demo-source/canonical/site-export.",
    "",
    "This task is intended for local PostgreSQL or SQLite development databases with local filesystem storage.",
  ].join("\n");
}

function runCliSiteImport(env: Bindings) {
  console.log("Building @jant/core for local CLI import...");
  execFileSync("pnpm", ["--filter", "@jant/core", "build"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
    },
    stdio: "inherit",
  });

  console.log(
    "Importing canonical demo site-export into the local Node runtime...",
  );
  execFileSync(
    process.execPath,
    [resolve(coreDir, "bin/jant.js"), "site", "import", "--path", canonicalDir],
    {
      cwd: coreDir,
      env: {
        ...process.env,
        ...env,
      },
      stdio: "inherit",
    },
  );
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
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

  const password = resolvePassword(positionals[0]);
  const checkOnly = values.check ?? false;
  const { env } = buildRuntimeEnv(password, checkOnly);
  const config = assertLocalImportConfig(env);

  await assertCanonicalSiteExport();

  if (checkOnly) {
    console.log("Node site-export import prerequisites look good.");
    console.log(`  Env file:       ${envPath}`);
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

  await assertEmptyImportTarget(env);
  runCliSiteImport(env);

  console.log(
    "Canonical demo site-export imported into the local Node runtime.",
  );
  console.log(`  Env file:      ${envPath}`);
  console.log(`  Database:      ${config.target}`);
  console.log(`  Canonical dir: ${canonicalDir}`);
  console.log(`  Setup:         ${setup.outcome}`);
}

await main();
