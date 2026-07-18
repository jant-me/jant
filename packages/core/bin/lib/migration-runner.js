import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeD1, executeD1File, queryD1 } from "./d1-query.js";
import {
  DEFAULT_DATA_MIGRATION_TABLE,
  listBackfillFiles,
  listSchemaMigrationFiles,
  readWranglerDatabaseConfig,
  resolveBundledBackfillsDir,
} from "./migration-artifacts.js";

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function splitSqlStatements(sql) {
  if (sql.includes("--> statement-breakpoint")) {
    return sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
  }

  const statements = [];
  let start = 0;
  let index = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      index += 1;
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (inSingleQuote) {
      if (char === "'" && next === "'") {
        index += 2;
        continue;
      }

      if (char === "'") {
        inSingleQuote = false;
      }
      index += 1;
      continue;
    }

    if (inDoubleQuote) {
      if (char === '"') {
        inDoubleQuote = false;
      }
      index += 1;
      continue;
    }

    if (inBacktick) {
      if (char === "`") {
        inBacktick = false;
      }
      index += 1;
      continue;
    }

    if (char === "-" && next === "-") {
      inLineComment = true;
      index += 2;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      index += 2;
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      index += 1;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = true;
      index += 1;
      continue;
    }

    if (char === "`") {
      inBacktick = true;
      index += 1;
      continue;
    }

    if (char === ";") {
      const statement = sql.slice(start, index + 1).trim();
      if (statement) {
        statements.push(statement);
      }
      start = index + 1;
    }

    index += 1;
  }

  const tail = sql.slice(start).trim();
  if (tail) {
    statements.push(tail);
  }

  return statements;
}

function readNormalizedSqlFile(filePath) {
  const statements = splitSqlStatements(readFileSync(filePath, "utf-8"));
  if (statements.length === 0) {
    throw new Error(`SQL file is empty: ${filePath}`);
  }

  return statements.join("\n");
}

function readSqlStatements(filePath) {
  const statements = splitSqlStatements(readFileSync(filePath, "utf-8"));
  if (statements.length === 0) {
    throw new Error(`SQL file is empty: ${filePath}`);
  }

  return statements;
}

function createTrackingTableSql(tableName) {
  const table = quoteIdentifier(tableName);
  return `
    CREATE TABLE IF NOT EXISTS ${table} (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "name" TEXT UNIQUE NOT NULL,
      "applied_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `;
}

function createNodeSqlRunner(sqlite) {
  return {
    execute(sql) {
      sqlite.exec(sql);
    },
    query(sql) {
      return sqlite.prepare(sql).all();
    },
  };
}

export function createD1SqlRunner(runtime, options) {
  const trackedExecution = options?.trackedExecution ?? "command";

  return {
    execute(sql) {
      executeD1(sql, runtime, { ...options, quiet: true });
    },
    executeTrackedFile(filePath, trackingSql) {
      // A tracked schema/data migration is already atomic with its tracking
      // insert. Do not let the lower-level Wrangler helper blindly replay a
      // destructive batch after an ambiguous network response. The outer
      // runner reconciles the tracking row instead.
      const trackedOptions = {
        ...options,
        quiet: true,
        retryAttempts: 1,
      };

      if (trackedExecution === "segmented") {
        for (const statement of readSqlStatements(filePath)) {
          executeD1(statement, runtime, trackedOptions);
        }
        executeD1(trackingSql, runtime, trackedOptions);
        return;
      }

      if (trackedExecution === "file") {
        const tempDir = mkdtempSync(join(tmpdir(), "jant-d1-migration-"));
        const tempPath = join(tempDir, "tracked.sql");

        try {
          writeFileSync(
            tempPath,
            `\n${readNormalizedSqlFile(filePath)}\n${trackingSql}\n`,
          );
          executeD1File(tempPath, runtime, trackedOptions);
        } finally {
          rmSync(tempDir, { recursive: true, force: true });
        }
        return;
      }

      executeD1(
        `\n${readNormalizedSqlFile(filePath)}\n${trackingSql}`,
        runtime,
        trackedOptions,
      );
    },
    query(sql) {
      return queryD1(sql, runtime, options);
    },
  };
}

function listAppliedNames(runner, tableName) {
  const table = quoteIdentifier(tableName);
  return runner
    .query(`SELECT "name" FROM ${table} ORDER BY "id"`)
    .map((row) => String(row.name));
}

