import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { executeD1 } from "../../lib/d1-query.js";
import { openNodeDatabase } from "../../lib/node-database.js";
import {
  bootstrapCliRuntime,
  getCliRuntimeLabel,
} from "../../lib/runtime-target.js";

function formatUsage() {
  console.log(
    "Usage: jant db execute-file --file <path> [--local | --remote | --node] [--config <file>] [--env <name>] [--database <binding>]",
  );
  console.log("");
  console.log(
    "Execute a SQL file against the Node database runtime, local D1, or remote D1.",
  );
  console.log("");
  console.log("Options:");
  console.log("  --file             SQL file to execute");
  console.log("  --local            Force local D1 instead of DATABASE_URL");
  console.log("  --remote           Run against remote D1");
  console.log(
    "  --node             Force Node runtime even if DATABASE_URL is unset",
  );
  console.log(
    "  --config           Wrangler config file (default: wrangler.toml)",
  );
  console.log("  --env              Wrangler environment name");
  console.log("  --database         D1 binding name (default: DB)");
  console.log("  --persist-to       Local D1 state directory override");
  console.log("");
  console.log(
    "`.env` in the current directory is read, or the file JANT_ENV_FILE names.",
  );
  console.log(
    "If DATABASE_URL or DATA_DIR is then set and no runtime flag is passed,",
  );
  console.log("this command uses the Node database runtime.");
}

async function loadSqlFile(filePath) {
  const sql = await readFile(filePath, "utf-8");
  if (!sql.trim()) {
    throw new Error(`SQL file is empty: ${filePath}`);
  }
  return sql;
}

function normalizeD1Sql(sql) {
  // Remote D1 rejects SQL transaction control statements with code 7500.
  return sql
    .replace(/^\s*BEGIN(?:\s+TRANSACTION)?\s*;\s*$/gim, "")
    .replace(/^\s*COMMIT\s*;\s*$/gim, "")
    .replace(/^\s*ROLLBACK\s*;\s*$/gim, "")
    .trim();
}

export async function run(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: "string" },
      database: { type: "string", default: "DB" },
      env: { type: "string" },
      file: { type: "string" },
      help: { type: "boolean", short: "h" },
      local: { type: "boolean", default: false },
      node: { type: "boolean", default: false },
      "persist-to": { type: "string" },
      remote: { type: "boolean", default: false },
    },
  });

  if (values.help) {
    formatUsage();
    process.exit(0);
  }

  if (!values.file) {
    throw new Error("Missing required --file <path> argument.");
  }

  const { runtime } = bootstrapCliRuntime(values);
  const sql = await loadSqlFile(values.file);

  if (runtime === "node") {
    const nodeDatabase = await openNodeDatabase(process.env);
    try {
      await nodeDatabase.execute(sql);
    } finally {
      await nodeDatabase.close();
    }

    console.log(
      `Executed ${values.file} against Node database (${nodeDatabase.location}).`,
    );
    return;
  }

  const d1Sql = normalizeD1Sql(sql);
  if (!d1Sql) {
    throw new Error(
      `SQL file has no executable statements for D1: ${values.file}`,
    );
  }

  const statements = executeD1(d1Sql, runtime, {
    configPath: values.config,
    database: values.database,
    env: values.env,
    quiet: true,
    persistTo: values["persist-to"],
  });

  const statementCount = Array.isArray(statements) ? statements.length : 0;
  const statementLabel = statementCount === 1 ? "statement" : "statements";
  console.log(
    `Executed ${statementCount} ${statementLabel} from ${values.file} against ${getCliRuntimeLabel(runtime)}.`,
  );
}
