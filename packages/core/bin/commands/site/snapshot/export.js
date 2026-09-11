import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { zipSync } from "fflate";
import { queryD1 } from "../../../lib/d1-query.js";
import { loadNodeRuntime } from "../../../lib/load-node-runtime.js";
import { openNodeDatabase } from "../../../lib/node-database.js";
import {
  downloadR2Object,
  downloadR2ObjectFromPublicUrl,
} from "../../../lib/r2-query.js";
import {
  buildSnapshotMeta,
  buildSnapshotStorageQuery,
  collectSnapshotObjects,
  getSnapshotSelectSql,
  SNAPSHOT_TABLES,
  snapshotObjectPath,
} from "../../../lib/site-snapshot.js";
import { resolveCliSite } from "../../../lib/site-selection.js";
import { dumpDatabaseToSql } from "../../../lib/sql-export.js";
import {
  bootstrapCliRuntime,
  getCliRuntimeLabel,
} from "../../../lib/runtime-target.js";
import { resolveWranglerVarString } from "../../../lib/wrangler-config.js";

function isZipPath(filePath) {
  return filePath.toLowerCase().endsWith(".zip");
}

async function readStorageBody(body) {
  const reader = body.getReader();
  const chunks = [];
  let totalLength = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.length;
  }

  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  return bytes;
}

async function readDirectoryEntries(rootDir) {
  const entries = {};

  async function walk(dir) {
    const items = await readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = join(dir, item.name);
      if (item.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      const relativePath = relative(rootDir, fullPath).replace(/\\/g, "/");
      entries[relativePath] = new Uint8Array(await readFile(fullPath));
    }
  }

  await walk(rootDir);
  return entries;
}

async function assertWritableOutput(outputPath, force) {
  if (!existsSync(outputPath)) {
    return;
  }

  if (!force) {
    throw new Error(
      `Output already exists: ${outputPath}. Pass --force to overwrite it.`,
    );
  }

  await rm(outputPath, { force: true, recursive: true });
}

async function createNodeExportContext() {
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
    async downloadObject(key, filePath) {
      if (!storage) {
        throw new Error("Snapshot export requires configured storage.");
      }

      const object = await storage.get(key);
      if (!object?.body) {
        throw new Error(`Storage object not found: ${key}`);
      }

      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, await readStorageBody(object.body));
    },
  };
}