export function applyTrackedSqlFiles(runner, options) {
  const { files, headline, tableName } = options;
  if (files.length === 0) {
    console.log(`No ${headline.toLowerCase()} to apply.`);
    return 0;
  }

  runner.execute(createTrackingTableSql(tableName));
  const appliedNames = new Set(listAppliedNames(runner, tableName));
  const pendingFiles = files.filter((file) => !appliedNames.has(file.name));

  if (pendingFiles.length === 0) {
    console.log(`No ${headline.toLowerCase()} to apply.`);
    return 0;
  }

  console.log(
    `Applying ${headline.toLowerCase()} (${pendingFiles.length} pending)...`,
  );

  const table = quoteIdentifier(tableName);
  for (const [index, file] of pendingFiles.entries()) {
    const trackingSql = `INSERT INTO ${table} ("name") VALUES (${quoteString(file.name)});`;

    try {
      if (typeof runner.executeTrackedFile === "function") {
        runner.executeTrackedFile(file.path, trackingSql);
      } else {
        runner.execute(`\n${readNormalizedSqlFile(file.path)}\n${trackingSql}`);
      }
      console.log(`[${index + 1}/${pendingFiles.length}] ${file.name} ✅`);
    } catch (error) {
      // The database may have committed the atomic batch even if the client
      // lost its response. Re-read the tracking table before reporting a
      // failure; a committed marker means replay would be both unnecessary and
      // unsafe for CREATE/COPY/DROP migrations.
      try {
        if (new Set(listAppliedNames(runner, tableName)).has(file.name)) {
          console.log(
            `[${index + 1}/${pendingFiles.length}] ${file.name} ✅ (confirmed after interrupted response)`,
          );
          continue;
        }
      } catch {
        // Preserve the original execution failure when reconciliation itself
        // cannot reach the database.
      }
      console.log(`[${index + 1}/${pendingFiles.length}] ${file.name} ❌`);
      throw new Error(`Failed to apply ${file.name}: ${error.message}`, {
        cause: error,
      });
    }
  }

  return pendingFiles.length;
}

function resolveD1RunnerOptions(options = {}) {
  const config = readWranglerDatabaseConfig(options);
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

export function applyD1SchemaMigrations(runtime, options = {}) {
  const { config, runnerOptions } = resolveD1RunnerOptions(options);
  return applyTrackedSqlFiles(createD1SqlRunner(runtime, runnerOptions), {
    files: listSchemaMigrationFiles(config.migrationsDir),
    headline: "Schema migrations",
    tableName: config.migrationsTable,
  });
}

export function applyD1Backfills(runtime, options = {}) {
  const { runnerOptions } = resolveD1RunnerOptions(options);
  return applyTrackedSqlFiles(createD1SqlRunner(runtime, runnerOptions), {
    files: listBackfillFiles(resolveBundledBackfillsDir()),
    headline: "Data backfills",
    tableName: DEFAULT_DATA_MIGRATION_TABLE,
  });
}

export function applyNodeBackfills(sqlite) {
  return applyTrackedSqlFiles(createNodeSqlRunner(sqlite), {
    files: listBackfillFiles(resolveBundledBackfillsDir()),
    headline: "Data backfills",
    tableName: DEFAULT_DATA_MIGRATION_TABLE,
  });
}

function createPgTrackingTableSql(tableName) {
  const table = quoteIdentifier(tableName);
  return `
    CREATE TABLE IF NOT EXISTS ${table} (
      "id" SERIAL PRIMARY KEY,
      "name" TEXT UNIQUE NOT NULL,
      "applied_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `;
}

function createPgSqlRunner(pool) {
  return {
    async execute(sql) {
      await pool.query(sql);
    },
    async query(sql) {
      const result = await pool.query(sql);
      return result.rows;
    },
  };
}

export async function applyPgBackfills(pool) {
  const runner = createPgSqlRunner(pool);
  const files = listBackfillFiles(resolveBundledBackfillsDir());
  if (files.length === 0) {
    console.log("No data backfills to apply.");
    return 0;
  }

  const tableName = DEFAULT_DATA_MIGRATION_TABLE;
  await runner.execute(createPgTrackingTableSql(tableName));
  const table = quoteIdentifier(tableName);
  const applied = await runner.query(
    `SELECT "name" FROM ${table} ORDER BY "id"`,
  );
  const appliedNames = new Set(applied.map((row) => String(row.name)));
  const pendingFiles = files.filter((file) => !appliedNames.has(file.name));

  if (pendingFiles.length === 0) {
    console.log("No data backfills to apply.");
    return 0;
  }

  console.log(`Applying data backfills (${pendingFiles.length} pending)...`);

  for (const [index, file] of pendingFiles.entries()) {
    try {
      const sql = readNormalizedSqlFile(file.path);
      const trackingSql = `INSERT INTO ${table} ("name") VALUES (${quoteString(file.name)});`;
      await runner.execute(`${sql}\n${trackingSql}`);
      console.log(`[${index + 1}/${pendingFiles.length}] ${file.name} ✅`);
    } catch (error) {
      console.log(`[${index + 1}/${pendingFiles.length}] ${file.name} ❌`);
      throw new Error(`Failed to apply ${file.name}: ${error.message}`, {
        cause: error,
      });
    }
  }

  return pendingFiles.length;
}
