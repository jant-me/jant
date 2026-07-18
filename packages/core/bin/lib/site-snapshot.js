import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

export const SNAPSHOT_FORMAT = "jant-site-snapshot";
export const SNAPSHOT_VERSION = 2;
export const SUPPORTED_SNAPSHOT_VERSIONS = [1, SNAPSHOT_VERSION];

export const SNAPSHOT_TABLES = [
  "site_setting",
  "collection",
  "nav_item",
  "collection_directory_item",
  "post",
  "thread_collection",
  "path_registry",
  "media",
];

export const SNAPSHOT_CLEAR_TABLES = [
  "thread_collection",
  "media",
  "path_registry",
  "collection_directory_item",
  "nav_item",
  "post",
  "collection",
];

export const SNAPSHOT_SETTING_KEYS = [
  "SITE_NAME",
  "SITE_DESCRIPTION",
  "SITE_LANGUAGE",
  "MAIN_RSS_FEED",
  "THEME",
  "CUSTOM_CSS",
  "SITE_AVATAR",
  "SHOW_HEADER_AVATAR",
  "SITE_FAVICON_ICO",
  "SITE_FAVICON_APPLE_TOUCH",
  "SITE_FAVICON_VERSION",
  "FONT_THEME",
  "THEME_MODE",
  "TIME_ZONE",
  "SITE_FOOTER",
  "SHOW_JANT_BRANDING_ON_HOME",
  "NOINDEX",
];

function escapeSqlString(value) {
  return String(value).replaceAll("'", "''");
}

const SELECT_SQL_BY_TABLE = {
  site_setting: `
    SELECT *
    FROM "site_setting"
    WHERE "site_id" = ?1
      AND "key" IN (${quoteList(SNAPSHOT_SETTING_KEYS)})
    ORDER BY "key"
  `,
  collection: `
    SELECT *
    FROM "collection"
    WHERE "site_id" = ?1
    ORDER BY "created_at", "id"
  `,
  nav_item: `
    SELECT *
    FROM "nav_item"
    WHERE "site_id" = ?1
    ORDER BY "position", "id"
  `,
  collection_directory_item: `
    SELECT *
    FROM "collection_directory_item"
    WHERE "site_id" = ?1
    ORDER BY "position", "id"
  `,
  post: `
    SELECT *
    FROM "post"
    WHERE "site_id" = ?1
    ORDER BY "created_at", "id"
  `,
  thread_collection: `
    SELECT *
    FROM "thread_collection"
    WHERE "site_id" = ?1
    ORDER BY "created_at", "thread_id", "collection_id"
  `,
  path_registry: `
    SELECT *
    FROM "path_registry"
    WHERE "site_id" = ?1
    ORDER BY "path", "id"
  `,
  media: `
    SELECT *
    FROM "media"
    WHERE "site_id" = ?1
    ORDER BY "created_at", "id"
  `,
};

export function quoteList(values) {
  return values
    .map((value) => `'${String(value).replaceAll("'", "''")}'`)
    .join(", ");
}

export function getSnapshotSelectSql(tableName, siteId) {
  const statement = SELECT_SQL_BY_TABLE[tableName];
  if (!statement) {
    throw new Error(`Unsupported snapshot table: ${tableName}`);
  }
  return statement.trim().replaceAll("?1", `'${escapeSqlString(siteId)}'`);
}

export function buildSnapshotStorageQuery(siteId) {
  return `
    SELECT "key", "contentType"
    FROM (
      SELECT
        "storage_key" AS "key",
        "mime_type" AS "contentType"
      FROM "media"
      WHERE "storage_key" IS NOT NULL
        AND "site_id" = '${escapeSqlString(siteId)}'
        AND trim("storage_key") <> ''

      UNION ALL

      SELECT
        "poster_key" AS "key",
        NULL AS "contentType"
      FROM "media"
      WHERE "poster_key" IS NOT NULL
        AND "site_id" = '${escapeSqlString(siteId)}'
        AND trim("poster_key") <> ''
    )
    WHERE "key" IS NOT NULL
      AND trim("key") <> ''
    ORDER BY "key"
  `.trim();
}

export function collectSnapshotObjects(rows) {
  const objects = new Map();

  for (const row of rows) {
    const key = typeof row.key === "string" ? row.key.trim() : "";
    if (!key) {
      continue;
    }

    const contentType =
      typeof row.contentType === "string" && row.contentType.trim()
        ? row.contentType.trim()
        : guessContentTypeFromKey(key);
    const existing = objects.get(key);
    if (!existing) {
      objects.set(key, { key, contentType });
      continue;
    }

    if (!existing.contentType && contentType) {
      existing.contentType = contentType;
    }
  }

  return [...objects.values()];
}

