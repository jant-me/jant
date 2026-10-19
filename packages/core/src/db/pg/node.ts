import { readdirSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate as drizzleMigrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import type { Database } from "../index.js";
import type { RawQueryClient, RawQueryStatement } from "../raw-query.js";
import { pgSchemaBundle } from "../schema-bundle.js";

interface PostgresErrorLike extends Error {
  code?: string;
}

interface PgMigrationJournalRow {
  created_at: number;
  hash: string;
  id: number;
}

interface PgConstraintRow {
  conname: string;
  definition: string;
}

export function isMigrationDebugEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.JANT_DEBUG_MIGRATE === "1";
}

export function listPgMigrationFiles(migrationsFolder: string): string[] {
  return readdirSync(migrationsFolder)
    .filter((entry) => entry.endsWith(".sql"))
    .sort();
}

export function formatPgMigrationJournalSummary(
  entries: PgMigrationJournalRow[],
  expectedCount?: number,
): string {
  const expectedSuffix =
    typeof expectedCount === "number" ? `/${expectedCount}` : "";

  if (entries.length === 0) {
    return `count=0${expectedSuffix}`;
  }

  const latest = entries.at(-1);
  return `count=${entries.length}${expectedSuffix} latest_id=${latest?.id ?? "?"} latest_created_at=${latest?.created_at ?? "?"}`;
}

export async function readPgMigrationJournal(
  pool: Pool,
): Promise<PgMigrationJournalRow[]> {
  try {
    const result = await pool.query<PgMigrationJournalRow>(`
      SELECT id, hash, created_at
      FROM drizzle.__drizzle_migrations
      ORDER BY created_at ASC, id ASC
    `);
    return result.rows;
  } catch (error) {
    const pgError = error as PostgresErrorLike | undefined;
    if (pgError?.code === "3F000" || pgError?.code === "42P01") {
      return [];
    }
    throw error;
  }
}

/**
 * Read when the newest migration the database recorded was generated.
 *
 * @param pool - Pool connected to the site database
 * @returns The newest `created_at` in `drizzle.__drizzle_migrations`, or null
 *   when the table is missing or empty
 * @example
 * ```ts
 * const lastAppliedAt = await readPgLastMigrationAt(pool);
 * ```
 */
export async function readPgLastMigrationAt(
  pool: Pool,
): Promise<number | null> {
  try {
    const result = await pool.query<{ last: string | null }>(`
      SELECT MAX(created_at) AS last
      FROM drizzle.__drizzle_migrations
    `);
    const last = result.rows[0]?.last;
    return last === null || last === undefined ? null : Number(last);
  } catch (error) {
    const pgError = error as PostgresErrorLike | undefined;
    if (pgError?.code === "3F000" || pgError?.code === "42P01") {
      return null;
    }
    throw error;
  }
}

