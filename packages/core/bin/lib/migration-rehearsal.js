import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { executeD1File, executeD1, queryD1 } from "./d1-query.js";
import {
  listBackfillFiles,
  listSchemaMigrationFiles,
  readWranglerDatabaseConfig,
  resolveBundledBackfillsDir,
} from "./migration-artifacts.js";
import {
  applyTrackedSqlFiles,
  createD1SqlRunner,
  splitSqlStatements,
} from "./migration-runner.js";

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function resolveRunnerOptions(options = {}) {
  const config = readWranglerDatabaseConfig({
    configPath: options.configPath,
    cwd: options.cwd,
    database: options.database,
    env: options.env,
  });

  return {
    config,
    runnerOptions: {
      configPath: config.configPath,
      database: config.databaseBinding,
      env: options.env,
      persistTo: options.persistTo,
    },
  };
}

function readFixtureFile(fixturePath) {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));

  if (
    typeof fixture !== "object" ||
    fixture === null ||
    typeof fixture.baseMigrationTag !== "string" ||
    fixture.baseMigrationTag.length === 0 ||
    typeof fixture.seedPath !== "string" ||
    fixture.seedPath.length === 0
  ) {
    throw new Error(
      `Invalid rehearsal fixture: ${fixturePath}. Expected baseMigrationTag and seedPath.`,
    );
  }

  const assertions = Array.isArray(fixture.assertions)
    ? fixture.assertions
    : [];

  return {
    name:
      typeof fixture.name === "string" && fixture.name.length > 0
        ? fixture.name
        : "fixture",
    baseMigrationTag: fixture.baseMigrationTag,
    seedPath: resolve(dirname(fixturePath), fixture.seedPath),
    assertions,
  };
}

function selectBaselineMigrations(migrations, baseMigrationTag) {
  const endIndex = migrations.findIndex(
    (file) => file.tag === baseMigrationTag,
  );

  if (endIndex === -1) {
    throw new Error(
      `Baseline migration "${baseMigrationTag}" was not found in the current journal.`,
    );
  }

  return migrations.slice(0, endIndex + 1);
}

function buildDropStatements(objects) {
  const shadowPattern = /^(.+)_(data|idx|docsize|config|content)$/;
  const shadowNames = new Set();

  for (const object of objects) {
    if (object.type !== "table") {
      continue;
    }

    const match = String(object.name).match(shadowPattern);
    if (match && objects.some((candidate) => candidate.name === match[1])) {
      shadowNames.add(object.name);
    }
  }

  const drops = [];
  const typeOrder = {
    trigger: "DROP TRIGGER",
    view: "DROP VIEW",
    table: "DROP TABLE",
  };

  for (const type of ["trigger", "view", "table"]) {
    for (const object of objects) {
      if (object.type !== type) {
        continue;
      }

      if (type === "table" && shadowNames.has(object.name)) {
        continue;
      }

      drops.push(
        `${typeOrder[type]} IF EXISTS ${quoteIdentifier(object.name)};`,
      );
    }
  }

  return drops;
}

function resetD1Database(runtime, runnerOptions) {
  const maxPasses = 5;

  for (let pass = 1; pass <= maxPasses; pass += 1) {
    const objects = queryD1(
      `
        SELECT type, name
        FROM sqlite_master
        WHERE name NOT LIKE 'sqlite_%'
          AND name NOT LIKE '_cf_%'
        ORDER BY type, name
      `,
      runtime,
      runnerOptions,
    );

    if (objects.length === 0) {
      if (pass === 1) {
        console.log("Rehearsal database is already empty.");
      } else {
        console.log("Rehearsal database reset complete.");
      }
      return;
    }

    if (pass === 1) {
      console.log(
        `Resetting rehearsal database (${objects.length} objects)...`,
      );
    }

    const drops = buildDropStatements(objects);
    let dropped = 0;

    for (const sql of drops) {
      try {
        executeD1(sql, runtime, { ...runnerOptions, quiet: true });
        dropped += 1;
      } catch {
        // Retry on the next pass if dependencies still exist.
      }
    }

    console.log(
      `Reset pass ${pass}: ${dropped}/${drops.length} objects dropped.`,
    );
  }

  const remaining = queryD1(
    `
      SELECT name
      FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%'
        AND name NOT LIKE '_cf_%'
      ORDER BY name
    `,
    runtime,
    runnerOptions,
  );

  throw new Error(
    `Failed to reset rehearsal database. Remaining objects: ${remaining.map((row) => row.name).join(", ")}`,
  );
}

