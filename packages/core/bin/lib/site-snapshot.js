import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

export const SNAPSHOT_FORMAT = "jant-site-snapshot";
export const SNAPSHOT_VERSION = 2;
export const SUPPORTED_SNAPSHOT_VERSIONS = [1, SNAPSHOT_VERSION];

/**
 * Site content, in the order rows are inserted on import.
 *
 * Membership is what this list decides: a table absent from it is never read,
 * so its rows leave no trace in the snapshot and `--replace` cannot clear them.
 *
 * The order here is kept as a foreign-key topological sort for readability, but
 * it is not what an export follows — `sortExportTables` re-sorts by
 * `TABLE_EXPORT_ORDER` in `sql-export.js`, and that is the list to change when
 * the dump order has to change. `src/__tests__/snapshot-tables.test.ts` checks
 * the sorted result for that reason.
 */
export const SNAPSHOT_TABLES = [
  "site_setting",
  "collection",
  "smart_collection",
  "post",
  "thread_collection",
  "nav_item",
  "collection_directory_item",
  "path_registry",
  "media",
];

/**
 * The same content, in the order `--replace` deletes it: children first, so no
 * delete depends on a cascade to clean up after it. `site_setting` is absent on
 * purpose — `buildReplaceSql` clears it by key, because a site's settings hold
 * more than the snapshot carries.
 */
export const SNAPSHOT_CLEAR_TABLES = [
  "media",
  "path_registry",
  "collection_directory_item",
  "nav_item",
  "thread_collection",
  "post",
  "smart_collection",
  "collection",
];

/**
 * Site-scoped tables the snapshot deliberately leaves alone.
 *
 * Every table carrying a `site_id` has to appear here or in `SNAPSHOT_TABLES`
 * — `src/__tests__/snapshot-tables.test.ts` fails the build otherwise, so a new
 * table forces a decision rather than being silently dropped. The reasons fall
 * into three groups: auth and routing shell that a content restore must
 * preserve, credentials and external integration bindings that do not travel
 * with content, and transient runtime bookkeeping.
 */
export const SNAPSHOT_EXCLUDED_TABLES = [
  // Auth and routing shell. `--replace` restores content into an existing
  // site; its members and domains belong to the deployment, not the content.
  "site_member",
  "site_domain",
  // Credentials. Reissued per deployment, never copied between sites. The demo
  // rebuild clears these through the internal admin route instead.
  "api_token",
  // External integration bindings. They point at an installation or a chat on
  // someone else's service, so restoring them into another site would aim that
  // site at a binding it does not own.
  "github_app_installation",
  "telegram_binding",
  "telegram_pending_binding",
  "telegram_media_group_item",
  // Transient runtime bookkeeping, rebuilt by the runtime as it goes:
  // in-flight uploads, and the recycle-window ledger for deleted objects.
  "upload_session",
  "storage_purge",
];

/**
 * Settings the snapshot carries: the site's published identity and appearance.
 *
 * `site_setting` holds more than a site's content — deployment wiring, secrets,
 * integration bindings, local UI state — so both the export and `--replace`
 * work through this allowlist rather than the whole table. Membership is what
 * it decides: a key absent from it is neither exported nor cleared on import.
 *
 * Every DB-backed key in `CONFIG_FIELDS` has to appear here or in
 * `SNAPSHOT_EXCLUDED_SETTING_KEYS`, and
 * `src/__tests__/snapshot-settings.test.ts` fails the build otherwise, so a new
 * setting forces a decision instead of being silently dropped.
 */
