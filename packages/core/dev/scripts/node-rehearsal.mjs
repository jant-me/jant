/**
 * Migration rehearsal on the Node runtime, over Postgres or SQLite.
 *
 * Hosted Jant runs on Postgres and the Docker image on SQLite, both through
 * the Node runtime, whose migrator is Drizzle's rather than the D1 runner
 * `jant db rehearse` exercises. `pg-smoke.mjs` only migrates an empty
 * database. This rebuilds a throwaway database at a recorded baseline
 * migration, loads a seed frozen at that baseline, runs `jant migrate --node`
 * — every later schema migration and data backfill — and checks the
 * manifest's assertions. Then it serves the upgraded database and reads the
 * manifest's `pages` as a signed-out reader would, since data that counts
 * right can still fail to render. docs/internal/migration-rehearsal.md has
 * the D1 counterpart.
 *
 * Usage: node dev/scripts/node-rehearsal.mjs --fixture <manifest.json>
 *
 * The manifest's `dialect` is `pg` or `sqlite`. Postgres needs:
 *   PG_REHEARSAL_ADMIN_DATABASE_URL  database to create and drop from
 *   PG_REHEARSAL_DATABASE_URL        the throwaway database (recreated)
 * SQLite runs in a temporary file.
 *
 * `jant migrate --node` and the page reads load `dist/`; `mise run
 * check-pg-rehearsal` and `check-sqlite-rehearsal` build it first.
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
import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { migrate as migrateSqlite } from "drizzle-orm/better-sqlite3/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const coreDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const jantBin = join(coreDir, "bin/jant.js");

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set.`);
  return value;
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/**
 * A copy of a migrations folder whose journal stops at `baseMigrationTag`.
 *
 * Drizzle applies every migration in a folder's journal, so the baseline runs
 * from this copy. The later run over the real folder then applies only what
 * comes after it: Drizzle compares each migration's timestamp with the newest
 * one the database recorded.
 */
function baselineFolder(migrationsDir, baseMigrationTag) {
  const journal = JSON.parse(
    readFileSync(join(migrationsDir, "meta/_journal.json"), "utf8"),
  );
  const index = journal.entries.findIndex(
    (entry) => entry.tag === baseMigrationTag,
  );
  if (index === -1) {
    throw new Error(`Baseline ${baseMigrationTag} is not in ${migrationsDir}.`);
  }
  const folder = mkdtempSync(join(tmpdir(), "jant-rehearsal-migrations-"));
  cpSync(migrationsDir, folder, { recursive: true });
  writeFileSync(
    join(folder, "meta/_journal.json"),
    JSON.stringify({
      ...journal,
      entries: journal.entries.slice(0, index + 1),
    }),
  );
  return { folder, migrationCount: journal.entries.length };
}

/**
 * What a rehearsal needs from each dialect: a database at the baseline with
 * the seed loaded, a query runner, and where Drizzle records migrations.
 */
const DIALECTS = {
  pg: {
    migrationsDir: join(coreDir, "src/db/migrations/pg"),
    migrationsTable: "drizzle.__drizzle_migrations",
    async open() {
      const adminDatabaseUrl = getRequiredEnv(
        "PG_REHEARSAL_ADMIN_DATABASE_URL",
      );
      const databaseUrl = getRequiredEnv("PG_REHEARSAL_DATABASE_URL");
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
      return {
        databaseUrl,
        async migrate(folder) {
          const pool = new Pool({ connectionString: databaseUrl });
          try {
            await migratePg(drizzlePg(pool), { migrationsFolder: folder });
          } finally {
            await pool.end();
          }
        },
        async exec(sql) {
          const pool = new Pool({ connectionString: databaseUrl });
          try {
            await pool.query(sql);
          } finally {
            await pool.end();
          }
        },
        async query(sql) {
          const pool = new Pool({ connectionString: databaseUrl });
          try {
            return (await pool.query(sql)).rows;
          } finally {
            await pool.end();
          }
        },
        async close() {},
      };
    },
  },
  sqlite: {
    migrationsDir: join(coreDir, "src/db/migrations"),
    migrationsTable: "__drizzle_migrations",
    async open() {
      const dir = mkdtempSync(join(tmpdir(), "jant-sqlite-rehearsal-"));
      const file = join(dir, "jant.sqlite");
      // One connection at a time: `jant migrate` runs in another process.
      const withDatabase = (fn) => {
        const db = new Database(file);
        try {
          return fn(db);
        } finally {
          db.close();
        }
      };
      return {
        databaseUrl: `file:${file}`,
        async migrate(folder) {
          withDatabase((db) =>
            migrateSqlite(drizzleSqlite(db), { migrationsFolder: folder }),
          );
        },
        async exec(sql) {
          withDatabase((db) => db.exec(sql));
        },
        async query(sql) {
          return withDatabase((db) => db.prepare(sql).all());
        },
        async close() {
          rmSync(dir, { recursive: true, force: true });
        },
      };
    },
  },
};

