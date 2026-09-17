import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  assertSnapshotMeta,
  buildMediaProviderSql,
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
import { getConfiguredStorageDriver } from "../../src/lib/env.js";
import { createNodeBindings, migrate } from "../../src/node/request-handler.js";
import { createNodeCliRuntime } from "../../src/runtime/node.js";
import type { Bindings } from "../../src/types/bindings.js";
import {
  applyNodeDevCredentials,
  loadNodeDevEnv,
  printNodeDevSignIn,
  removeNodeDevSqlite,
  resolveNodeDevTarget,
  setUpNodeDevSite,
} from "../node-dev-site.js";
import { describeScriptEnvPath } from "../script-env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const coreDir = resolve(__dirname, "../..");
const repoRoot = resolve(coreDir, "../..");
const canonicalDir = resolve(repoRoot, "sites/demo-source/canonical/snapshot");

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
    await opened.execute(
      [
        buildReplaceSql(targetSite.id),
        dbSql,
        buildMediaProviderSql(
          targetSite.id,
          getConfiguredStorageDriver(opened.bindings),
        ),
      ].join("\n"),
    );

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

  const devEnv = loadNodeDevEnv();
  const target = resolveNodeDevTarget(devEnv.env, {
    task: "db-node-rebuild-demo",
    sqliteOnly: true,
    localStorage: true,
  });
  await assertCanonicalSnapshot();

  if (values.check) {
    console.log("Node reset prerequisites look good.");
    console.log(`  Env file:   ${describeScriptEnvPath(devEnv.envPath)}`);
    console.log(`  Snapshot:   ${canonicalDir}`);
    console.log(`  SQLite DB:  ${target.database}`);
    if (target.localStoragePath) {
      console.log(`  Media dir:  ${target.localStoragePath}`);
    }
    return;
  }

  const credentials = applyNodeDevCredentials(devEnv, {
    cliPassword: positionals[0],
    write: true,
  });

  console.log("Resetting Node development database...");
  await removeNodeDevSqlite(target);

  console.log("Running Node migrations...");
  await migrate(devEnv.env);

  console.log("Setting up the local development site...");
  await setUpNodeDevSite(devEnv.env, credentials);

  console.log("Loading canonical demo snapshot...");
  await importCanonicalSnapshot(devEnv.env);

  console.log("");
  console.log("Local Node auth is ready.");
  console.log(`  File:      ${describeScriptEnvPath(devEnv.envPath)}`);
  console.log(`  Email:     ${credentials.email}`);
  console.log(`  Password:  ${credentials.password}`);
  console.log(`  Dev token: ${credentials.devApiToken}`);
  console.log(`  SQLite DB: ${target.database}`);
  if (target.localStoragePath) {
    console.log(`  Media dir: ${target.localStoragePath}`);
  }
  console.log("");
  printNodeDevSignIn(devEnv.env, credentials);
}