function runAssertions(assertions, runtime, runnerOptions) {
  if (assertions.length === 0) {
    return;
  }

  console.log(`Running fixture assertions (${assertions.length})...`);

  for (const [index, assertion] of assertions.entries()) {
    if (
      typeof assertion !== "object" ||
      assertion === null ||
      typeof assertion.sql !== "string" ||
      assertion.sql.length === 0
    ) {
      throw new Error(`Invalid fixture assertion at index ${index}.`);
    }

    const label =
      typeof assertion.name === "string" && assertion.name.length > 0
        ? assertion.name
        : `assertion ${index + 1}`;
    const rows = queryD1(assertion.sql, runtime, runnerOptions);

    if (
      typeof assertion.rowCountAtLeast === "number" &&
      rows.length < assertion.rowCountAtLeast
    ) {
      throw new Error(
        `${label} failed: expected at least ${assertion.rowCountAtLeast} rows, got ${rows.length}.`,
      );
    }

    if (
      typeof assertion.rowCount === "number" &&
      rows.length !== assertion.rowCount
    ) {
      throw new Error(
        `${label} failed: expected ${assertion.rowCount} rows, got ${rows.length}.`,
      );
    }

    if (typeof assertion.column === "string" && assertion.column.length > 0) {
      if (rows.length === 0) {
        throw new Error(`${label} failed: query returned no rows.`);
      }

      const actual = rows[0]?.[assertion.column];

      if (Object.hasOwn(assertion, "equals") && actual !== assertion.equals) {
        throw new Error(
          `${label} failed: expected ${assertion.column}=${assertion.equals}, got ${actual}.`,
        );
      }

      if (typeof assertion.atLeast === "number") {
        const numeric = Number(actual);
        if (!Number.isFinite(numeric) || numeric < assertion.atLeast) {
          throw new Error(
            `${label} failed: expected ${assertion.column} >= ${assertion.atLeast}, got ${actual}.`,
          );
        }
      }
    }

    console.log(`[${index + 1}/${assertions.length}] ${label} ✅`);
  }
}

function createRehearsalD1Runner(runtime, runnerOptions) {
  return createD1SqlRunner(runtime, {
    ...runnerOptions,
    trackedExecution: runtime === "d1-remote" ? "segmented" : "command",
  });
}

function isTransientWranglerError(error) {
  const message = String(error?.message ?? "");
  return (
    message.includes("fetch failed") ||
    message.includes("Network connection lost.")
  );
}

/**
 * The tables a seed writes, children first, so deleting from them in this
 * order satisfies their foreign keys: a seed inserts parents first.
 */
function seededTablesChildrenFirst(statements) {
  const tables = [];
  for (const statement of statements) {
    // The first statement carries the seed's header comment.
    const match =
      /^(?:\s*--[^\n]*\n)*\s*INSERT\s+INTO\s+"?([A-Za-z_]\w*)"?/i.exec(
        statement,
      );
    if (match && !tables.includes(match[1])) tables.push(match[1]);
  }
  return tables.reverse();
}

function chunkStatements(statements, chunkSize) {
  const chunks = [];

  for (let index = 0; index < statements.length; index += chunkSize) {
    chunks.push(statements.slice(index, index + chunkSize));
  }

  return chunks;
}

