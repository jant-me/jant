import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { unzipSync } from "fflate";
import { executeD1, queryD1 } from "../../../lib/d1-query.js";
import { loadNodeRuntime } from "../../../lib/load-node-runtime.js";
import { openNodeDatabase } from "../../../lib/node-database.js";
import { deleteR2Object, uploadR2Object } from "../../../lib/r2-query.js";
import {
  assertSnapshotDialectMatches,
  assertSnapshotMeta,
  buildReplaceSql,
  buildSnapshotStorageQuery,
  collectSnapshotObjects,
  enumerateSnapshotObjectFiles,
  extractMediaStorageKeysFromDumpSql,
  getSnapshotBootstrapSite,
  normalizeD1Sql,
  remapSnapshotObjectKey,
  rewriteLegacySnapshotSql,
  rewriteSnapshotSiteIdentifiers,
  upgradeSnapshotSql,
  validateSnapshotTargetSite,
} from "../../../lib/site-snapshot.js";
import {
  getCliSiteResolutionMode,
  resolveCliSite,
} from "../../../lib/site-selection.js";
import { bootstrapCliRuntime } from "../../../lib/runtime-target.js";

function isZipPath(filePath) {
  return filePath.toLowerCase().endsWith(".zip");
}

function createWranglerOptions(values) {
  return {
    bucket: values.bucket,
    bucketBinding: values["bucket-binding"],
    configPath: values.config,
    database: values.database,
    env: values.env,
    persistTo: values["persist-to"],
  };
}

async function createNodeImportContext() {
  const nodeDatabase = await openNodeDatabase(process.env);
  // Only need the storage driver — `createNodeCliRuntime` would also resolve
  // the current site, which (a) is redundant with the bin-level resolveCliSite
  // call below and (b) prints a generic "/setup first" error when the
  // snapshot's own error path is more informative.
  const { createStorageDriver } = await loadNodeRuntime();
  const storage = createStorageDriver(nodeDatabase.bindings);

  return {
    dialect: nodeDatabase.database.dialect,
    async close() {
      await nodeDatabase.close();
    },
    async query(sql) {
      return nodeDatabase.query(sql);
    },
    async execute(sql) {
      await nodeDatabase.executeAtomically(sql);
    },
    async uploadObject(key, filePath, contentType) {
      if (!storage) {
        throw new Error("Snapshot import requires configured storage.");
      }

      const bytes = new Uint8Array(await readFile(filePath));
      await storage.put(key, bytes, {
        contentType: contentType || undefined,
      });
    },
    async deleteObject(key) {
      if (!storage) {
        return;
      }
      await storage.delete(key);
    },
  };
}

function createD1ImportContext(runtime, values) {
  const wranglerOptions = createWranglerOptions(values);

  return {
    dialect: "sqlite",
    async close() {},
    async query(sql) {
      return queryD1(sql, runtime, wranglerOptions);
    },
    async execute(sql) {
      const d1Sql = normalizeD1Sql(sql);
      if (!d1Sql) {
        return;
      }
      executeD1(d1Sql, runtime, {
        ...wranglerOptions,
        quiet: true,
      });
    },
    async uploadObject(key, filePath, contentType) {
      uploadR2Object(key, filePath, runtime, {
        ...wranglerOptions,
        contentType: contentType || undefined,
      });
    },
    async deleteObject(key) {
      deleteR2Object(key, runtime, wranglerOptions);
    },
  };
}

async function materializeSnapshotInput(inputPath) {
  if (!existsSync(inputPath)) {
    throw new Error(`Snapshot path not found: ${inputPath}`);
  }

  if (!isZipPath(inputPath)) {
    const fileStat = await stat(inputPath);
    if (!fileStat.isDirectory()) {
      throw new Error(
        `Snapshot path must be a directory or .zip: ${inputPath}`,
      );
    }
    return {
      cleanup: async () => {},
      rootDir: inputPath,
    };
  }

  const outputDir = await mkdtemp(join(tmpdir(), "jant-site-snapshot-import-"));
  const bytes = new Uint8Array(await readFile(inputPath));
  const files = unzipSync(bytes);

  for (const [relativePath, data] of Object.entries(files)) {
    const absolutePath = join(outputDir, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, data);
  }

  return {
    cleanup: async () => {
      await rm(outputDir, { recursive: true, force: true });
    },
    rootDir: outputDir,
  };
}

