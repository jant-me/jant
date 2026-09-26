/**
 * Postgres migration rehearsal.
 *
 * Hosted Jant runs on Postgres, so a Postgres database with years of data
 * upgrading in place is the path most sites take. `pg-smoke.mjs` only
 * migrates an empty database. This rebuilds a throwaway database at a
 * recorded baseline migration, loads a seed frozen at that baseline, runs
 * `jant migrate --node` — every later schema migration and data backfill —
 * and checks the manifest's assertions. It is the Postgres counterpart of
 * `jant db rehearse` for D1; docs/internal/migration-rehearsal.md has both.
 *
 * Usage: node dev/scripts/pg-rehearsal.mjs [--fixture <manifest.json>]
 *
 * Environment:
 *   PG_REHEARSAL_ADMIN_DATABASE_URL  database to create and drop from
 *   PG_REHEARSAL_DATABASE_URL        the throwaway database (recreated)
 *
 * `jant migrate --node` loads `dist/node.js`; `mise run check-pg-rehearsal`
 * builds it first.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const coreDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const jantBin = join(coreDir, "bin/jant.js");
const pgMigrationsDir = join(coreDir, "src/db/migrations/pg");
const defaultFixture = join(
  coreDir,
  "src/db/rehearsal-fixtures/pg-demo-current.json",
);

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set.`);
  return value;
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function recreateDatabase(adminDatabaseUrl, databaseUrl) {
  const databaseName = new URL(databaseUrl).pathname.replace(/^\/+/, "");
  if (!databaseName) {
    throw new Error("PG_REHEARSAL_DATABASE_URL must name a database.");
  }
  const admin = new Pool({ connectionString: adminDatabaseUrl });
  try {
    await admin.query(
      `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`,
    );
    await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  } finally {
    await admin.end();
  }
}

/**
 * Apply the Postgres migrations up to and including `baseMigrationTag`.
 *
 * Drizzle applies every migration in a folder's journal, so the baseline runs
 * from a copy whose journal stops at the tag. The later run over the real
 * folder then applies only what comes after it: Drizzle compares each
 * migration's timestamp with the newest one the database recorded.
 */
async function migrateToBaseline(databaseUrl, baseMigrationTag) {
  const journal = JSON.parse(
    readFileSync(join(pgMigrationsDir, "meta/_journal.json"), "utf8"),
  );
  const index = journal.entries.findIndex(
    (entry) => entry.tag === baseMigrationTag,
  );
  if (index === -1) {
    throw new Error(
      `Baseline ${baseMigrationTag} is not a Postgres migration.`,
    );
  }

  const folder = mkdtempSync(join(tmpdir(), "jant-pg-rehearsal-"));
  try {
    cpSync(pgMigrationsDir, folder, { recursive: true });
    writeFileSync(
      join(folder, "meta/_journal.json"),
      JSON.stringify({
        ...journal,
        entries: journal.entries.slice(0, index + 1),
      }),
    );
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await migrate(drizzle(pool), { migrationsFolder: folder });
    } finally {
      await pool.end();
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }

  return journal.entries.length;
}

async function runAssertions(databaseUrl, assertions) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    for (const check of assertions) {
      const { rows } = await pool.query(check.sql);
      if ("rowCount" in check) {
        assert.equal(rows.length, check.rowCount, check.name);
      } else {
        assert.equal(Number(rows[0]?.[check.column]), check.equals, check.name);
      }
      console.log(`  ✓ ${check.name}`);
    }
  } finally {
    await pool.end();
  }
}

async function main() {
  const { values } = parseArgs({
    options: { fixture: { type: "string" } },
  });
  const manifestPath = resolve(values.fixture ?? defaultFixture);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const seedSql = readFileSync(
    resolve(dirname(manifestPath), manifest.seedPath),
    "utf8",
  );

  const adminDatabaseUrl = getRequiredEnv("PG_REHEARSAL_ADMIN_DATABASE_URL");
  const databaseUrl = getRequiredEnv("PG_REHEARSAL_DATABASE_URL");

  console.log(
    `Rehearsing Postgres migrations from ${manifest.baseMigrationTag}`,
  );
  await recreateDatabase(adminDatabaseUrl, databaseUrl);
  const migrationCount = await migrateToBaseline(
    databaseUrl,
    manifest.baseMigrationTag,
  );

  const seedPool = new Pool({ connectionString: databaseUrl });
  try {
    await seedPool.query(seedSql);
  } finally {
    await seedPool.end();
  }
  console.log(`Loaded seed ${manifest.seedPath}`);

  execFileSync(process.execPath, [jantBin, "migrate", "--node"], {
    cwd: coreDir,
    env: { ...process.env, JANT_ENV_FILE: "", DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });

  await runAssertions(databaseUrl, [
    {
      name: "every Postgres migration is applied",
      sql: "SELECT COUNT(*) AS count FROM drizzle.__drizzle_migrations",
      column: "count",
      equals: migrationCount,
    },
    ...manifest.assertions,
  ]);
  console.log(`Postgres rehearsal ${manifest.name} passed.`);
}

await main();