export function snapshotObjectPath(key) {
  return `objects/${key}`.replace(/\\/g, "/");
}

export const SNAPSHOT_DIALECTS = ["sqlite", "pg"];

export function buildSnapshotMeta(site, options = {}) {
  const dialect = options.dialect;
  if (dialect && !SNAPSHOT_DIALECTS.includes(dialect)) {
    throw new Error(
      `Unsupported snapshot dialect: ${dialect}. Expected one of ${SNAPSHOT_DIALECTS.join(", ")}.`,
    );
  }

  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    ...(dialect ? { dialect } : {}),
    site: {
      id: site.id,
      key: site.key,
    },
  };
}

export function assertSnapshotMeta(meta) {
  if (!meta || typeof meta !== "object") {
    throw new Error("Snapshot meta.json is missing or invalid.");
  }

  if (meta.format !== SNAPSHOT_FORMAT) {
    throw new Error(
      `Unsupported snapshot format: expected ${SNAPSHOT_FORMAT}, got ${String(meta.format)}`,
    );
  }

  if (!SUPPORTED_SNAPSHOT_VERSIONS.includes(meta.version)) {
    throw new Error(
      `Unsupported snapshot version: expected one of ${SUPPORTED_SNAPSHOT_VERSIONS.join(", ")}, got ${String(meta.version)}`,
    );
  }

  if (meta.dialect !== undefined && !SNAPSHOT_DIALECTS.includes(meta.dialect)) {
    throw new Error(
      `Snapshot meta has unsupported dialect "${String(meta.dialect)}". Expected one of ${SNAPSHOT_DIALECTS.join(", ")}.`,
    );
  }

  if (
    meta.site !== undefined &&
    (!meta.site ||
      typeof meta.site !== "object" ||
      typeof meta.site.id !== "string" ||
      typeof meta.site.key !== "string")
  ) {
    throw new Error("Snapshot meta site must contain string id and key.");
  }
}

/**
 * Read the snapshot's source dialect, if recorded.
 *
 * Older snapshots predate the `dialect` field — those return `undefined` and
 * the caller decides whether to skip the check or refuse with a clear error.
 */
export function getSnapshotDialect(meta) {
  return SNAPSHOT_DIALECTS.includes(meta?.dialect) ? meta.dialect : undefined;
}

/**
 * Refuse to apply a snapshot whose source dialect doesn't match the target.
 *
 * Cross-dialect db.sql is not safe to replay: SQLite and Postgres differ on
 * BLOB literals (`X'...'` vs `'\x...'`), boolean encoding (`0/1` vs `t/f`),
 * `tsvector`/`generated` columns, identifier quoting edge cases, etc. Better
 * to fail at the start of import than mid-way with a cryptic SQL error.
 */
export function assertSnapshotDialectMatches(meta, targetDialect) {
  const sourceDialect = getSnapshotDialect(meta);
  if (!sourceDialect) {
    return;
  }

  if (sourceDialect !== targetDialect) {
    throw new Error(
      [
        `Snapshot dialect mismatch: source is ${sourceDialect}, target is ${targetDialect}.`,
        "Snapshot db.sql is dialect-specific (BLOB literals, generated columns, FTS, etc.)",
        "and cannot be replayed across SQLite and Postgres safely.",
        "Use `jant site export <url>` (HTTP, dialect-neutral) to move content between",
        "different DB engines.",
      ].join("\n"),
    );
  }
}

export function isLegacySnapshotMeta(meta) {
  const tables = Array.isArray(meta?.tables) ? meta.tables : [];
  return !meta?.site || tables.includes("setting");
}

export function getSnapshotBootstrapSite(meta) {
  if (isLegacySnapshotMeta(meta)) {
    return undefined;
  }

  return {
    id: meta.site.id,
    key: meta.site.key,
  };
}

export function validateSnapshotTargetSite(meta, site) {
  if (isLegacySnapshotMeta(meta)) {
    return;
  }

  if (meta.site.id !== site.id) {
    throw new Error(
      `Snapshot site "${meta.site.id}" does not match target site "${site.id}".`,
    );
  }
}

