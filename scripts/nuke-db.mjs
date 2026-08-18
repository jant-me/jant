#!/usr/bin/env node

/**
 * Drop ALL tables (including migrations, FTS shadow tables) from a D1 database.
 * Runs multiple passes to handle FTS5 trigger dependencies.
 *
 * @example node scripts/nuke-db.mjs sites/demo
 */

import { execSync } from "node:child_process";
import { extractWranglerJson } from "../packages/core/bin/lib/wrangler-json.js";
import { resolve } from "node:path";
import { loadDemoWorkflowEnv } from "./demo-shared/env.mjs";

const siteDir = process.argv[2];
if (!siteDir) {
  console.error("Usage: node scripts/nuke-db.mjs <site-dir>");
  process.exit(1);
}

const envSites = [];
if (siteDir.endsWith("sites/demo")) envSites.push("demo");
if (siteDir.endsWith("sites/demo-source")) envSites.push("demo-source");
loadDemoWorkflowEnv({ sites: envSites });

const cwd = resolve(process.cwd(), siteDir);

function d1(command) {
  execSync(`pnpm exec wrangler d1 execute DB --remote --command "${command}"`, {
    cwd,
    stdio: "pipe",
  });
}

function d1Json(command) {
  const out = execSync(
    `pnpm exec wrangler d1 execute DB --remote --json --command "${command}"`,
    { cwd, stdio: "pipe" },
  ).toString();
  return JSON.parse(extractWranglerJson(out))[0]?.results || [];
}

const MAX_PASSES = 5;

for (let pass = 1; pass <= MAX_PASSES; pass++) {
  const objects = d1Json(
    "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%';",
  );

  if (objects.length === 0) {
    console.log(
      pass === 1
        ? "Database is already empty."
        : "Done! Database is now empty.",
    );
    process.exit(0);
  }

  if (pass === 1) {
    console.log(`Found ${objects.length} objects to drop.`);
  }

  // Separate FTS shadow tables (they get dropped automatically with the virtual table)
  const shadowPattern = /^(.+)_(data|idx|docsize|config|content)$/;
  const shadowNames = new Set();
  for (const o of objects) {
    if (o.type !== "table") continue;
    const m = o.name.match(shadowPattern);
    if (m && objects.some((x) => x.name === m[1])) shadowNames.add(o.name);
  }

  // Build drop list: triggers -> views -> FTS virtual tables -> regular tables
  const drops = [];
  const typeOrder = {
    trigger: "DROP TRIGGER",
    view: "DROP VIEW",
    table: "DROP TABLE",
  };

  for (const type of ["trigger", "view", "table"]) {
    for (const o of objects) {
      if (o.type !== type) continue;
      if (type === "table" && shadowNames.has(o.name)) continue;
      drops.push(`${typeOrder[type]} IF EXISTS "${o.name}";`);
    }
  }

  let dropped = 0;
  for (const sql of drops) {
    try {
      d1(sql);
      dropped++;
      process.stdout.write(".");
    } catch {
      process.stdout.write("x");
    }
  }
  console.log(` (pass ${pass}: ${dropped}/${drops.length})`);
}

// If we get here, there are still objects left
const remaining = d1Json(
  "SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%';",
);
console.error(
  `Failed to drop ${remaining.length} objects: ${remaining.map((r) => r.name).join(", ")}`,
);
process.exit(1);
