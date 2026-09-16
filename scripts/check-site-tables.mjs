/**
 * Site Content Table Registry Check
 *
 * Three hand-written lists in this repo enumerate a site's content tables:
 *
 * - `SNAPSHOT_TABLES` in `packages/core/bin/lib/site-snapshot.js`
 * - `buildSiteContentResetSql` in `scripts/lib/remote-site-ops.mjs`
 * - `buildContentLabExportQueries` in `sites/content-lab/scripts/export-queries.mjs`
 *
 * Nothing connected them to the schema, and the cost showed. The commit that
 * added `smart_collection` updated the second and third — the two next to the
 * code it was touching — and missed the first. Export then dropped smart
 * collections and `--replace` could not delete them, silently, for weeks.
 *
 * `packages/core/src/__tests__/snapshot-tables.test.ts` now anchors the first
 * list to the schema. This script anchors the other two to that one, so a new
 * content table has to be registered once and then reaches all three. The lists
 * are not identical and are not meant to be — the snapshot carries
 * `site_setting` and no credentials, the other two carry `api_token` because a
 * rehearsal fixture needs it — so the differences are declared below rather
 * than smoothed over.
 *
 * Run: mise run check-site-tables
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildContentLabExportQueries } from "../sites/content-lab/scripts/export-queries.mjs";
import { SNAPSHOT_TABLES } from "../packages/core/bin/lib/site-snapshot.js";
import { buildSiteContentResetSql } from "./lib/remote-site-ops.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const metaDir = resolve(repoRoot, "packages/core/src/db/migrations/meta");

/**
 * `site_setting` is the snapshot's alone. The other two lists clear and dump
 * content rows; a site's settings are not content and outlive a content reset.
 */
const SNAPSHOT_ONLY = new Set(["site_setting"]);

/**
 * Tables the other two lists carry that the snapshot deliberately does not.
 * Each needs a reason, so an accidental addition cannot hide here.
 */
const EXTRA_ALLOWED = new Map([
  [
    "api_token",
    "A rehearsal fixture needs tokens to exercise auth paths, and a content " +
      "reset clears them on request. A portable snapshot never carries " +
      "credentials, so SNAPSHOT_EXCLUDED_TABLES leaves it out.",
  ],
]);

/**
 * Read the schema from the newest Drizzle meta snapshot: generated from
 * `schema.ts`, so it cannot drift from it, and plain JSON, so this script does
 * not need TypeScript to read it.
 *
 * @returns Site-scoped table names and, for each, the tables it references.
 */
function readSchema() {
  const latest = readdirSync(metaDir)
    .filter((name) => name.endsWith("_snapshot.json"))
    .sort()
    .pop();
  if (!latest) throw new Error(`No Drizzle meta snapshot in ${metaDir}`);

  const meta = JSON.parse(readFileSync(resolve(metaDir, latest), "utf8"));
  const siteScoped = new Map();

  for (const table of Object.values(meta.tables)) {
    if (!Object.hasOwn(table.columns, "site_id")) continue;
    const dependsOn = new Set();
    for (const key of Object.values(table.foreignKeys ?? {})) {
      if (key.tableTo !== table.name) dependsOn.add(key.tableTo);
    }
    siteScoped.set(table.name, dependsOn);
  }

  return { source: latest, siteScoped };
}

/** Table names in the order `buildSiteContentResetSql` deletes them. */
function readResetOrder() {
  const sql = buildSiteContentResetSql("sit_check", {
    clearNavItems: true,
    clearApiTokens: true,
  });
  return [...sql.matchAll(/DELETE FROM "([a-z_]+)"/g)].map((m) => m[1]);
}

/** Table names in the order a content-lab export dumps, and so replays, them. */
function readContentLabOrder() {
  return buildContentLabExportQueries("sit_check").map(([table]) => table);
}

/**
 * Check one list covers the content tables, names nothing unknown, and orders
 * itself so foreign keys hold.
 *
 * @param list - The list under check.
 * @param list.label - Human name used in failure output.
 * @param list.tables - Table names, in the list's own order.
 * @param list.direction - "insert" for parents first, "delete" for children first.
 * @param schema - Site-scoped tables and their dependencies.
 * @returns One message per problem found.
 */
function checkList({ label, tables, direction }, schema) {
  const problems = [];
  const present = new Set(tables);

  for (const table of SNAPSHOT_TABLES) {
    if (SNAPSHOT_ONLY.has(table) || present.has(table)) continue;
    problems.push(
      `${label}: missing "${table}", which SNAPSHOT_TABLES lists as site content.`,
    );
  }

  for (const table of tables) {
    if (!schema.siteScoped.has(table)) {
      problems.push(
        `${label}: names "${table}", which is not a site-scoped table in the schema.`,
      );
      continue;
    }
    if (SNAPSHOT_TABLES.includes(table) || EXTRA_ALLOWED.has(table)) continue;
    problems.push(
      `${label}: carries "${table}", which SNAPSHOT_TABLES does not. Add it there ` +
        `if it is site content, or declare it in EXTRA_ALLOWED with the reason.`,
    );
  }

  // Before the order check: a repeated table would insert or delete twice, and
  // it would also hide an ordering fault, because the map below keeps only the
  // last index a name appears at.
  const seen = new Set();
  for (const table of tables) {
    if (seen.has(table)) {
      problems.push(`${label}: lists "${table}" more than once.`);
    }
    seen.add(table);
  }

  const position = new Map(tables.map((table, index) => [table, index]));
  for (const [table, dependsOn] of schema.siteScoped) {
    const self = position.get(table);
    if (self === undefined) continue;
    for (const parent of dependsOn) {
      const at = position.get(parent);
      if (at === undefined) continue;
      const wrong = direction === "insert" ? at > self : at < self;
      if (!wrong) continue;
      problems.push(
        direction === "insert"
          ? `${label}: inserts "${table}" (${self}) before "${parent}" (${at}), which it references.`
          : `${label}: deletes "${table}" (${self}) after "${parent}" (${at}), which it references.`,
      );
    }
  }

  return problems;
}

function main() {
  const schema = readSchema();
  const lists = [
    {
      label: "buildSiteContentResetSql (scripts/lib/remote-site-ops.mjs)",
      tables: readResetOrder(),
      direction: "delete",
    },
    {
      label:
        "buildContentLabExportQueries (sites/content-lab/scripts/export-queries.mjs)",
      tables: readContentLabOrder(),
      direction: "insert",
    },
  ];

  const problems = lists.flatMap((list) => checkList(list, schema));

  for (const problem of problems) console.log(`  error ${problem}`);

  console.log(
    `\n${problems.length} error(s) across ${lists.length} list(s), ` +
      `against ${schema.siteScoped.size} site-scoped tables in ${schema.source}.`,
  );

  if (problems.length > 0) {
    console.log(
      "SNAPSHOT_TABLES is the registry these follow. Its own check is " +
        "packages/core/src/__tests__/snapshot-tables.test.ts.",
    );
  }

  process.exit(problems.length > 0 ? 1 : 0);
}

main();
