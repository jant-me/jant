import { existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Pool } from "pg";
import {
  applyD1Backfills,
  applyD1SchemaMigrations,
  applyNodeBackfills,
  applyPgBackfills,
} from "../lib/migration-runner.js";
import { queryD1 } from "../lib/d1-query.js";
import { loadNodeRuntime } from "../lib/load-node-runtime.js";
import { loadNodeEnvFile } from "../lib/node-env.js";
import { openNodeSqlite, resolveDatabaseDialect } from "../lib/node-sqlite.js";
import {
  bootstrapCliRuntime,
  getCliRuntimeLabel,
} from "../lib/runtime-target.js";
import {
  preflightThreadCollectionMigration,
  verifyThreadCollectionMigration,
} from "../lib/thread-collection-migration.js";

export { loadNodeEnvFile };

export function isMigrationDebugEnabled(env = process.env) {
  return env.JANT_DEBUG_MIGRATE === "1";
}

export function describeNodeDatabaseTarget(databaseUrl) {
  if (!databaseUrl) {
    return "<unset>";
  }

  if (resolveDatabaseDialect(databaseUrl) === "sqlite") {
    return databaseUrl;
  }

  try {
    const parsed = new URL(databaseUrl);
    const protocol = parsed.protocol.replace(/:$/, "");
    const username = parsed.username || "<unknown-user>";
    const hostname = parsed.hostname || "<unknown-host>";
    const port = parsed.port || "5432";
    const database = parsed.pathname.replace(/^\/+/, "") || "<unknown-db>";
    return `${protocol}://${username}@${hostname}:${port}/${database}`;
  } catch {
    return "<invalid-database-url>";
  }
}

function logMigrationDebug(message) {
  console.log(`[jant:migrate] ${message}`);
}

