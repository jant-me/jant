import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  assertSnapshotMeta,
  buildReplaceSql,
  buildSnapshotStorageQuery,
  collectSnapshotObjects,
  enumerateSnapshotObjectFiles,
  getSnapshotBootstrapSite,
  remapSnapshotObjectKey,
  rewriteLegacySnapshotSql,
  rewriteSnapshotSiteIdentifiers,
  validateSnapshotTargetSite,
} from "../../bin/lib/site-snapshot.js";
import {
  getCliSiteResolutionMode,
  resolveCliSite,
} from "../../bin/lib/site-selection.js";
import { resolveDatabaseDialect } from "../../src/db/dialect.js";
import {
  applyNodeRuntimeEnvDefaults,
  createNodeBindings,
  migrate,
  resolveDatabasePath,
} from "../../src/node/request-handler.js";
import {
  createNodeCliRuntime,
  setUpNodeInstance,
} from "../../src/runtime/node.js";
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
const canonicalDir = resolve(repoRoot, "sites/demo-source/canonical/snapshot");
const defaultDataDir = resolve(coreDir, "data");
const defaultPort = "3000";

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
    authSecret,
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

function assertLocalResetConfig(env: Bindings) {
  if (getCliSiteResolutionMode(env) !== "single-site") {
    throw new Error(
      "db-node-rebuild-demo only supports single-site local development. Set SITE_RESOLUTION_MODE=single-site for this workflow.",
    );
  }

  const dialect = resolveDatabaseDialect(env.DATABASE_URL ?? "");
  if (dialect !== "sqlite") {
    throw new Error(
      "db-node-rebuild-demo only supports Node SQLite development databases.",
    );
  }

  const databasePath = resolveDatabasePath(env.DATABASE_URL ?? "", coreDir);
  if (databasePath === ":memory:") {
    throw new Error(
      "db-node-rebuild-demo cannot target an in-memory SQLite database.",
    );
  }

  const storageDriver = String(env.STORAGE_DRIVER ?? "").trim();
  if (storageDriver && storageDriver !== "local") {
    throw new Error(
      "db-node-rebuild-demo only supports STORAGE_DRIVER=local or an unset storage driver.",
    );
  }

  return {
    databasePath,
    localStoragePath: resolveLocalPath(env.LOCAL_STORAGE_PATH, coreDir),
  };
}

async function assertCanonicalSnapshot() {
  if (!existsSync(resolve(canonicalDir, "meta.json"))) {
    throw new Error(
      [
        "Missing canonical demo snapshot at sites/demo-source/canonical/snapshot.",
        "Run `mise run demo-source-export-canonical` first.",
      ].join("\n"),
    );
  }

  const meta: unknown = JSON.parse(
    await readFile(resolve(canonicalDir, "meta.json"), "utf8"),
  );

  assertSnapshotMeta(meta);

  return { meta };
}

async function resetLocalFilesystem(paths: {
  databasePath: string;
  localStoragePath: string | null;
}) {
  await rm(paths.databasePath, { force: true });
  await rm(`${paths.databasePath}-shm`, { force: true });
  await rm(`${paths.databasePath}-wal`, { force: true });

  if (paths.localStoragePath) {
    await rm(paths.localStoragePath, { recursive: true, force: true });
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
    async execute(sql: string) {
      if (bindings.NODE_SQLITE) {
        bindings.NODE_SQLITE.exec(sql);
        return;
      }

      const database = nodeDatabase.db as {
        execute?: (statement: string) => Promise<unknown>;
        run?: (statement: string) => Promise<unknown>;
      };

      if (typeof database.execute === "function") {
        await database.execute(sql);
        return;
      }

      if (typeof database.run === "function") {
        await database.run(sql);
        return;
      }

      throw new Error("Node database binding does not support raw execution.");
    },
    async query<T extends Record<string, unknown>>(sql: string) {
      const result = await nodeDatabase.rawQuery.prepare(sql).all<T>();
      return result.results ?? [];
    },
  };
}

