import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSiteContentResetSql,
  escapeSqlString,
  queryRemoteD1,
  resolveSingleRemoteSite,
} from "../../../scripts/lib/remote-site-ops.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const runJantScript = resolve(__dirname, "../../../scripts/run-jant.mjs");
const siteDir = resolve(__dirname, "..");

function sqlValue(value) {
  if (value === null) {
    return "NULL";
  }

  if (typeof value === "number") {
    return String(value);
  }

  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlIdentifier(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

function dumpTable(name, query) {
  const rows = queryRemoteD1({
    cwd: siteDir,
    sql: query || `SELECT * FROM ${name}`,
  });
  return rows
    .map((row) => {
      const columns = Object.keys(row);
      return `INSERT INTO ${name} (${columns.map(sqlIdentifier).join(",")}) VALUES(${columns.map((column) => sqlValue(row[column])).join(",")});`;
    })
    .join("\n");
}

function validateSnapshot(sql) {
  const persistDir = mkdtempSync(resolve(tmpdir(), "jant-content-lab-seed-"));
  const snapshotPath = resolve(persistDir, "content-lab-snapshot.sql");

  writeFileSync(snapshotPath, sql);

  try {
    execFileSync(
      process.execPath,
      [runJantScript, "migrate", "--local", "--persist-to", persistDir],
      {
        cwd: process.cwd(),
        encoding: "utf-8",
      },
    );

    execFileSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "d1",
        "execute",
        "DB",
        "--local",
        "--persist-to",
        persistDir,
        "--file",
        snapshotPath,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf-8",
      },
    );
  } catch (error) {
    const output = [error.stdout, error.stderr]
      .filter(Boolean)
      .join("\n")
      .trim();
    console.error(output || error.message);
    process.exit(1);
  } finally {
    rmSync(persistDir, { recursive: true, force: true });
  }
}

const header = `-- =============================================================================
-- Content-lab snapshot for Jant
-- Exported from the long-lived content-lab Worker
-- Usage: curate this file, then copy the frozen snapshot into
-- packages/core/src/db/rehearsal-fixtures/
-- =============================================================================
`;

const site = resolveSingleRemoteSite({
  cwd: siteDir,
  label: "content-lab",
});
const escapedSiteId = escapeSqlString(site.id);
const resetSql = buildSiteContentResetSql(site.id, {
  clearNavItems: true,
  clearApiTokens: true,
});

const tables = [
  [
    "post",
    `SELECT * FROM post
     WHERE site_id = '${escapedSiteId}'
     ORDER BY CASE WHEN reply_to_id IS NULL THEN 0 ELSE 1 END, created_at, id`,
  ],
  [
    "collection",
    `SELECT * FROM collection
     WHERE site_id = '${escapedSiteId}'
     ORDER BY created_at, id`,
  ],
  [
    "nav_item",
    `SELECT * FROM nav_item
     WHERE site_id = '${escapedSiteId}'
     ORDER BY position, id`,
  ],
  [
    "collection_directory_item",
    `SELECT * FROM collection_directory_item
     WHERE site_id = '${escapedSiteId}'
     ORDER BY position, id`,
  ],
  [
    "thread_collection",
    `SELECT tc.* FROM thread_collection tc
     JOIN post p ON p.id = tc.thread_id
     WHERE tc.site_id = '${escapedSiteId}'
     ORDER BY tc.created_at, tc.collection_id, tc.thread_id`,
  ],
  [
    "path_registry",
    `SELECT pr.* FROM path_registry pr
     LEFT JOIN post p ON p.id = pr.post_id
     LEFT JOIN collection c ON c.id = pr.collection_id
     WHERE pr.site_id = '${escapedSiteId}'
       AND (
         pr.kind = 'redirect'
        OR (pr.post_id IS NOT NULL AND p.id IS NOT NULL)
        OR (pr.collection_id IS NOT NULL AND c.id IS NOT NULL)
       )
     ORDER BY pr.path, pr.id`,
  ],
  [
    "api_token",
    `SELECT * FROM api_token
     WHERE site_id = '${escapedSiteId}'
     ORDER BY created_at, id`,
  ],
  [
    "media",
    `SELECT m.* FROM media m
     WHERE m.site_id = '${escapedSiteId}'
     ORDER BY m.created_at, m.id`,
  ],
];

let sql = header;
sql += "\n-- Reset (clear existing content)\n";
sql += resetSql.replace(/^--.*\n/gm, "").trim() + "\n";

for (const [name, query] of tables) {
  const data = dumpTable(name, query);
  if (data) {
    sql += `\n-- ${name}\n${data}\n`;
  }
}

validateSnapshot(sql);

const outputPath = resolve(__dirname, "content-lab-snapshot.sql");
writeFileSync(outputPath, sql);
console.log(
  "Exported content-lab database to scripts/content-lab-snapshot.sql",
);