export function rewriteSnapshotSiteIdentifiers(
  sql,
  sourceSiteId,
  targetSiteId,
) {
  if (!sourceSiteId || sourceSiteId === targetSiteId) {
    return sql;
  }

  const escapedSource = escapeSqlString(sourceSiteId);
  const escapedTarget = escapeSqlString(targetSiteId);
  return sql.replaceAll(escapedSource, escapedTarget);
}

export function remapSnapshotObjectKey(key, sourceSiteId, targetSiteId) {
  if (!sourceSiteId || sourceSiteId === targetSiteId) {
    return key;
  }
  return String(key).replaceAll(sourceSiteId, targetSiteId);
}

/**
 * Walks `<rootDir>/objects/` recursively and returns one entry per file.
 *
 * The relative path inside `objects/` is the storage key as it existed at
 * export time (with forward slashes). If the snapshot was produced by a
 * different site than the import target, callers apply
 * `remapSnapshotObjectKey()` before uploading.
 */
export async function enumerateSnapshotObjectFiles(rootDir) {
  const objectsRoot = join(rootDir, "objects");
  const entries = [];

  async function walk(dir) {
    let items;
    try {
      items = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }

    for (const item of items) {
      const fullPath = join(dir, item.name);
      if (item.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      const key = relative(objectsRoot, fullPath).replace(/\\/g, "/");
      entries.push({
        key,
        filePath: fullPath,
        contentType: guessContentTypeFromKey(key),
      });
    }
  }

  await walk(objectsRoot);
  entries.sort((a, b) => a.key.localeCompare(b.key));
  return entries;
}

function prependSiteIdInsert(sql, tableName, siteId) {
  const match = sql.match(
    new RegExp(
      `^INSERT INTO "?${tableName}"? \\(([^)]*)\\) VALUES\\(([\\s\\S]*)\\)$`,
      "i",
    ),
  );
  if (!match) {
    return sql;
  }

  return `INSERT INTO "${tableName}" ("site_id", ${match[1]}) VALUES('${escapeSqlString(siteId)}', ${match[2]})`;
}

function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let inString = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    if (char === "'") {
      current += char;
      if (inString && sql[index + 1] === "'") {
        current += "'";
        index += 1;
        continue;
      }
      inString = !inString;
      continue;
    }

    if (char === ";" && !inString) {
      const trimmed = current.trim();
      if (trimmed) {
        statements.push(trimmed);
      }
      current = "";
      continue;
    }

    current += char;
  }

  const trimmed = current.trim();
  if (trimmed) {
    statements.push(trimmed);
  }

  return statements;
}

export function rewriteLegacySnapshotSql(sql, siteId) {
  const uncommentedSql = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

  const rewrittenStatements = splitSqlStatements(uncommentedSql).map(
    (statement) => {
      const normalized = statement.trim();
      const legacySettingMatch = normalized.match(
        /^INSERT INTO "?setting"? \(([^)]*)\) VALUES\(([\s\S]*)\)$/i,
      );
      if (legacySettingMatch) {
        return `INSERT INTO "site_setting" ("site_id", ${legacySettingMatch[1]}) VALUES('${escapeSqlString(siteId)}', ${legacySettingMatch[2]})`;
      }

      let rewritten = normalized;
      for (const tableName of [
        "collection",
        "nav_item",
        "collection_directory_item",
        "post",
        "post_collection",
        "thread_collection",
        "path_registry",
        "media",
      ]) {
        rewritten = prependSiteIdInsert(rewritten, tableName, siteId);
      }

      return rewritten;
    },
  );

  return `${rewrittenStatements.join(";\n")};\n`;
}

function parseInsertStatement(statement) {
  const match = statement.match(
    /^INSERT\s+INTO\s+"?([^"\s]+)"?\s*\(([^)]*)\)\s*VALUES\s*\(([\s\S]*)\)$/i,
  );
  if (!match) {
    return null;
  }

  const columns = match[2]
    .split(",")
    .map((column) => column.trim().replace(/^"|"$/g, ""));
  const values = parseSqlValueList(match[3]);
  if (columns.length !== values.length) {
    throw new Error(
      `Snapshot INSERT for ${match[1]} has ${columns.length} columns but ${values.length} values.`,
    );
  }

  return {
    table: match[1],
    values: new Map(columns.map((column, index) => [column, values[index]])),
  };
}