export async function readNavItemCheckConstraints(
  pool: Pool,
): Promise<Record<string, string>> {
  const result = await pool.query<PgConstraintRow>(
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
}

export function formatNavItemConstraintSummary(
  constraints: Record<string, string>,
): string {
  const placement = constraints.chk_nav_item_placement ?? "<missing>";
  const systemKey = constraints.chk_nav_item_system_key ?? "<missing>";
  return `chk_nav_item_placement=${placement}; chk_nav_item_system_key=${systemKey}`;
}

function logMigrationDebug(message: string): void {
  process.stdout.write(`[jant:migrate] ${message}\n`);
}

export async function logPgMigrationDebugState(
  pool: Pool,
  databaseUrl: string,
  migrationsFolder: string,
  phase: "before" | "after" | "failed",
): Promise<void> {
  if (!isMigrationDebugEnabled()) {
    return;
  }

  const target = describePostgresTarget(databaseUrl);
  const migrationFiles = listPgMigrationFiles(migrationsFolder);
  const journal = await readPgMigrationJournal(pool);
  const constraints = await readNavItemCheckConstraints(pool);

  logMigrationDebug(`pg.${phase}.target=${target}`);
  logMigrationDebug(`pg.${phase}.migrations_folder=${migrationsFolder}`);
  logMigrationDebug(
    `pg.${phase}.migrations_files=${migrationFiles.join(", ") || "<none>"}`,
  );
  logMigrationDebug(
    `pg.${phase}.journal=${formatPgMigrationJournalSummary(
      journal,
      migrationFiles.length,
    )}`,
  );
  logMigrationDebug(
    `pg.${phase}.nav_item_constraints=${formatNavItemConstraintSummary(
      constraints,
    )}`,
  );
}

export function describePostgresTarget(databaseUrl: string): string {
  try {
    const parsed = new URL(databaseUrl);
    const protocol = parsed.protocol.replace(/:$/, "");
    const username = parsed.username || "<unknown-user>";
    const hostname = parsed.hostname || "<unknown-host>";
    const port = parsed.port || "5432";
    const database = parsed.pathname.replace(/^\/+/, "") || "<unknown-db>";
    return `${protocol}://${username}@${hostname}:${port}/${database}`;
  } catch {
    return "<invalid-postgres-url>";
  }
}

export function wrapPostgresConnectionError(
  error: unknown,
  databaseUrl: string,
  action: "connect" | "migrate",
): Error {
  const target = describePostgresTarget(databaseUrl);
  const pgError =
    error instanceof Error ? (error as PostgresErrorLike) : undefined;

  if (pgError?.code === "28P01") {
    return new Error(
      `Postgres authentication failed while attempting to ${action} ${target}. Check the DATABASE_URL username and password.`,
      { cause: error },
    );
  }

  if (pgError?.code === "3D000") {
    return new Error(
      `Postgres database does not exist while attempting to ${action} ${target}. Check the DATABASE_URL database name.`,
      { cause: error },
    );
  }

  return error instanceof Error
    ? error
    : new Error(`Failed to ${action} Postgres database ${target}.`, {
        cause: error,
      });
}

function convertQuestionMarkParams(query: string): string {
  let parameterIndex = 0;
  return query.replace(/\?/g, () => {
    parameterIndex += 1;
    return `$${parameterIndex}`;
  });
}

export function createNodePgRawQuery(pool: Pool): RawQueryClient {
  return {
    prepare(query: string): RawQueryStatement {
      let params: unknown[] = [];

      return {
        bind(...nextParams: unknown[]) {
          params = nextParams;
          return this;
        },
        async all<T>() {
          const result = await pool.query(
            convertQuestionMarkParams(query),
            params,
          );
          return {
            results: result.rows as T[],
          };
        },
      };
    },
  };
}

export async function assertPostgresInitialized(pool: Pool): Promise<void> {
  const result = await pool.query<{
    has_site: string | null;
    has_site_setting: string | null;
  }>(`
    SELECT
      to_regclass('public.site') AS has_site,
      to_regclass('public.site_setting') AS has_site_setting
  `);

  const row = result.rows[0];
  if (!row?.has_site || !row.has_site_setting) {
    throw new Error(
      "Database is not initialized. Run `jant migrate` before `jant start`.",
    );
  }
}

export async function createNodePgDatabase(
  databaseUrl: string,
  options?: { requireInitialized?: boolean },
): Promise<{
  db: Database;
  pool: Pool;
  rawQuery: RawQueryClient;
}> {
  const pool = new Pool({
    connectionString: databaseUrl,
  });

  try {
    await pool.query("SELECT 1");
    if (options?.requireInitialized) {
      await assertPostgresInitialized(pool);
    }

    return {
      db: drizzle(pool, { schema: pgSchemaBundle }) as unknown as Database,
      pool,
      rawQuery: createNodePgRawQuery(pool),
    };
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw wrapPostgresConnectionError(error, databaseUrl, "connect");
  }
}

export async function migrateNodePgDatabase(
  databaseUrl: string,
  migrationsFolder: string,
): Promise<void> {
  const pool = new Pool({
    connectionString: databaseUrl,
  });

  try {
    const db = drizzle(pool, { schema: pgSchemaBundle });
    await logPgMigrationDebugState(
      pool,
      databaseUrl,
      migrationsFolder,
      "before",
    );
    await drizzleMigrate(db, { migrationsFolder });
    await logPgMigrationDebugState(
      pool,
      databaseUrl,
      migrationsFolder,
      "after",
    );
  } catch (error) {
    try {
      await logPgMigrationDebugState(
        pool,
        databaseUrl,
        migrationsFolder,
        "failed",
      );
    } catch {
      // Best-effort debug logging should never hide the original migration error.
    }
    throw wrapPostgresConnectionError(error, databaseUrl, "migrate");
  } finally {
    await pool.end();
  }
}