async function runAssertions(database, assertions) {
  for (const check of assertions) {
    const rows = await database.query(check.sql);
    if ("rowCount" in check) {
      assert.equal(rows.length, check.rowCount, check.name);
    } else {
      assert.equal(Number(rows[0]?.[check.column]), check.equals, check.name);
    }
    console.log(`  ✓ ${check.name}`);
  }
}

/**
 * Read pages from the upgraded database as a signed-out reader. Each page
 * names its status, and optionally a redirect target, text it must show, and
 * text it must not.
 */
async function readPages(databaseUrl, pages) {
  const { createApp } = await import("../../dist/index.js");
  const { createNodeRequestHandler } = await import("../../dist/node.js");
  const origin = "http://127.0.0.1:3000";
  const dataDir = mkdtempSync(join(tmpdir(), "jant-rehearsal-pages-"));
  const handler = await createNodeRequestHandler({
    env: {
      DATABASE_URL: databaseUrl,
      AUTH_SECRET: "rehearsal-secret-with-enough-entropy-for-pages",
      DATA_DIR: dataDir,
      SITE_RESOLUTION_MODE: "single-site",
      SITE_ORIGIN: origin,
    },
    app: createApp(),
    assetRoot: null,
  });
  try {
    for (const page of pages) {
      const response = await handler.fetch(
        new Request(`${origin}${page.path}`, { redirect: "manual" }),
      );
      assert.equal(response.status, page.status, `${page.path} status`);
      if (page.location) {
        const location = new URL(
          response.headers.get("location") ?? "",
          origin,
        );
        assert.equal(location.pathname, page.location, `${page.path} target`);
      }
      const body = await response.text();
      for (const text of page.contains ?? []) {
        assert.ok(body.includes(text), `${page.path} shows "${text}"`);
      }
      for (const text of page.excludes ?? []) {
        assert.ok(!body.includes(text), `${page.path} hides "${text}"`);
      }
      console.log(`  ✓ ${page.path}`);
    }
  } finally {
    await handler.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function main() {
  const { values } = parseArgs({
    options: { fixture: { type: "string" } },
  });
  if (!values.fixture) {
    throw new Error("--fixture <manifest.json> is required.");
  }
  const manifestPath = resolve(values.fixture);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const dialect = DIALECTS[manifest.dialect];
  if (!dialect) {
    throw new Error(
      `${manifestPath} needs "dialect": "pg" or "sqlite" to rehearse on Node.`,
    );
  }
  const seedSql = readFileSync(
    resolve(dirname(manifestPath), manifest.seedPath),
    "utf8",
  );

  console.log(
    `Rehearsing ${manifest.dialect} migrations from ${manifest.baseMigrationTag}`,
  );
  const database = await dialect.open();
  try {
    const { folder, migrationCount } = baselineFolder(
      dialect.migrationsDir,
      manifest.baseMigrationTag,
    );
    try {
      await database.migrate(folder);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }

    await database.exec(seedSql);
    console.log(`Loaded seed ${manifest.seedPath}`);

    execFileSync(process.execPath, [jantBin, "migrate", "--node"], {
      cwd: coreDir,
      env: {
        ...process.env,
        JANT_ENV_FILE: "",
        DATABASE_URL: database.databaseUrl,
      },
      stdio: "inherit",
    });

    await runAssertions(database, [
      {
        name: "every migration is applied",
        sql: `SELECT COUNT(*) AS count FROM ${dialect.migrationsTable}`,
        column: "count",
        equals: migrationCount,
      },
      ...manifest.assertions,
    ]);
    if (manifest.pages?.length) {
      console.log(`Reading ${manifest.pages.length} pages as a reader...`);
      await readPages(database.databaseUrl, manifest.pages);
    }
    console.log(`Rehearsal ${manifest.name} passed.`);
  } finally {
    await database.close();
  }
}

await main();