function readRequiredSqlString(insert, column, label) {
  const value = parseSqlScalar(insert.values.get(column));
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Snapshot ${label} is missing required ${column}.`);
  }
  return value;
}

function readSqlNumber(insert, column, fallback, label) {
  if (!insert.values.has(column)) {
    return fallback;
  }
  const value = parseSqlScalar(insert.values.get(column));
  if (value === null && fallback === null) {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Snapshot ${label} has invalid ${column}.`);
  }
  return number;
}

function formatSqlScalar(value) {
  if (value === null) {
    return "NULL";
  }
  if (typeof value === "number") {
    return String(value);
  }
  return `'${escapeSqlString(value)}'`;
}

/**
 * Upgrade a v1 snapshot dump from per-post Collection rows to the explicit
 * v2 Thread model. The conversion happens entirely in memory so callers can
 * fail before clearing any target tables.
 *
 * Memberships from every post in a Thread are unioned. Duplicate metadata
 * uses MAX(created_at), MAX(pinned_at), and MIN(position), matching the live
 * schema migration.
 *
 * @param {string} sql v1 snapshot SQL after site-id rewriting
 * @returns {string} replayable v2 SQL containing `thread_collection` rows
 * @example
 * upgradeV1SnapshotSql(v1DbSql)
 */
export function upgradeV1SnapshotSql(sql) {
  const uncommentedSql = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  const statements = splitSqlStatements(uncommentedSql);
  const postThreadIds = new Map();

  for (const statement of statements) {
    const insert = parseInsertStatement(statement);
    if (insert?.table.toLowerCase() !== "post") {
      continue;
    }
    const siteId = readRequiredSqlString(insert, "site_id", "post row");
    const postId = readRequiredSqlString(insert, "id", "post row");
    const threadId = readRequiredSqlString(insert, "thread_id", "post row");
    postThreadIds.set(`${siteId}\u0000${postId}`, threadId);
  }

  const memberships = new Map();
  let lastPostIndex = -1;
  const retainedStatements = [];

  for (const statement of statements) {
    const insert = parseInsertStatement(statement);
    const table = insert?.table.toLowerCase();
    if (table === "post") {
      lastPostIndex = retainedStatements.length;
    }
    if (table !== "post_collection") {
      retainedStatements.push(statement.trim());
      continue;
    }

    const siteId = readRequiredSqlString(
      insert,
      "site_id",
      "post_collection row",
    );
    const postId = readRequiredSqlString(
      insert,
      "post_id",
      "post_collection row",
    );
    const collectionId = readRequiredSqlString(
      insert,
      "collection_id",
      "post_collection row",
    );
    const threadId = postThreadIds.get(`${siteId}\u0000${postId}`);
    if (!threadId) {
      throw new Error(
        `Snapshot post_collection row references missing post ${postId}; target content was not changed.`,
      );
    }

    const createdAt = readSqlNumber(
      insert,
      "created_at",
      0,
      "post_collection row",
    );
    const position = readSqlNumber(
      insert,
      "position",
      0,
      "post_collection row",
    );
    const pinnedAt = readSqlNumber(
      insert,
      "pinned_at",
      null,
      "post_collection row",
    );
    const key = `${siteId}\u0000${threadId}\u0000${collectionId}`;
    const current = memberships.get(key);
    if (!current) {
      memberships.set(key, {
        siteId,
        threadId,
        collectionId,
        createdAt,
        position,
        pinnedAt,
      });
      continue;
    }

    current.createdAt = Math.max(current.createdAt, createdAt);
    current.position = Math.min(current.position, position);
    if (pinnedAt !== null) {
      current.pinnedAt =
        current.pinnedAt === null
          ? pinnedAt
          : Math.max(current.pinnedAt, pinnedAt);
    }
  }

  if (memberships.size === 0) {
    return sql;
  }

  const upgradedStatements = [...memberships.values()].map(
    (membership) =>
      `INSERT INTO "thread_collection" ("site_id", "thread_id", "collection_id", "created_at", "position", "pinned_at") VALUES(${[
        membership.siteId,
        membership.threadId,
        membership.collectionId,
        membership.createdAt,
        membership.position,
        membership.pinnedAt,
      ]
        .map(formatSqlScalar)
        .join(", ")})`,
  );
  retainedStatements.splice(lastPostIndex + 1, 0, ...upgradedStatements);
  return `${retainedStatements.join(";\n")};\n`;
}

