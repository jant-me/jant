/**
 * The order rows are dumped, and so the order they are replayed on import.
 *
 * It is a foreign-key topological sort: a table follows everything it points
 * at. `sortExportTables` applies it to whatever table list it is handed, so
 * this — not the caller's list — is what decides an export's order.
 *
 * A table missing from here is not an ordering no-op. Unknown names sort after
 * every known one, so a new child table lands at the end, behind its own
 * parents, and the dump only fails once there is a row to violate the
 * constraint. `snapshot-tables.test.ts` checks the sorted result, not the
 * caller's list, for that reason.
 */
export const TABLE_EXPORT_ORDER = [
  "site",
  "user",
  "account",
  "verification",
  "session",
  "site_domain",
  "site_setting",
  "site_member",
  "collection",
  // Before the three tables that hold a key into it: `nav_item`,
  // `collection_directory_item` and `path_registry`.
  "smart_collection",
  "api_token",
  "post",
  "thread_collection",
  // After `post`: a `page` nav item carries a `post_id`.
  "nav_item",
  "collection_directory_item",
  "path_registry",
  "media",
];

const EXCLUDED_TABLES = new Set([
  "__drizzle_migrations",
  "d1_migrations",
  "data_migration",
]);

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function sqlValue(value) {
  if (value === null) {
    return "NULL";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }

  if (typeof value === "bigint") {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }

  if (value instanceof Uint8Array) {
    return `X'${toHex(value)}'`;
  }

  if (value instanceof ArrayBuffer) {
    return `X'${toHex(new Uint8Array(value))}'`;
  }

  return `'${String(value).replaceAll("'", "''")}'`;
}

export function buildInsertStatement(tableName, columnNames, row) {
  const columns = columnNames.map(quoteIdentifier).join(", ");
  const values = columnNames.map((column) => sqlValue(row[column])).join(", ");
  return `INSERT INTO ${quoteIdentifier(tableName)} (${columns}) VALUES(${values});`;
}

export function sortExportTables(tableNames) {
  const order = new Map(
    TABLE_EXPORT_ORDER.map((table, index) => [table, index]),
  );

  return [...tableNames].sort((left, right) => {
    const leftIndex = order.get(left);
    const rightIndex = order.get(right);

    if (leftIndex !== undefined && rightIndex !== undefined) {
      return leftIndex - rightIndex;
    }

    if (leftIndex !== undefined) {
      return -1;
    }

    if (rightIndex !== undefined) {
      return 1;
    }

    return left.localeCompare(right);
  });
}

