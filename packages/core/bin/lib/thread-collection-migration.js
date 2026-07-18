const LEGACY_TABLE = "post_collection";
const TARGET_TABLE = "thread_collection";

function toCount(value, label) {
  const count = Number(value ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(
      `Thread Collection migration check returned an invalid ${label}: ${String(value)}.`,
    );
  }
  return count;
}

function toBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

async function readTableState(query, dialect) {
  const rows = await query(
    dialect === "pg"
      ? `
          SELECT
            to_regclass('public.${LEGACY_TABLE}') IS NOT NULL AS legacy_exists,
            to_regclass('public.${TARGET_TABLE}') IS NOT NULL AS target_exists
        `
      : `
          SELECT
            EXISTS(
              SELECT 1 FROM sqlite_master
              WHERE type = 'table' AND name = '${LEGACY_TABLE}'
            ) AS legacy_exists,
            EXISTS(
              SELECT 1 FROM sqlite_master
              WHERE type = 'table' AND name = '${TARGET_TABLE}'
            ) AS target_exists
        `,
  );
  const row = rows[0] ?? {};
  return {
    legacyExists: toBoolean(row.legacy_exists),
    targetExists: toBoolean(row.target_exists),
  };
}

async function readSqlitePostColumns(query) {
  const rows = await query(`PRAGMA table_info("post")`);
  return new Set(rows.map((row) => String(row.name)));
}