async function importCanonicalSnapshot(bindings: Bindings) {
  const opened = await openNodeDatabase(bindings);

  try {
    const runtime = await createNodeCliRuntime(opened.bindings);
    if (!runtime.storage) {
      throw new Error("Snapshot import requires configured local storage.");
    }

    const meta: unknown = JSON.parse(
      await readFile(resolve(canonicalDir, "meta.json"), "utf8"),
    );

    assertSnapshotMeta(meta);

    const explicitRemap = true;
    const snapshotSite = getSnapshotBootstrapSite(meta);
    const resolutionMode = getCliSiteResolutionMode(opened.bindings);
    const { site: targetSite } = await resolveCliSite(opened, {
      createIfMissing: false,
      env: opened.bindings,
    });

    const autoRemapSingleSite =
      !explicitRemap &&
      resolutionMode === "single-site" &&
      !!snapshotSite &&
      snapshotSite.id !== targetSite.id;
    const shouldRemapSite = explicitRemap || autoRemapSingleSite;

    if (shouldRemapSite) {
      if (!snapshotSite) {
        throw new Error(
          "--remap-site requires a snapshot with embedded site metadata.",
        );
      }
    } else {
      validateSnapshotTargetSite(meta, targetSite);
    }

    const sourceSiteId = shouldRemapSite ? (snapshotSite?.id ?? "") : "";
    const objectFiles = await enumerateSnapshotObjectFiles(canonicalDir);
    const snapshotObjects = objectFiles.map((entry) => ({
      filePath: entry.filePath,
      contentType: entry.contentType,
      key: shouldRemapSite
        ? remapSnapshotObjectKey(entry.key, sourceSiteId, targetSite.id)
        : entry.key,
    }));
    const snapshotKeys = new Set(snapshotObjects.map((object) => object.key));

    const currentObjectRows = await opened.query(
      buildSnapshotStorageQuery(targetSite.id),
    );
    const currentKeys = new Set(
      collectSnapshotObjects(currentObjectRows).map((object) => object.key),
    );

    for (const object of snapshotObjects) {
      const bytes = new Uint8Array(await readFile(object.filePath));
      await runtime.storage.put(object.key, bytes, {
        contentType: object.contentType || undefined,
      });
    }

    const rawDbSql = await readFile(resolve(canonicalDir, "db.sql"), "utf8");
    const dbSql = snapshotSite
      ? shouldRemapSite
        ? rewriteSnapshotSiteIdentifiers(
            rawDbSql,
            snapshotSite.id,
            targetSite.id,
          )
        : rawDbSql
      : rewriteLegacySnapshotSql(rawDbSql, targetSite.id);
    await opened.execute(`${buildReplaceSql(targetSite.id)}\n${dbSql}`);

    const keysToDelete = [...currentKeys].filter(
      (key) => !snapshotKeys.has(key),
    );
    for (const key of keysToDelete) {
      await runtime.storage.delete(key);
    }
  } finally {
    await opened.close();
  }
}

function printHelp() {
  console.log(
    "Usage: node dev/run-script.mjs dev/scripts/reset-node-dev.ts [password] [--check]",
  );
  console.log("");
  console.log(
    "Reset the local Node SQLite development database, bootstrap local auth, and load the canonical demo snapshot.",
  );
  console.log("");
  console.log("This workflow only supports single-site Node development with");
  console.log("SQLite and local filesystem storage.");
}

export default async function main(args: string[]) {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      check: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    printHelp();
    return;
  }

  const password = resolvePassword(positionals[0]);
  const checkOnly = values.check;
  const { authSecret, devApiToken, env } = buildRuntimeEnv(password, checkOnly);
  const paths = assertLocalResetConfig(env);
  await assertCanonicalSnapshot();

  if (checkOnly) {
    console.log("Node reset prerequisites look good.");
    console.log(`  Env file:   ${envPath}`);
    console.log(`  Snapshot:   ${canonicalDir}`);
    console.log(`  SQLite DB:  ${paths.databasePath}`);
    if (paths.localStoragePath) {
      console.log(`  Media dir:  ${paths.localStoragePath}`);
    }
    console.log(`  Auth secret present: ${authSecret ? "yes" : "no"}`);
    console.log(`  Dev token present:   ${devApiToken ? "yes" : "no"}`);
    return;
  }

  console.log("Resetting Node development database...");
  await resetLocalFilesystem(paths);

  console.log("Running Node migrations...");
  await migrate(env);

  const opened = await openNodeDatabase(env);
  try {
    console.log("Setting up the local development site...");
    await setUpNodeInstance(opened.bindings, {
      email: DEV_EMAIL,
      password,
      siteName: DEFAULT_SITE_NAME,
      siteLanguage: DEFAULT_SITE_LANGUAGE,
    });
  } finally {
    await opened.close();
  }

  console.log("Loading canonical demo snapshot...");
  await importCanonicalSnapshot(env);

  console.log("");
  console.log("Local Node auth is ready.");
  console.log(`  File:      ${envPath}`);
  console.log(`  Email:     ${DEV_EMAIL}`);
  console.log(`  Password:  ${password}`);
  console.log(`  Dev token: ${devApiToken}`);
  console.log(`  SQLite DB: ${paths.databasePath}`);
  if (paths.localStoragePath) {
    console.log(`  Media dir: ${paths.localStoragePath}`);
  }
  console.log("");
  console.log("Browser sign-in:");
  console.log(`  http://localhost:${env.PORT || defaultPort}/signin`);
  console.log("");
  console.log("Auto-login:");
  console.log(
    `  http://localhost:${env.PORT || defaultPort}/__dev/login?token=${devApiToken}&redirect=/settings`,
  );
}
