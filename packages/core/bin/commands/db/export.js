import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { D1_DUMP_PAGE_SIZE, queryD1 } from "../../lib/d1-query.js";
import { openNodeDatabase } from "../../lib/node-database.js";
import { dumpDatabaseToSql } from "../../lib/sql-export.js";
import {
  bootstrapCliRuntime,
  getCliRuntimeLabel,
} from "../../lib/runtime-target.js";

function createD1QueryRunner(runtime) {
  return {
    async query(sql, options) {
      return queryD1(sql, runtime, options);
    },
  };
}

export async function run(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: "string" },
      database: { type: "string", default: "DB" },
      env: { type: "string" },
      local: { type: "boolean", default: false },
      node: { type: "boolean", default: false },
      remote: { type: "boolean", default: false },
      output: { type: "string", short: "o", default: "jant-export.sql" },
      help: { type: "boolean", short: "h" },
      "persist-to": { type: "string" },
    },
  });

  if (values.help) {
    console.log(
      "Usage: jant db export [--local | --remote | --node] [--output <file>] [--config <file>] [--env <name>] [--database <binding>]",
    );
    console.log("");
    console.log("Export the current database to a SQL file.");
    console.log("");
    console.log("Options:");
    console.log("  --local           Force local D1 instead of DATABASE_URL");
    console.log(
      "  --remote          Export from remote D1 database (default: local)",
    );
    console.log(
      "  --node            Force Node runtime even if DATABASE_URL is unset",
    );
    console.log(
      "  --output, -o      Output file path (default: jant-export.sql)",
    );
    console.log(
      "  --config          Wrangler config file (default: wrangler.toml)",
    );
    console.log("  --env             Wrangler environment name");
    console.log("  --database        D1 binding name (default: DB)");
    console.log("  --persist-to      Local D1 state directory override");
    console.log("");
    console.log(
      "`.env.node` next to your project (or in packages/core/) is auto-loaded.",
    );
    console.log(
      "If DATABASE_URL or DATA_DIR is then set and no runtime flag is passed,",
    );
    console.log("this command uses the Node database runtime.");
    process.exit(0);
  }

  const { runtime } = bootstrapCliRuntime(values);
  const output = values.output;
  let sql;

  if (runtime === "node") {
    const nodeDatabase = await openNodeDatabase(process.env);
    try {
      sql = await dumpDatabaseToSql(
        {
          async query(statement) {
            return nodeDatabase.query(statement);
          },
        },
        {
          source: "node",
          dialect: nodeDatabase.database.dialect,
        },
      );
    } finally {
      await nodeDatabase.close();
    }
  } else {
    const d1Options = {
      configPath: values.config,
      database: values.database,
      env: values.env,
      persistTo: values["persist-to"],
    };
    const queryRunner = createD1QueryRunner(runtime);
    sql = await dumpDatabaseToSql(
      {
        async query(statement) {
          return queryRunner.query(statement, d1Options);
        },
      },
      {
        source: runtime === "d1-remote" ? "remote" : "local",
        dialect: "sqlite",
        // D1 answers through Wrangler's buffered output; read it in pages.
        pageSize: D1_DUMP_PAGE_SIZE,
      },
    );
  }

  const outPath = resolve(process.cwd(), output);
  writeFileSync(outPath, sql);
  console.log(`Exported ${getCliRuntimeLabel(runtime)} to ${output}`);
}
