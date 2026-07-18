import { execFileSync } from "node:child_process";

function parseWranglerError(output, fallbackMessage) {
  try {
    const parsed = JSON.parse(output.trim());
    if (parsed.error?.text) {
      const detail = parsed.error.notes?.[0]?.text;
      return `${parsed.error.text}${detail ? `\n  ${detail}` : ""}`;
    }
  } catch {
    // Fall through to the generic message below.
  }

  return output || fallbackMessage;
}

export function escapeSqlString(value) {
  return String(value).replaceAll("'", "''");
}

export function queryRemoteD1({ cwd, sql, database = "DB" }) {
  let stdout;

  try {
    stdout = execFileSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "d1",
        "execute",
        database,
        "--remote",
        "--command",
        sql,
        "--json",
      ],
      { encoding: "utf-8", cwd },
    );
  } catch (error) {
    const output = error.stdout || error.stderr || "";
    throw new Error(
      `Failed to query remote D1: ${parseWranglerError(output, error.message)}`,
    );
  }

  const parsed = JSON.parse(stdout);
  if (parsed.error?.text) {
    const detail = parsed.error.notes?.[0]?.text;
    throw new Error(
      `Wrangler error: ${parsed.error.text}${detail ? `\n  ${detail}` : ""}`,
    );
  }

  return parsed[0]?.results || [];
}

export function executeRemoteD1({ cwd, sql, database = "DB" }) {
  try {
    execFileSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "d1",
        "execute",
        database,
        "--remote",
        "--command",
        sql,
      ],
      { encoding: "utf-8", cwd, stdio: "pipe" },
    );
  } catch (error) {
    const output = error.stdout || error.stderr || "";
    throw new Error(
      `Failed to execute remote D1 SQL: ${parseWranglerError(output, error.message)}`,
    );
  }
}

export function resolveSingleRemoteSite({
  cwd,
  database = "DB",
  label = "instance",
}) {
  const rows = queryRemoteD1({
    cwd,
    database,
    sql: `
      SELECT "id", "key", "status", "created_at", "updated_at"
      FROM "site"
      ORDER BY "created_at", "id"
      LIMIT 2
    `,
  });

  if (rows.length === 0) {
    throw new Error(
      `No site exists in ${label}. Finish /setup before running this command.`,
    );
  }

  if (rows.length > 1) {
    throw new Error(
      `${label} contains multiple sites. Use a site-aware command path instead of an implicit single-site operation.`,
    );
  }

  return rows[0];
}

export function buildSiteContentResetSql(
  siteId,
  { clearNavItems = false, clearApiTokens = false } = {},
) {
  const escapedSiteId = escapeSqlString(siteId);
  const statements = [
    `DELETE FROM "thread_collection" WHERE "site_id" = '${escapedSiteId}';`,
    `DELETE FROM "collection_directory_item" WHERE "site_id" = '${escapedSiteId}';`,
    `DELETE FROM "path_registry" WHERE "site_id" = '${escapedSiteId}';`,
  ];

  if (clearApiTokens) {
    statements.push(
      `DELETE FROM "api_token" WHERE "site_id" = '${escapedSiteId}';`,
    );
  }

  if (clearNavItems) {
    statements.push(
      `DELETE FROM "nav_item" WHERE "site_id" = '${escapedSiteId}';`,
    );
  }

  statements.push(
    `DELETE FROM "media" WHERE "site_id" = '${escapedSiteId}';`,
    `DELETE FROM "post" WHERE "site_id" = '${escapedSiteId}';`,
    `DELETE FROM "collection" WHERE "site_id" = '${escapedSiteId}';`,
  );

  return statements.join("\n");
}