export async function listExportTables(queryRunner, dialect = "sqlite") {
  if (dialect === "pg") {
    const rows = await queryRunner.query(`
      SELECT table_name AS name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    return sortExportTables(
      rows
        .filter((row) => typeof row.name === "string" && row.name.length > 0)
        .filter((row) => !EXCLUDED_TABLES.has(row.name))
        .map((row) => row.name),
    );
  }

  const rows = await queryRunner.query(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `);

  return sortExportTables(
    rows
      .filter((row) => typeof row.name === "string" && row.name.length > 0)
      .filter((row) => !EXCLUDED_TABLES.has(row.name))
      .filter((row) => !String(row.name).startsWith("post_fts"))
      .filter(
        (row) => !String(row.sql ?? "").startsWith("CREATE VIRTUAL TABLE"),
      )
      .map((row) => row.name),
  );
}

export async function getTableColumns(
  queryRunner,
  tableName,
  dialect = "sqlite",
) {
  if (dialect === "pg") {
    // Skip GENERATED ALWAYS columns (e.g. post.search_text, post.search_document):
    // Postgres rejects any explicit value — even `DEFAULT` — on those, so they
    // must not appear in the INSERT column list. The target instance recomputes
    // them from the source columns when the row is inserted.
    const rows = await queryRunner.query(`
      SELECT column_name AS name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${sqlValue(tableName)}
        AND is_generated = 'NEVER'
      ORDER BY ordinal_position
    `);

    return rows.map((row) => String(row.name));
  }

  // SQLite doesn't currently use generated columns in this codebase, but
  // table_xinfo (a strict superset of table_info) exposes the `hidden`
  // flag (2 = VIRTUAL generated, 3 = STORED generated) so we filter those
  // out defensively if any are introduced later.
  const rows = await queryRunner.query(
    `PRAGMA table_xinfo(${quoteIdentifier(tableName)})`,
  );

  return rows
    .slice()
    .sort((left, right) => Number(left.cid) - Number(right.cid))
    .filter((row) => Number(row.hidden) !== 2 && Number(row.hidden) !== 3)
    .map((row) => String(row.name));
}

/**
 * Read an ordered SELECT a page at a time.
 *
 * `LIMIT … OFFSET …` is appended to the statement, so it must end in an
 * ORDER BY with a unique tiebreaker. Pages are separate reads: rows written
 * between two of them can be skipped or repeated, which is why a snapshot
 * should be taken of a site nobody is writing to.
 *
 * @param {{ query(sql: string): Promise<Record<string, unknown>[]> }} queryRunner
 * @param {string} selectSql - An ordered SELECT with no LIMIT
 * @param {number} pageSize - Rows per read
 * @returns {Promise<Record<string, unknown>[]>} Every row, in order
 * @example
 * await queryAllPages(runner, 'SELECT * FROM "post" ORDER BY rowid', 200);
 */
async function queryAllPages(queryRunner, selectSql, pageSize) {
  const base = selectSql.trim();
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await queryRunner.query(
      `${base} LIMIT ${pageSize} OFFSET ${offset}`,
    );
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

/**
 * Dump tables as INSERT statements.
 *
 * `options.pageSize` reads each table in pages. D1 needs it: every query runs
 * through `wrangler d1 execute --json`, and one SELECT of a real site's
 * `post` table outgrew the output the CLI can buffer.
 * `options.orderRowsByTable` reorders a table's rows before they are written,
 * for inserts that must follow their own foreign keys.
 */
export async function dumpDatabaseToSql(queryRunner, options) {
  const dialect = options.dialect ?? "sqlite";
  const pageSize =
    Number.isInteger(options.pageSize) && options.pageSize > 0
      ? options.pageSize
      : null;
  const onProgress =
    typeof options.onProgress === "function" ? options.onProgress : null;
  const configuredTables = Array.isArray(options.tables)
    ? sortExportTables(options.tables)
    : null;
  const tables =
    configuredTables ?? (await listExportTables(queryRunner, dialect));
  const timestamp = new Date().toISOString();
  let sql = `-- Jant database export\n`;
  sql += `-- Exported: ${timestamp}\n`;
  sql += `-- Source: ${options.source}\n\n`;

  for (const [tableIndex, tableName] of tables.entries()) {
    onProgress?.({
      index: tableIndex + 1,
      total: tables.length,
      table: tableName,
    });
    const columnNames = await getTableColumns(queryRunner, tableName, dialect);
    if (columnNames.length === 0) {
      continue;
    }

    const selectSql =
      options.selectSqlByTable?.[tableName] ||
      (pageSize && dialect === "sqlite"
        ? `SELECT * FROM ${quoteIdentifier(tableName)} ORDER BY rowid`
        : `SELECT * FROM ${quoteIdentifier(tableName)}`);
    const readRows = pageSize
      ? await queryAllPages(queryRunner, selectSql, pageSize)
      : await queryRunner.query(selectSql);
    const orderRows = options.orderRowsByTable?.[tableName];
    const rows = orderRows ? orderRows(readRows) : readRows;
    if (rows.length === 0) {
      continue;
    }

    sql += `-- ${tableName}\n`;
    sql += rows
      .map((row) => buildInsertStatement(tableName, columnNames, row))
      .join("\n");
    sql += "\n\n";
  }

  return sql;
}