function resolveNodePgMigrationsDir(baseUrl = import.meta.url) {
  const root = dirname(fileURLToPath(baseUrl));
  const candidates = [
    resolve(root, "../../dist/db/migrations/pg"),
    resolve(root, "../../src/db/migrations/pg"),
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

function listPgMigrationFiles(migrationsFolder) {
  if (!migrationsFolder) {
    return [];
  }

  return readdirSync(migrationsFolder)
    .filter((entry) => entry.endsWith(".sql"))
    .sort();
}

function formatPgMigrationJournalSummary(entries, expectedCount) {
  const expectedSuffix =
    typeof expectedCount === "number" ? `/${expectedCount}` : "";

  if (entries.length === 0) {
    return `count=0${expectedSuffix}`;
  }

  const latest = entries.at(-1);
  return `count=${entries.length}${expectedSuffix} latest_id=${latest?.id ?? "?"} latest_created_at=${latest?.created_at ?? "?"}`;
}

async function readPgMigrationJournal(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const result = await pool.query(`
      SELECT id, hash, created_at
      FROM drizzle.__drizzle_migrations
      ORDER BY created_at ASC, id ASC
    `);
    return result.rows;
  } catch (error) {
    if (error?.code === "3F000" || error?.code === "42P01") {
      return [];
    }
    throw error;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function readNavItemCheckConstraints(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const result = await pool.query(
      `
        SELECT
          c.conname,
          pg_get_constraintdef(c.oid) AS definition
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'nav_item'
          AND c.conname = ANY($1::text[])
        ORDER BY c.conname ASC
      `,
      [["chk_nav_item_placement", "chk_nav_item_system_key"]],
    );
    return Object.fromEntries(
      result.rows.map((row) => [row.conname, row.definition]),
    );
  } finally {
    await pool.end().catch(() => undefined);
  }
}

function formatNavItemConstraintSummary(constraints) {
  const placement = constraints.chk_nav_item_placement ?? "<missing>";
  const systemKey = constraints.chk_nav_item_system_key ?? "<missing>";
  return `chk_nav_item_placement=${placement}; chk_nav_item_system_key=${systemKey}`;
}

async function logCliPgMigrationDebug(databaseUrl, phase) {
  const migrationsFolder = resolveNodePgMigrationsDir();
  const migrationFiles = listPgMigrationFiles(migrationsFolder);

  try {
    const journal = await readPgMigrationJournal(databaseUrl);
    const constraints = await readNavItemCheckConstraints(databaseUrl);
    logMigrationDebug(
      `cli.pg.${phase}.target=${describeNodeDatabaseTarget(databaseUrl)}`,
    );
    logMigrationDebug(
      `cli.pg.${phase}.migrations_folder=${migrationsFolder ?? "<missing>"}`,
    );
    logMigrationDebug(
      `cli.pg.${phase}.migrations_files=${migrationFiles.join(", ") || "<none>"}`,
    );
    logMigrationDebug(
      `cli.pg.${phase}.journal=${formatPgMigrationJournalSummary(
        journal,
        migrationFiles.length,
      )}`,
    );
    logMigrationDebug(
      `cli.pg.${phase}.nav_item_constraints=${formatNavItemConstraintSummary(
        constraints,
      )}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logMigrationDebug(`cli.pg.${phase}.inspect_error=${message}`);
  }
}

async function withNodeMigrationQuery(databaseDialect, databaseUrl, callback) {
  if (databaseDialect === "pg") {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      return await callback(async (sql) => (await pool.query(sql)).rows);
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  const { sqlite } = openNodeSqlite(process.env, {
    createParentDir: true,
    requireInitialized: false,
  });
  try {
    return await callback((sql) => sqlite.prepare(sql).all());
  } finally {
    sqlite.close();
  }
}

export async function run(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: "string" },
      database: { type: "string", default: "DB" },
      env: { type: "string" },
      help: { type: "boolean", short: "h" },
      local: { type: "boolean", default: false },
      node: { type: "boolean", default: false },
      "persist-to": { type: "string" },
      remote: { type: "boolean", default: false },
    },
  });

  if (values.help) {
    console.log(
      "Usage: jant migrate [--local | --remote | --node] [--config <file>] [--env <name>] [--database <binding>]",
    );
    console.log("");
    console.log("Apply schema migrations and data backfills.");
    console.log("");
    console.log("Options:");
    console.log("  --local            Force local D1 instead of DATABASE_URL");
    console.log("  --remote           Run against remote D1");
    console.log(
      "  --node             Force Node runtime even if DATABASE_URL is unset",
    );
    console.log(
      "  --config           Wrangler config file (default: wrangler.toml)",
    );
    console.log("  --env              Wrangler environment name");
    console.log("  --database         D1 binding name (default: DB)");
    console.log("  --persist-to       Local D1 state directory override");
    console.log("");
    console.log(
      "`.env.node` next to your project (or in packages/core/) is auto-loaded.",
    );
    console.log(
      "If DATABASE_URL or DATA_DIR is then set and no runtime flag is passed,",
    );
    console.log("this command uses the Node database runtime.");
    process.exit(0);
  }

  // bootstrapCliRuntime auto-loads `.env.node` (so DATABASE_URL/DATA_DIR
  // resolve without sourcing the file) and prints a one-line banner with
  // the chosen target.
  const { runtime, envLoad } = bootstrapCliRuntime(values);
  const nodeEnvLoadResult = envLoad;
  const debugMigrate = isMigrationDebugEnabled();
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const databaseDialect =
    runtime === "node" && databaseUrl
      ? resolveDatabaseDialect(databaseUrl)
      : undefined;

  if (debugMigrate) {
    logMigrationDebug(`cli.runtime=${runtime}`);
    const databaseUrlSource = nodeEnvLoadResult?.assignedKeys.includes(
      "DATABASE_URL",
    )
      ? ".env.node"
      : process.env.DATABASE_URL
        ? "process.env"
        : "<unset>";
    const dataDirSource = nodeEnvLoadResult?.assignedKeys.includes("DATA_DIR")
      ? ".env.node"
      : process.env.DATA_DIR
        ? "process.env"
        : "<unset>";
    const envPath = nodeEnvLoadResult?.envPath ?? "<unknown>";
    const envState = nodeEnvLoadResult?.found ? "loaded" : "missing";
    const skippedKeys = nodeEnvLoadResult?.skippedKeys.join(", ") || "<none>";
    logMigrationDebug(`cli.node_env.path=${envPath}`);
    logMigrationDebug(`cli.node_env.state=${envState}`);
    logMigrationDebug(`cli.node_env.skipped_keys=${skippedKeys}`);
    logMigrationDebug(`cli.node_env.database_url_source=${databaseUrlSource}`);
    logMigrationDebug(`cli.node_env.data_dir_source=${dataDirSource}`);

    if (runtime === "node") {
      logMigrationDebug(`cli.node.dialect=${databaseDialect ?? "<unset>"}`);
      logMigrationDebug(
        `cli.node.target=${describeNodeDatabaseTarget(databaseUrl)}`,
      );
    }
  }

  if (runtime === "node") {
    const threadCollectionPreflight = await withNodeMigrationQuery(
      databaseDialect,
      databaseUrl,
      (query) =>
        preflightThreadCollectionMigration({
          dialect: databaseDialect === "pg" ? "pg" : "sqlite",
          query,
        }),
    );

    if (debugMigrate && databaseDialect === "pg") {
      await logCliPgMigrationDebug(databaseUrl, "before");
    }

    const { migrate } = await loadNodeRuntime();
    try {
      await migrate();
    } catch (error) {
      if (debugMigrate && databaseDialect === "pg") {
        await logCliPgMigrationDebug(databaseUrl, "failed");
      }
      throw error;
    }

    await withNodeMigrationQuery(databaseDialect, databaseUrl, (query) =>
      verifyThreadCollectionMigration(
        {
          dialect: databaseDialect === "pg" ? "pg" : "sqlite",
          query,
        },
        threadCollectionPreflight,
      ),
    );

    if (debugMigrate && databaseDialect === "pg") {
      await logCliPgMigrationDebug(databaseUrl, "after");
    }

    if (
      !process.env.DATABASE_URL ||
      resolveDatabaseDialect(process.env.DATABASE_URL) === "sqlite"
    ) {
      const { sqlite } = openNodeSqlite(process.env);
      try {
        applyNodeBackfills(sqlite);
      } finally {
        sqlite.close();
      }
    } else if (databaseDialect === "pg") {
      const pool = new Pool({ connectionString: databaseUrl });
      try {
        await applyPgBackfills(pool);
      } finally {
        await pool.end().catch(() => undefined);
      }
    }
  } else {
    const options = {
      configPath: values.config,
      database: values.database,
      env: values.env,
      persistTo: values["persist-to"],
    };
    const query = (sql) => queryD1(sql, runtime, options);
    const threadCollectionPreflight = await preflightThreadCollectionMigration({
      dialect: "sqlite",
      query,
    });
    applyD1SchemaMigrations(runtime, options);
    await verifyThreadCollectionMigration(
      { dialect: "sqlite", query },
      threadCollectionPreflight,
    );
    applyD1Backfills(runtime, options);
  }

  console.log(`Database is up to date (${getCliRuntimeLabel(runtime)}).`);
}