/**
 * Apply format-version compatibility rewrites to snapshot SQL.
 *
 * @param {string} sql site-scoped snapshot SQL
 * @param {number} snapshotVersion version read from `meta.json`
 * @returns {string} SQL ready for the current schema
 * @example
 * upgradeSnapshotSql(dbSql, meta.version)
 */
export function upgradeSnapshotSql(sql, snapshotVersion) {
  return snapshotVersion === 1 ? upgradeV1SnapshotSql(sql) : sql;
}

/**
 * Pull the storage_key + poster_key values referenced by every media INSERT
 * inside a snapshot's `db.sql`.
 *
 * The dump format is controlled by `dumpDatabaseToSql`, which produces
 * `INSERT INTO "media" (col, ...) VALUES (val, ...);` statements with single
 * quoted string literals. We use the SQL-aware splitter to chunk the dump,
 * then parse each media INSERT via the column list. This is the import-side
 * "what should be on storage after this snapshot lands" question, used by
 * the preflight check that runs before db.sql is applied.
 */
export function extractMediaStorageKeysFromDumpSql(sql, sourceSiteId) {
  const uncommented = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  const statements = splitSqlStatements(uncommented);
  const keys = new Set();

  for (const statement of statements) {
    const match = statement.match(
      /INSERT\s+INTO\s+"?media"?\s*\(([^)]+)\)\s*VALUES\s*\(([\s\S]+)\)\s*;?\s*$/i,
    );
    if (!match) continue;

    const colNames = match[1]
      .split(",")
      .map((col) => col.trim().replace(/^"|"$/g, ""));
    const values = parseSqlValueList(match[2]);
    if (values.length !== colNames.length) continue;

    if (sourceSiteId) {
      const siteIdIdx = colNames.indexOf("site_id");
      if (siteIdIdx >= 0) {
        const siteIdVal = parseSqlScalar(values[siteIdIdx]);
        if (siteIdVal !== sourceSiteId) continue;
      }
    }

    for (const col of ["storage_key", "poster_key"]) {
      const idx = colNames.indexOf(col);
      if (idx < 0) continue;
      const value = parseSqlScalar(values[idx]);
      if (typeof value === "string" && value.trim() !== "") {
        keys.add(value);
      }
    }
  }

  return keys;
}

function parseSqlValueList(raw) {
  const values = [];
  let current = "";
  let inString = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "'") {
      current += char;
      if (inString && raw[index + 1] === "'") {
        current += "'";
        index += 1;
        continue;
      }
      inString = !inString;
      continue;
    }
    if (char === "," && !inString) {
      values.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  const tail = current.trim();
  if (tail) values.push(tail);
  return values;
}

function parseSqlScalar(raw) {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "" || /^null$/i.test(trimmed)) return null;
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed;
}

export function buildReplaceSql(siteId) {
  const statements = [];

  for (const tableName of SNAPSHOT_CLEAR_TABLES) {
    statements.push(
      `DELETE FROM "${tableName}" WHERE "site_id" = '${escapeSqlString(siteId)}';`,
    );
  }

  statements.push(
    `DELETE FROM "site_setting" WHERE "site_id" = '${escapeSqlString(siteId)}' AND "key" IN (${quoteList(SNAPSHOT_SETTING_KEYS)});`,
  );

  return statements.join("\n");
}

export function normalizeD1Sql(sql) {
  return sql
    .replace(/^\s*BEGIN(?:\s+TRANSACTION)?\s*;\s*$/gim, "")
    .replace(/^\s*COMMIT\s*;\s*$/gim, "")
    .replace(/^\s*ROLLBACK\s*;\s*$/gim, "")
    .trim();
}

export function guessContentTypeFromKey(key) {
  const normalized = String(key).toLowerCase();

  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (normalized.endsWith(".png")) {
    return "image/png";
  }
  if (normalized.endsWith(".gif")) {
    return "image/gif";
  }
  if (normalized.endsWith(".webp")) {
    return "image/webp";
  }
  if (normalized.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (normalized.endsWith(".avif")) {
    return "image/avif";
  }
  if (normalized.endsWith(".ico")) {
    return "image/x-icon";
  }
  if (normalized.endsWith(".mp4")) {
    return "video/mp4";
  }
  if (normalized.endsWith(".mp3")) {
    return "audio/mpeg";
  }
  if (normalized.endsWith(".ogg")) {
    return "audio/ogg";
  }
  if (normalized.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (normalized.endsWith(".json")) {
    return "application/json";
  }
  if (normalized.endsWith(".txt")) {
    return "text/plain";
  }

  return "";
}