export const SNAPSHOT_SETTING_KEYS = [
  "SITE_NAME",
  "SITE_DESCRIPTION",
  // The language trio travels together. `post.language` and
  // `post.translation_group_id` are already carried by the whole-row `post`
  // dump, so leaving the switch behind restored a site whose posts were
  // stamped per language while every per-language view was gone.
  "SITE_LANGUAGE",
  "MULTILINGUAL_ENABLED",
  "ADDITIONAL_LANGUAGES",
  "MAIN_RSS_FEED",
  "PUBLIC_API_ENABLED",
  "RSS_FEEDS_ENABLED",
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

/**
 * DB-backed settings the snapshot deliberately leaves alone.
 *
 * `envOnly` keys are absent from both lists on purpose: they never reach
 * `site_setting`, so there is no row to carry or clear.
 */
export const SNAPSHOT_EXCLUDED_SETTING_KEYS = [
  // The operator's own dashboard locale, not the site's published language.
  // A content restore should not relabel the dashboard of whoever runs the
  // target site.
  "DASHBOARD_LANGUAGE",
  // Sizing and pacing knobs. They describe how much the target deployment
  // serves at a time, not what it publishes, and they carry env defaults the
  // deployment picked.
  "ARCHIVE_DEFAULT_LAYOUT",
  "PAGE_SIZE",
  "SEARCH_PAGE_SIZE",
  "ARCHIVE_PAGE_SIZE",
  "SUMMARY_MAX_PARAGRAPHS",
  "SUMMARY_MAX_CHARS",
  "RSS_FEED_LIMIT",
  "RSS_PUBLISH_DELAY_SECONDS",
  // Code injection. `CUSTOM_CSS` is declarative and travels; these two are
  // executable markup, and importing an archive must not be a way to run
  // script on the importing site.
  "CUSTOM_HEAD_HTML",
  "CUSTOM_BODY_END_HTML",
  // Being listed in the Jant Discover directory is the site owner's consent,
  // and the announcement state below it belongs to the announcing instance.
  "DISCOVER",
  "DISCOVER_ANNOUNCE_STATE",
  // Local UI state: which affordances this author has already been shown, and
  // how far setup got.
  "DISCOVERY_COMPOSE_OPEN_SHORTCUT_AT",
  "DISCOVERY_SLASH_COMMAND_AT",
  "ONBOARDING_STATUS",
  // Credential. Reissued per deployment, never copied between sites.
  "PASSWORD_RESET_TOKEN",
  // External integration bindings, their secrets, and their sync bookkeeping.
  // They point at a repo, an installation, or a chat on someone else's
  // service, so restoring them would aim the target site at a binding it does
  // not own — the same reason `github_app_installation` and `telegram_binding`
  // are excluded tables.
  "GITHUB_SYNC_ENABLED",
  "GITHUB_SYNC_REPO",
  "GITHUB_SYNC_TOKEN",
  "GITHUB_SYNC_WEBHOOK_SECRET",
  "GITHUB_SYNC_WEBHOOK_ID",
  "GITHUB_SYNC_LAST_PUSH_SHA",
  "GITHUB_SYNC_LAST_PUSH_AT",
  "GITHUB_SYNC_PENDING",
  "GITHUB_SYNC_PENDING_AT",
  "GITHUB_SYNC_DIRTY",
  "GITHUB_SYNC_LAST_ERROR",
  "GITHUB_SYNC_AUTH_MODE",
  "GITHUB_SYNC_APP_INSTALLATION_ID",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_BOT_ID",
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_BOT_WEBHOOK_SECRET",
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
  smart_collection: `
    SELECT *
    FROM "smart_collection"
    WHERE "site_id" = ?1
    ORDER BY "created_at", "id"
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

/**
 * SQL listing a site's stored media objects: originals and video posters.
 *
 * @param {string} siteId Site whose media rows to read
 * @returns {string} A query returning `key` and `contentType` columns
 * @example
 * collectSnapshotObjects(await query(buildSnapshotStorageQuery(site.id)))
 */
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

/**
 * A storage object a snapshot carries.
 *
 * @typedef {object} SnapshotObject
 * @property {string} key Storage key
 * @property {string} contentType MIME type, or `""` when neither the row nor
 *   the key's extension gives one
 */

/**
 * Deduplicate the rows of `buildSnapshotStorageQuery` into storage objects.
 *
 * Rows with a blank key are skipped. A row without a content type takes one
 * from the key's extension.
 *
 * @param {Record<string, unknown>[]} rows Rows with `key` and `contentType`
 * @returns {SnapshotObject[]} One entry per distinct key
 * @example
 * collectSnapshotObjects([{ key: "media/a.png", contentType: null }])
 * // => [{ key: "media/a.png", contentType: "image/png" }]
 */
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

/**
 * A snapshot's `meta.json`, as `assertSnapshotMeta` accepts it.
 *
 * @typedef {object} SnapshotMeta
 * @property {typeof SNAPSHOT_FORMAT} format
 * @property {number} version One of `SUPPORTED_SNAPSHOT_VERSIONS`
 * @property {"sqlite" | "pg"} [dialect] Absent from snapshots that predate it
 * @property {{ id: string, key: string }} [site] The site the snapshot was
 *   exported from; absent from legacy snapshots
 * @property {unknown} [tables] Listed by legacy snapshots only
 */

/**
 * Refuse a `meta.json` this version cannot import.
 *
 * @param {unknown} meta Parsed `meta.json`
 * @returns {asserts meta is SnapshotMeta}
 * @throws {Error} When the format, version, dialect, or site is not supported
 * @example
 * const meta = JSON.parse(await readFile(metaPath, "utf8"));
 * assertSnapshotMeta(meta);
 */
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
        "Use `jant site export --url <url>` (HTTP, dialect-neutral) to move content between",
        "different DB engines.",
      ].join("\n"),
    );
  }
}

export function isLegacySnapshotMeta(meta) {
  const tables = Array.isArray(meta?.tables) ? meta.tables : [];
  return !meta?.site || tables.includes("setting");
}

/**
 * The site a snapshot was exported from, for creating or remapping the target.
 *
 * @param {SnapshotMeta} meta Snapshot meta accepted by `assertSnapshotMeta`
 * @returns {{ id: string, key: string } | undefined} The source site, or
 *   undefined for a legacy snapshot, which records none
 * @example
 * const snapshotSite = getSnapshotBootstrapSite(meta);
 */
export function getSnapshotBootstrapSite(meta) {
  if (isLegacySnapshotMeta(meta)) {
    return undefined;
  }

  return {
    id: meta.site.id,
    key: meta.site.key,
  };
}

/**
 * Refuse to import a snapshot into a site other than the one it came from.
 *
 * Legacy snapshots record no site and pass.
 *
 * @param {SnapshotMeta} meta Snapshot meta accepted by `assertSnapshotMeta`
 * @param {{ id: string }} site The import target
 * @returns {void}
 * @throws {Error} When the snapshot names a different site
 * @example
 * validateSnapshotTargetSite(meta, targetSite);
 */
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

/**
 * Replace a snapshot's source site id with the target's throughout its SQL.
 *
 * @param {string} sql Snapshot `db.sql`
 * @param {string} sourceSiteId Site the snapshot was exported from; empty
 *   leaves the SQL unchanged
 * @param {string} targetSiteId Site the snapshot is imported into
 * @returns {string} The rewritten SQL
 * @example
 * rewriteSnapshotSiteIdentifiers(dbSql, snapshotSite.id, targetSite.id)
 */
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

/**
 * Move a storage key from the source site's namespace to the target's.
 *
 * @param {string} key Storage key as exported
 * @param {string} sourceSiteId Site the snapshot was exported from; empty
 *   leaves the key unchanged
 * @param {string} targetSiteId Site the snapshot is imported into
 * @returns {string} The key to store the object under
 * @example
 * remapSnapshotObjectKey(entry.key, snapshotSite.id, targetSite.id)
 */
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
 *
 * @param {string} rootDir Snapshot directory
 * @returns {Promise<{ key: string, filePath: string, contentType: string }[]>}
 *   Files sorted by key; empty when there is no `objects/` directory
 * @example
 * const objectFiles = await enumerateSnapshotObjectFiles(snapshotDir);
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
  let state = "sql";

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];

    if (state === "line-comment") {
      if (char === "\n") {
        current += char;
        state = "sql";
      }
      continue;
    }

    if (state === "block-comment") {
      if (char === "*" && sql[index + 1] === "/") {
        index += 1;
        state = "sql";
      } else if (char === "\n") {
        current += char;
      }
      continue;
    }

    if (state === "string") {
      current += char;
      if (char === "'" && sql[index + 1] === "'") {
        current += "'";
        index += 1;
        continue;
      }
      if (char === "'") {
        state = "sql";
      }
      continue;
    }

    if (state === "identifier") {
      current += char;
      if (char === '"' && sql[index + 1] === '"') {
        current += '"';
        index += 1;
        continue;
      }
      if (char === '"') {
        state = "sql";
      }
      continue;
    }

    if (char === "'") {
      current += char;
      state = "string";
      continue;
    }

    if (char === '"') {
      current += char;
      state = "identifier";
      continue;
    }

    if (char === "-" && sql[index + 1] === "-") {
      if (current && !/\s$/.test(current)) {
        current += " ";
      }
      index += 1;
      state = "line-comment";
      continue;
    }

    if (char === "/" && sql[index + 1] === "*") {
      if (current && !/\s$/.test(current)) {
        current += " ";
      }
      index += 1;
      state = "block-comment";
      continue;
    }

    if (char === ";") {
      const trimmed = current.trim();
      if (trimmed) {
        statements.push(trimmed);
      }
      current = "";
      continue;
    }

    current += char;
  }

  if (state === "string" || state === "identifier") {
    throw new Error("Snapshot SQL contains an unterminated quoted value.");
  }
  if (state === "block-comment") {
    throw new Error("Snapshot SQL contains an unterminated block comment.");
  }

  const trimmed = current.trim();
  if (trimmed) {
    statements.push(trimmed);
  }

  return statements;
}

/**
 * Scope a legacy single-site dump to a site: global `setting` rows become
 * `site_setting` rows, and site-owned tables gain a `site_id` column.
 *
 * @param {string} sql Legacy snapshot `db.sql`
 * @param {string} siteId Site the snapshot is imported into
 * @returns {string} Site-scoped SQL
 * @example
 * rewriteLegacySnapshotSql(dbSql, targetSite.id)
 */
export function rewriteLegacySnapshotSql(sql, siteId) {
  const rewrittenStatements = splitSqlStatements(sql).map((statement) => {
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
  });

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
  const statements = splitSqlStatements(sql);
  const postsById = new Map();
  const collectionIds = new Set();

  for (const statement of statements) {
    const insert = parseInsertStatement(statement);
    const table = insert?.table.toLowerCase();
    if (table === "collection") {
      const siteId = readRequiredSqlString(insert, "site_id", "collection row");
      const collectionId = readRequiredSqlString(
        insert,
        "id",
        "collection row",
      );
      collectionIds.add(`${siteId}\u0000${collectionId}`);
      continue;
    }
    if (table !== "post") {
      continue;
    }
    const siteId = readRequiredSqlString(insert, "site_id", "post row");
    const postId = readRequiredSqlString(insert, "id", "post row");
    const threadId = readRequiredSqlString(insert, "thread_id", "post row");
    const replyToId = parseSqlScalar(insert.values.get("reply_to_id"));
    if (replyToId !== null && typeof replyToId !== "string") {
      throw new Error("Snapshot post row has invalid reply_to_id.");
    }
    postsById.set(`${siteId}\u0000${postId}`, {
      id: postId,
      replyToId,
      threadId,
    });
  }

  const memberships = new Map();
  let lastDependencyIndex = -1;
  const retainedStatements = [];

  for (const statement of statements) {
    const insert = parseInsertStatement(statement);
    const table = insert?.table.toLowerCase();
    if (table === "collection" || table === "post") {
      lastDependencyIndex = retainedStatements.length;
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
    const post = postsById.get(`${siteId}\u0000${postId}`);
    if (!post) {
      throw new Error(
        `Snapshot post_collection row references missing post ${postId}; target content was not changed.`,
      );
    }
    if (!collectionIds.has(`${siteId}\u0000${collectionId}`)) {
      throw new Error(
        `Snapshot post_collection row references missing Collection ${collectionId}; target content was not changed.`,
      );
    }

    const threadId = post.threadId;
    const root = postsById.get(`${siteId}\u0000${threadId}`);
    if (!root) {
      throw new Error(
        `Snapshot post_collection row references missing Thread root ${threadId}; target content was not changed.`,
      );
    }
    if (root.id !== root.threadId || root.replyToId !== null) {
      throw new Error(
        `Snapshot post_collection row references invalid Thread root ${threadId}; target content was not changed.`,
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
  retainedStatements.splice(lastDependencyIndex + 1, 0, ...upgradedStatements);
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
  const statements = splitSqlStatements(sql);
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

/**
 * SQL clearing a site's snapshot content before a replacing import.
 *
 * @param {string} siteId Site to clear
 * @returns {string} `DELETE` statements for every `SNAPSHOT_CLEAR_TABLES`
 *   table and the snapshot's setting keys
 * @example
 * await execute(`${buildReplaceSql(site.id)}\n${dbSql}`);
 */
/**
 * Order `post` rows so every row comes after its Thread root and the post it
 * replies to.
 *
 * The dump reads posts by creation time, and `(site_id, thread_id)` and
 * `(site_id, reply_to_id)` are foreign keys. A post moved into a Thread keeps
 * its own creation time, and an import restores creation times, so a reply
 * can be older than its root; inserted in creation order it names a row that
 * isn't there yet, and the whole import fails. Otherwise the order is kept.
 *
 * @param {Record<string, unknown>[]} rows - `post` rows in dump order
 * @returns {Record<string, unknown>[]} The same rows, parents first
 * @example
 * orderSnapshotPostRows([reply, root]); // [root, reply]
 */
export function orderSnapshotPostRows(rows) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const placed = new Set();
  const ordered = [];

  const place = (row, visiting) => {
    if (placed.has(row.id) || visiting.has(row.id)) return;
    visiting.add(row.id);
    for (const parentId of [row.thread_id, row.reply_to_id]) {
      const parent = parentId !== row.id ? byId.get(parentId) : undefined;
      if (parent) place(parent, visiting);
    }
    placed.add(row.id);
    ordered.push(row);
  };

  for (const row of rows) place(row, new Set());
  return ordered;
}

/**
 * SQL a snapshot import runs before its inserts on SQLite and D1: foreign
 * keys are checked at commit rather than per row, so a snapshot written
 * before posts were ordered parents-first still loads. Postgres has no
 * equivalent for its non-deferrable keys; its snapshots are ordered at export.
 */
export const DEFER_FOREIGN_KEYS_SQL = "PRAGMA defer_foreign_keys = ON;";

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

/** The storage drivers a `media` row can name as its `provider`. */
const MEDIA_STORAGE_PROVIDERS = ["r2", "s3", "local"];

/**
 * SQL recording a site's media under the storage an import just wrote it to.
 *
 * A snapshot carries each media row's `provider` from the site it was exported
 * from, but the import uploads every object into the target's own storage. A
 * row exported on R2 and imported into S3 would still say `r2`, and everything
 * that reads `provider` as where the bytes live goes wrong: the public URL looks
 * for `R2_PUBLIC_URL`, replacing the avatar or favicon misses the existing row
 * and inserts a second one for the same key, and a trashed object is never
 * purged because the sweep only handles the active driver. Run after the
 * snapshot's inserts, while every media row of the site is one the snapshot
 * brought.
 *
 * @param {string} siteId - Site whose media was imported
 * @param {string} provider - Storage driver the import uploaded through
 * @returns {string} An `UPDATE` statement for the site's media rows
 * @throws {Error} When `provider` is not one of r2, s3, or local
 * @example
 * await execute(
 *   `${buildReplaceSql(site.id)}\n${dbSql}\n${buildMediaProviderSql(site.id, "s3")}`,
 * );
 */
export function buildMediaProviderSql(siteId, provider) {
  if (!MEDIA_STORAGE_PROVIDERS.includes(provider)) {
    throw new Error(
      `Snapshot import cannot record media under storage driver "${provider}". Expected one of: ${MEDIA_STORAGE_PROVIDERS.join(", ")}.`,
    );
  }

  return `UPDATE "media" SET "provider" = '${provider}' WHERE "site_id" = '${escapeSqlString(siteId)}';`;
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
