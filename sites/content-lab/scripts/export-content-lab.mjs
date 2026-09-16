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
import { buildContentLabExportQueries } from "./export-queries.mjs";

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

const tables = buildContentLabExportQueries(escapedSiteId);

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
