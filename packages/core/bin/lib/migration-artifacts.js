import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";

export const DEFAULT_D1_MIGRATIONS_TABLE = "d1_migrations";
export const DEFAULT_D1_MIGRATIONS_DIR = "migrations";
export const DEFAULT_DATA_MIGRATION_TABLE = "data_migration";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function resolveBundledDbDir(moduleUrl = import.meta.url) {
  return resolve(dirname(fileURLToPath(moduleUrl)), "../../src/db");
}

export function resolveBundledBackfillsDir(moduleUrl = import.meta.url) {
  return join(resolveBundledDbDir(moduleUrl), "backfills");
}

/**
 * Directory of the schema migrations this package ships for a dialect.
 *
 * @param {"sqlite" | "pg"} dialect SQLite (D1 and Node) or Postgres
 * @param {string} [moduleUrl] Module URL the package root is resolved from
 * @returns {string} Absolute path of the migrations directory
 * @example
 * ```js
 * resolveBundledSchemaMigrationsDir("pg"); // ".../src/db/migrations/pg"
 * ```
 */
export function resolveBundledSchemaMigrationsDir(
  dialect,
  moduleUrl = import.meta.url,
) {
  const dir = join(resolveBundledDbDir(moduleUrl), "migrations");
  return dialect === "pg" ? join(dir, "pg") : dir;
}

export function extractNumberPrefix(name) {
  const match = String(name).match(/^(\d+)/);
  return match ? match[1] : null;
}

export function isCanonicalNumberedSqlFile(name) {
  return /^\d{4}_[a-z0-9_]+\.sql$/.test(name);
}

export function listSchemaMigrationFiles(migrationsDir) {
  const journalPath = join(migrationsDir, "meta", "_journal.json");
  const journal = readJson(journalPath);

  return journal.entries.map((entry) => {
    const name = `${entry.tag}.sql`;
    const path = join(migrationsDir, name);
    if (!existsSync(path)) {
      throw new Error(`Missing schema migration file: ${path}`);
    }
    return { name, path, tag: entry.tag };
  });
}

export function listBackfillFiles(backfillsDir) {
  if (!existsSync(backfillsDir)) {
    return [];
  }

  return readdirSync(backfillsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      path: join(backfillsDir, name),
    }));
}

export function resolveWranglerConfigPath(
  configPath = "wrangler.toml",
  cwd = process.cwd(),
) {
  return resolve(cwd, configPath);
}

export function readWranglerDatabaseConfig(options = {}) {
  const configPath = resolveWranglerConfigPath(options.configPath, options.cwd);
  if (!existsSync(configPath)) {
    throw new Error(`Wrangler config not found: ${configPath}`);
  }

  const config = parseToml(readFileSync(configPath, "utf-8"));
  const envName = options.env;
  const databaseBinding = options.database ?? "DB";
  const envConfig = envName ? config.env?.[envName] : undefined;
  const databases = envConfig?.d1_databases ?? config.d1_databases ?? [];
  const database = databases.find((entry) => entry.binding === databaseBinding);

  if (!database) {
    const envLabel = envName ? ` in env.${envName}` : "";
    throw new Error(
      `D1 binding "${databaseBinding}" not found${envLabel} in ${configPath}.`,
    );
  }

  return {
    configPath,
    configDir: dirname(configPath),
    accountId: envConfig?.account_id ?? config.account_id ?? null,
    databaseBinding,
    databaseId: database.database_id ?? null,
    databaseName: database.database_name ?? null,
    migrationsDir: resolve(
      dirname(configPath),
      database.migrations_dir ?? DEFAULT_D1_MIGRATIONS_DIR,
    ),
    migrationsTable: database.migrations_table ?? DEFAULT_D1_MIGRATIONS_TABLE,
  };
}