async function readPostgresPostColumns(query) {
  const rows = await query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'post'
  `);
  return new Set(rows.map((row) => String(row.column_name)));
}

async function readPostColumns(query, dialect) {
  return dialect === "pg"
    ? readPostgresPostColumns(query)
    : readSqlitePostColumns(query);
}

function hasThreadColumns(columns) {
  return (
    columns.has("id") &&
    columns.has("site_id") &&
    columns.has("reply_to_id") &&
    columns.has("thread_id")
  );
}

async function readLegacyStats(query, postColumns) {
  const retainedPostPredicate = postColumns.has("deleted_at")
    ? "post.deleted_at IS NULL"
    : "1 = 1";
  const softDeletedSourceExpression = postColumns.has("deleted_at")
    ? "CASE WHEN post.deleted_at IS NOT NULL THEN 1 ELSE 0 END"
    : "0";
  const rows = await query(`
    SELECT
      COUNT(*) AS source_count,
      COALESCE(SUM(${softDeletedSourceExpression}), 0)
        AS soft_deleted_source_count,
      COALESCE(SUM(CASE WHEN site.id IS NULL THEN 1 ELSE 0 END), 0)
        AS missing_site_count,
      COALESCE(SUM(CASE WHEN post.id IS NULL THEN 1 ELSE 0 END), 0)
        AS missing_post_count,
      COALESCE(SUM(CASE WHEN collection.id IS NULL THEN 1 ELSE 0 END), 0)
        AS missing_collection_count,
      COALESCE(SUM(
        CASE
          WHEN post.id IS NOT NULL AND (
            root.id IS NULL
            OR root.reply_to_id IS NOT NULL
            OR root.thread_id <> root.id
          ) THEN 1
          ELSE 0
        END
      ), 0) AS invalid_thread_count
    FROM post_collection AS membership
    LEFT JOIN site
      ON site.id = membership.site_id
    LEFT JOIN post
      ON post.site_id = membership.site_id
      AND post.id = membership.post_id
    LEFT JOIN post AS root
      ON root.site_id = post.site_id
      AND root.id = post.thread_id
    LEFT JOIN collection
      ON collection.site_id = membership.site_id
      AND collection.id = membership.collection_id
  `);
  const row = rows[0] ?? {};
  const expectedRows = await query(`
    SELECT COUNT(*) AS expected_count
    FROM (
      SELECT
        membership.site_id,
        post.thread_id,
        membership.collection_id
      FROM post_collection AS membership
      INNER JOIN post
        ON post.site_id = membership.site_id
        AND post.id = membership.post_id
      WHERE ${retainedPostPredicate}
      GROUP BY
        membership.site_id,
        post.thread_id,
        membership.collection_id
    ) AS thread_membership
  `);

  return {
    sourceCount: toCount(row.source_count, "legacy row count"),
    softDeletedSourceCount: toCount(
      row.soft_deleted_source_count,
      "soft-deleted legacy row count",
    ),
    expectedCount: toCount(
      expectedRows[0]?.expected_count,
      "expected Thread membership count",
    ),
    missingSiteCount: toCount(row.missing_site_count, "missing site count"),
    missingPostCount: toCount(row.missing_post_count, "missing post count"),
    missingCollectionCount: toCount(
      row.missing_collection_count,
      "missing Collection count",
    ),
    invalidThreadCount: toCount(
      row.invalid_thread_count,
      "invalid Thread root count",
    ),
  };
}

async function readTargetStats(query) {
  const rows = await query(`
    SELECT
      COUNT(*) AS target_count,
      COALESCE(SUM(CASE WHEN site.id IS NULL THEN 1 ELSE 0 END), 0)
        AS missing_site_count,
      COALESCE(SUM(CASE WHEN root.id IS NULL THEN 1 ELSE 0 END), 0)
        AS missing_thread_count,
      COALESCE(SUM(CASE WHEN collection.id IS NULL THEN 1 ELSE 0 END), 0)
        AS missing_collection_count,
      COALESCE(SUM(
        CASE
          WHEN root.id IS NOT NULL AND (
            root.reply_to_id IS NOT NULL
            OR root.thread_id <> root.id
          ) THEN 1
          ELSE 0
        END
      ), 0) AS invalid_thread_count
    FROM thread_collection AS membership
    LEFT JOIN site
      ON site.id = membership.site_id
    LEFT JOIN post AS root
      ON root.site_id = membership.site_id
      AND root.id = membership.thread_id
    LEFT JOIN collection
      ON collection.site_id = membership.site_id
      AND collection.id = membership.collection_id
  `);
  const row = rows[0] ?? {};
  return {
    targetCount: toCount(row.target_count, "migrated row count"),
    missingSiteCount: toCount(row.missing_site_count, "missing site count"),
    missingThreadCount: toCount(
      row.missing_thread_count,
      "missing Thread count",
    ),
    missingCollectionCount: toCount(
      row.missing_collection_count,
      "missing Collection count",
    ),
    invalidThreadCount: toCount(
      row.invalid_thread_count,
      "invalid Thread root count",
    ),
  };
}

function formatInvalidLegacyStats(stats) {
  return [
    `missing sites=${stats.missingSiteCount}`,
    `missing posts=${stats.missingPostCount}`,
    `missing Collections=${stats.missingCollectionCount}`,
    `invalid Thread roots=${stats.invalidThreadCount}`,
  ].join(", ");
}

function assertLegacyStats(stats) {
  if (
    stats.missingSiteCount > 0 ||
    stats.missingPostCount > 0 ||
    stats.missingCollectionCount > 0 ||
    stats.invalidThreadCount > 0
  ) {
    throw new Error(
      `Thread Collection migration preflight failed (${formatInvalidLegacyStats(stats)}). No migration was applied. Repair or restore the legacy data, then run jant migrate again.`,
    );
  }
}

function assertTargetStats(stats, expectedCount) {
  const invalidReferences =
    stats.missingSiteCount > 0 ||
    stats.missingThreadCount > 0 ||
    stats.missingCollectionCount > 0 ||
    stats.invalidThreadCount > 0;
  const countMismatch =
    expectedCount !== undefined && stats.targetCount !== expectedCount;

  if (invalidReferences || countMismatch) {
    const expected =
      expectedCount === undefined ? "not recorded" : String(expectedCount);
    throw new Error(
      `Thread Collection post-migration verification failed (expected rows=${expected}, actual rows=${stats.targetCount}, missing sites=${stats.missingSiteCount}, missing Threads=${stats.missingThreadCount}, missing Collections=${stats.missingCollectionCount}, invalid Thread roots=${stats.invalidThreadCount}). The schema migration may already be committed; keep writes stopped and restore or inspect the database before retrying.`,
    );
  }
}

/**
 * Validate legacy Collection membership before the destructive table cutover.
 *
 * @param {{ dialect: "pg" | "sqlite", log?: (message: string) => void, query: (sql: string) => unknown[] | Promise<unknown[]> }} options
 * @returns {Promise<{ expectedCount?: number, phase: "already-migrated" | "deferred" | "fresh" | "legacy", sourceCount?: number }>}
 */
export async function preflightThreadCollectionMigration(options) {
  const log = options.log ?? console.log;
  const state = await readTableState(options.query, options.dialect);

  if (state.legacyExists && state.targetExists) {
    throw new Error(
      "Thread Collection migration preflight found both post_collection and thread_collection. No migration was applied. Inspect the migration journal and database state before retrying.",
    );
  }

  if (state.targetExists) {
    const stats = await readTargetStats(options.query);
    assertTargetStats(stats, undefined);
    log(
      `Thread Collection migration already applied (${stats.targetCount} memberships verified).`,
    );
    return { phase: "already-migrated" };
  }

  if (!state.legacyExists) {
    return { phase: "fresh" };
  }

  const postColumns = await readPostColumns(options.query, options.dialect);
  if (!hasThreadColumns(postColumns)) {
    log(
      "Thread Collection migration preflight deferred until earlier schema migrations add Thread columns.",
    );
    return { phase: "deferred" };
  }

  const stats = await readLegacyStats(options.query, postColumns);
  assertLegacyStats(stats);
  const softDeletedMembershipLabel =
    stats.softDeletedSourceCount === 1 ? "membership" : "memberships";
  const anticipatedDeletion =
    stats.softDeletedSourceCount > 0
      ? `; ${stats.softDeletedSourceCount} soft-deleted post ${softDeletedMembershipLabel} will be removed by an earlier migration`
      : "";
  log(
    `Thread Collection migration preflight passed (${stats.sourceCount} post memberships -> ${stats.expectedCount} Thread memberships${anticipatedDeletion}).`,
  );
  log(
    "Thread Collection cutover requires writes to remain stopped until migration, application deployment, and verification finish.",
  );
  return {
    phase: "legacy",
    expectedCount: stats.expectedCount,
    sourceCount: stats.sourceCount,
  };
}

/**
 * Verify the replacement table after the formal schema migrator returns.
 *
 * @param {{ dialect: "pg" | "sqlite", log?: (message: string) => void, query: (sql: string) => unknown[] | Promise<unknown[]> }} options
 * @param {{ expectedCount?: number, phase: "already-migrated" | "deferred" | "fresh" | "legacy", sourceCount?: number }} preflight
 * @returns {Promise<void>}
 */
export async function verifyThreadCollectionMigration(options, preflight) {
  const log = options.log ?? console.log;
  const state = await readTableState(options.query, options.dialect);

  if (state.legacyExists || !state.targetExists) {
    throw new Error(
      `Thread Collection post-migration verification failed (post_collection exists=${state.legacyExists}, thread_collection exists=${state.targetExists}). The schema migration may already be partially applied; keep writes stopped and inspect the database before retrying.`,
    );
  }

  const stats = await readTargetStats(options.query);
  assertTargetStats(stats, preflight.expectedCount);
  log(
    `Thread Collection post-migration verification passed (${stats.targetCount} memberships).`,
  );
}