async function executeRemoteD1SqlBatch(sql, config) {
  const apiToken =
    process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_API_TOKEN ?? "";

  if (!apiToken) {
    throw new Error(
      "Missing CLOUDFLARE_API_TOKEN (or legacy CF_API_TOKEN) for remote rehearsal.",
    );
  }

  if (!config.accountId || !config.databaseId) {
    throw new Error(
      "Remote rehearsal requires account_id and database_id in the Wrangler config.",
    );
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/${config.databaseId}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql }),
    },
  );

  const payload = await response.json();
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  if (!response.ok || payload?.success === false || errors.length > 0) {
    const detail = errors
      .map((item) => item?.message)
      .filter((message) => typeof message === "string" && message.length > 0)
      .join(" | ");
    throw new Error(
      detail || `Cloudflare D1 API request failed (${response.status}).`,
    );
  }

  const results = Array.isArray(payload?.result) ? payload.result : [];
  const failedResult = results.find((result) => result?.success === false);
  if (failedResult) {
    throw new Error("Cloudflare D1 API batch execution failed.");
  }
}

async function executeRehearsalSqlFile(
  filePath,
  runtime,
  runnerOptions,
  config,
) {
  if (runtime !== "d1-remote") {
    executeD1File(filePath, runtime, {
      ...runnerOptions,
      quiet: true,
    });
    return;
  }

  const statements = splitSqlStatements(readFileSync(filePath, "utf-8"));
  if (statements.length === 0) {
    throw new Error(`SQL file is empty: ${filePath}`);
  }

  const batches = chunkStatements(statements, 25);
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (attempt > 1) {
        // Batches that went through before the failure are in the database;
        // clear them so the retry doesn't insert them twice.
        await executeRemoteD1SqlBatch(
          seededTablesChildrenFirst(statements)
            .map((table) => `DELETE FROM "${table}";`)
            .join("\n"),
          config,
        );
      }
      console.log(
        `Importing fixture SQL via D1 API in ${batches.length} batches (attempt ${attempt}/${maxAttempts})...`,
      );

      for (const [index, batch] of batches.entries()) {
        await executeRemoteD1SqlBatch(batch.join("\n"), config);
        console.log(`[${index + 1}/${batches.length}] Fixture batch ✅`);
      }

      return;
    } catch (error) {
      if (attempt < maxAttempts && isTransientWranglerError(error)) {
        console.log(
          `Fixture import failed with a transient network error. Retrying from the start (${attempt + 1}/${maxAttempts})...`,
        );
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Failed to import fixture SQL: ${filePath}`);
}

export async function rehearseD1Migrations(runtime, options = {}) {
  const fixturePath = resolve(process.cwd(), options.fixturePath ?? "");

  if (!options.fixturePath) {
    throw new Error("A rehearsal fixture path is required.");
  }

  const fixture = readFixtureFile(fixturePath);
  const { config, runnerOptions } = resolveRunnerOptions({
    configPath: options.configPath,
    cwd: options.cwd,
    database: options.database,
    env: options.env,
    persistTo: options.persistTo,
  });
  const baselineMigrations = selectBaselineMigrations(
    listSchemaMigrationFiles(config.migrationsDir),
    fixture.baseMigrationTag,
  );

  console.log(`Using rehearsal fixture: ${fixture.name}`);
  console.log(`Baseline migration: ${fixture.baseMigrationTag}`);

  resetD1Database(runtime, runnerOptions);

  const rehearsalRunner = createRehearsalD1Runner(runtime, runnerOptions);

  applyTrackedSqlFiles(rehearsalRunner, {
    files: baselineMigrations,
    headline: "Baseline schema migrations",
    tableName: config.migrationsTable,
  });

  console.log(`Importing fixture seed: ${fixture.seedPath}`);
  await executeRehearsalSqlFile(
    fixture.seedPath,
    runtime,
    runnerOptions,
    config,
  );

  applyTrackedSqlFiles(rehearsalRunner, {
    files: listSchemaMigrationFiles(config.migrationsDir),
    headline: "Schema migrations",
    tableName: config.migrationsTable,
  });

  applyTrackedSqlFiles(rehearsalRunner, {
    files: listBackfillFiles(resolveBundledBackfillsDir()),
    headline: "Data backfills",
    tableName: "data_migration",
  });

  runAssertions(fixture.assertions, runtime, runnerOptions);

  return {
    fixture,
    baselineMigrationCount: baselineMigrations.length,
  };
}