function createD1ExportContext(runtime, values) {
  const wranglerOptions = {
    bucket: values.bucket,
    bucketBinding: values["bucket-binding"],
    configPath: values.config,
    database: values.database,
    env: values.env,
    persistTo: values["persist-to"],
  };
  const publicUrl = resolveWranglerVarString({
    configPath: values.config,
    env: values.env,
    key: "R2_PUBLIC_URL",
  });

  return {
    dialect: "sqlite",
    async close() {},
    async query(sql) {
      return queryD1(sql, runtime, wranglerOptions);
    },
    async downloadObject(key, filePath) {
      await mkdir(dirname(filePath), { recursive: true });
      if (publicUrl) {
        try {
          await downloadR2ObjectFromPublicUrl(publicUrl, key, filePath);
          return;
        } catch {
          console.warn(
            `Public object download failed for ${key}. Falling back to Wrangler R2 access.`,
          );
        }
      }

      downloadR2Object(key, filePath, runtime, wranglerOptions);
    },
  };
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
      force: { type: "boolean", default: false },
      host: { type: "string" },
      help: { type: "boolean", short: "h" },
      local: { type: "boolean", default: false },
      node: { type: "boolean", default: false },
      output: {
        type: "string",
        short: "o",
        default: "jant-site-snapshot",
      },
      "path-prefix": { type: "string" },
      "persist-to": { type: "string" },
      remote: { type: "boolean", default: false },
      site: { type: "string" },
      "skip-objects": { type: "boolean", default: false },
      url: { type: "string" },
    },
  });

  if (values.help) {
    console.log(
      "Usage: jant site snapshot export [--local | --remote | --node] [--output <dir|zip>]",
    );
    console.log("");
    console.log(
      "Export a Jant content snapshot that preserves IDs, storage keys, and object files.",
    );
    console.log("");
    console.log("Options:");
    console.log(
      "  --local                 Force local D1 instead of DATABASE_URL",
    );
    console.log("  --remote                Export from remote D1");
    console.log(
      "  --node                  Force Node runtime even if DATABASE_URL is unset",
    );
    console.log(
      "  --output, -o           Output directory or .zip file (default: jant-site-snapshot)",
    );
    console.log("  --site                  Target site key or id");
    console.log("  --host                  Target site host");
    console.log("  --url                   Target site URL");
    console.log("  --path-prefix           Path prefix used with --host");
    console.log("  --force                 Overwrite an existing output path");
    console.log(
      "  --config                Wrangler config file (default: wrangler.toml)",
    );
    console.log("  --env                   Wrangler environment name");
    console.log("  --database              D1 binding name (default: DB)");
    console.log(
      "  --bucket                Override the R2 bucket name used for object export",
    );
    console.log(
      "  --bucket-binding        Wrangler R2 binding to resolve (default: R2)",
    );
    console.log(
      "  --persist-to            Local D1/R2 state directory override",
    );
    console.log(
      "  --skip-objects          Skip downloading storage objects. The archive only contains meta.json and db.sql.",
    );
    console.log(
      "                          Only safe when the import target's storage already has the same keys",
    );
    console.log(
      "                          (e.g. moving between Workers that share an R2 bucket). Otherwise the",
    );
    console.log(
      "                          imported site will be missing media — pair with `--allow-missing-objects`",
    );
    console.log("                          on import.");
    console.log("");
    console.log(
      "`.env.node` next to your project (or in packages/core/) is auto-loaded.",
    );
    console.log(
      "If DATABASE_URL or DATA_DIR is then set and no runtime flag is passed,",
    );
    console.log(
      "this command uses the Node database runtime and configured storage driver.",
    );
    process.exit(0);
  }

  const { runtime } = bootstrapCliRuntime(values);
  const outputPath = resolve(process.cwd(), values.output);
  const shouldZip = isZipPath(outputPath);
  const scratchDir = shouldZip
    ? await mkdtemp(join(tmpdir(), "jant-site-snapshot-export-"))
    : outputPath;
  const context =
    runtime === "node"
      ? await createNodeExportContext()
      : createD1ExportContext(runtime, values);

  try {
    await assertWritableOutput(outputPath, values.force);
    if (!shouldZip) {
      await mkdir(scratchDir, { recursive: true });
    }

    const { site } = await resolveCliSite(context, {
      env: process.env,
      host: values.host,
      pathPrefix: values["path-prefix"],
      site: values.site,
      url: values.url,
    });

    console.log(`Dumping database (${SNAPSHOT_TABLES.length} tables)...`);
    const dbSql = await dumpDatabaseToSql(
      {
        query(sql) {
          return context.query(sql);
        },
      },
      {
        dialect: context.dialect,
        source: runtime,
        tables: SNAPSHOT_TABLES,
        selectSqlByTable: Object.fromEntries(
          SNAPSHOT_TABLES.map((tableName) => [
            tableName,
            getSnapshotSelectSql(tableName, site.id),
          ]),
        ),
        onProgress: ({ index, total, table }) => {
          console.log(`  [${index}/${total}] ${table}`);
        },
      },
    );

    console.log("Listing storage objects...");
    const objectRows = await context.query(buildSnapshotStorageQuery(site.id));
    const objects = collectSnapshotObjects(objectRows);

    await writeFile(join(scratchDir, "db.sql"), dbSql);

    if (values["skip-objects"]) {
      if (objects.length > 0) {
        console.log(
          `--skip-objects: leaving ${objects.length} referenced object(s) out of the archive.`,
        );
      }
    } else {
      if (objects.length > 0) {
        console.log(`Downloading ${objects.length} referenced object(s)...`);
      }

      for (const [index, object] of objects.entries()) {
        const relativeObjectPath = snapshotObjectPath(object.key);
        const absoluteObjectPath = join(scratchDir, relativeObjectPath);
        console.log(`[${index + 1}/${objects.length}] ${object.key}`);
        await context.downloadObject(object.key, absoluteObjectPath);
      }
    }

    await writeFile(
      join(scratchDir, "meta.json"),
      JSON.stringify(
        buildSnapshotMeta(site, { dialect: context.dialect }),
        null,
        2,
      ) + "\n",
    );

    if (shouldZip) {
      await mkdir(dirname(outputPath), { recursive: true });
      const zipped = zipSync(await readDirectoryEntries(scratchDir), {
        level: 6,
      });
      await writeFile(outputPath, zipped);
      if (process.env.SNAPSHOT_SUPPRESS_SUCCESS_LOG !== "true") {
        console.log(
          `Exported ${getCliRuntimeLabel(runtime)} snapshot to ${values.output}`,
        );
      }
      return;
    }

    if (process.env.SNAPSHOT_SUPPRESS_SUCCESS_LOG !== "true") {
      console.log(
        `Exported ${getCliRuntimeLabel(runtime)} snapshot to ${values.output}`,
      );
    }
  } finally {
    await context.close();
    if (shouldZip) {
      await rm(scratchDir, { recursive: true, force: true });
    }
  }
}