async function readSnapshotJson(rootDir, filename) {
  const absolutePath = join(rootDir, filename);
  return JSON.parse(await readFile(absolutePath, "utf-8"));
}

export async function run(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      bucket: { type: "string" },
      "bucket-binding": { type: "string", default: "R2" },
      config: { type: "string" },
      database: { type: "string", default: "DB" },
      env: { type: "string" },
      host: { type: "string" },
      help: { type: "boolean", short: "h" },
      local: { type: "boolean", default: false },
      node: { type: "boolean", default: false },
      path: { type: "string", default: "." },
      "path-prefix": { type: "string" },
      "persist-to": { type: "string" },
      remote: { type: "boolean", default: false },
      replace: { type: "boolean", default: false },
      "remap-site": { type: "boolean", default: false },
      "allow-missing-objects": { type: "boolean", default: false },
      site: { type: "string" },
      url: { type: "string" },
    },
  });

  if (values.help) {
    console.log(
      "Usage: jant site snapshot import --path <dir|zip> --replace [--local | --remote | --node]",
    );
    console.log("");
    console.log(
      "Import a Jant content snapshot and restore IDs, storage keys, and object files.",
    );
    console.log("");
    console.log("Options:");
    console.log(
      "  --path                  Snapshot directory or .zip file (default: .)",
    );
    console.log(
      "  --replace               Replace the current content scope before importing",
    );
    console.log("  --site                  Target site id");
    console.log("  --host                  Target site host");
    console.log("  --url                   Target site URL");
    console.log("  --path-prefix           Path prefix used with --host");
    console.log(
      "  --local                 Force local D1 instead of DATABASE_URL",
    );
    console.log("  --remote                Import into remote D1");
    console.log(
      "  --node                  Force Node runtime even if DATABASE_URL is unset",
    );
    console.log(
      "  --config                Wrangler config file (default: wrangler.toml)",
    );
    console.log("  --env                   Wrangler environment name");
    console.log("  --database              D1 binding name (default: DB)");
    console.log(
      "  --bucket                Override the R2 bucket name used for object import",
    );
    console.log(
      "  --bucket-binding        Wrangler R2 binding to resolve (default: R2)",
    );
    console.log(
      "  --persist-to            Local D1/R2 state directory override",
    );
    console.log(
      "  --remap-site            Rewrite snapshot site_id and storage keys to the resolved target site",
    );
    console.log(
      "  --allow-missing-objects Continue importing even when objects/ is missing files referenced by db.sql.",
    );
    console.log(
      "                          Use this when the target storage already has those keys (e.g. a snapshot",
    );
    console.log(
      "                          exported with --skip-objects between sites that share an R2 bucket).",
    );
    console.log(
      "                          Without this flag, import aborts before applying db.sql and prints the",
    );
    console.log("                          missing key list.");
    console.log("");
    console.log(
      "`.env.node` next to your project (or in packages/core/) is auto-loaded.",
    );
    console.log(
      "If DATABASE_URL or DATA_DIR is then set and no runtime flag is passed,",
    );
    console.log("this command uses the Node database runtime.");
    console.log("");
    console.log(
      "In single-site mode, snapshot imports automatically remap to the only initialized site.",
    );
    console.log("");
    console.log(
      "Snapshot import currently requires --replace. It preserves user/auth shell data outside the content scope.",
    );
    process.exit(0);
  }

  if (!values.replace) {
    throw new Error(
      "Snapshot import currently requires --replace to avoid partial merge semantics.",
    );
  }

  const { runtime } = bootstrapCliRuntime(values);
  const inputPath = resolve(process.cwd(), values.path);
  const materialized = await materializeSnapshotInput(inputPath);
  const context =
    runtime === "node"
      ? await createNodeImportContext()
      : createD1ImportContext(runtime, values);

  try {
    const meta = await readSnapshotJson(materialized.rootDir, "meta.json");
    assertSnapshotMeta(meta);
    assertSnapshotDialectMatches(meta, context.dialect);
    const explicitRemap = values["remap-site"] === true;
    const snapshotSite = getSnapshotBootstrapSite(meta);
    const resolutionMode = getCliSiteResolutionMode(process.env);

    const { site: targetSite } = await resolveCliSite(context, {
      env: process.env,
      createIfMissing: false,
      host: values.host,
      pathPrefix: values["path-prefix"],
      site: values.site,
      url: values.url,
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

    if (autoRemapSingleSite) {
      console.log(
        `single-site mode detected. Remapping snapshot site ${snapshotSite.id} to ${targetSite.id}.`,
      );
    }

    const sourceSiteId = shouldRemapSite ? (snapshotSite?.id ?? "") : "";
    const objectFiles = await enumerateSnapshotObjectFiles(
      materialized.rootDir,
    );
    const snapshotObjects = objectFiles.map((entry) => ({
      filePath: entry.filePath,
      contentType: entry.contentType,
      key: shouldRemapSite
        ? remapSnapshotObjectKey(entry.key, sourceSiteId, targetSite.id)
        : entry.key,
    }));
    const snapshotKeys = new Set(snapshotObjects.map((object) => object.key));

    const rawDbSql = await readFile(
      join(materialized.rootDir, "db.sql"),
      "utf-8",
    );
    const siteScopedDbSql = snapshotSite
      ? shouldRemapSite
        ? rewriteSnapshotSiteIdentifiers(
            rawDbSql,
            snapshotSite.id,
            targetSite.id,
          )
        : rawDbSql
      : rewriteLegacySnapshotSql(rawDbSql, targetSite.id);
    // Upgrade compatibility SQL before touching target rows or storage.
    // A malformed v1 post_collection reference therefore fails safely.
    const dbSql = upgradeSnapshotSql(siteScopedDbSql, meta.version);

    // Preflight: every storage_key/poster_key referenced by db.sql must have
    // a corresponding file in objects/, or we'll end up with broken media
    // unless the target storage already has it. Default to abort; let the
    // user override with --allow-missing-objects when they know the files
    // already live in the target bucket (typical --skip-objects flow).
    const sourceKeysInObjects = new Set(objectFiles.map((entry) => entry.key));
    const expectedSourceKeys = extractMediaStorageKeysFromDumpSql(
      rawDbSql,
      snapshotSite?.id ?? "",
    );
    const missingFromObjects = [...expectedSourceKeys]
      .filter((key) => !sourceKeysInObjects.has(key))
      .sort();

    if (missingFromObjects.length > 0) {
      const display = missingFromObjects.slice(0, 10);
      const remainder = missingFromObjects.length - display.length;
      console.warn(
        `\n${missingFromObjects.length} object(s) referenced by db.sql are missing from the snapshot's objects/:`,
      );
      for (const key of display) {
        console.warn(`  ${key}`);
      }
      if (remainder > 0) {
        console.warn(`  …and ${remainder} more`);
      }

      if (!values["allow-missing-objects"]) {
        throw new Error(
          "Snapshot is missing storage objects referenced by db.sql. " +
            "Pass --allow-missing-objects to import anyway (only safe when the target storage already has these keys).",
        );
      }

      console.warn(
        "Continuing with --allow-missing-objects; the target storage must already have these keys or media references will 404.\n",
      );
    }

    const currentObjectRows = await context.query(
      buildSnapshotStorageQuery(targetSite.id),
    );
    const currentKeys = new Set(
      collectSnapshotObjects(currentObjectRows).map((object) => object.key),
    );

    for (const object of snapshotObjects) {
      await context.uploadObject(
        object.key,
        object.filePath,
        object.contentType || "",
      );
    }

    await context.execute(`${buildReplaceSql(targetSite.id)}\n${dbSql}`);

    const keysToDelete = [...currentKeys].filter(
      (key) => !snapshotKeys.has(key),
    );
    for (const key of keysToDelete) {
      await context.deleteObject(key);
    }

    console.log(`Imported snapshot from ${values.path}`);
  } finally {
    await context.close();
    await materialized.cleanup();
  }
}
