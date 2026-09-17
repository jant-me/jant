import { parseArgs } from "node:util";
import {
  loadNodeDevEnv,
  removeNodeDevSqlite,
  resolveNodeDevTarget,
} from "../node-dev-site.js";
import { describeScriptEnvPath } from "../script-env.js";

const TASK = "db-node-clean";

function printHelp() {
  console.log("Usage: node dev/run-script.mjs dev/scripts/clean-node-dev.ts");
  console.log("");
  console.log(
    "Delete the local Node SQLite database, its -wal and -shm files, and the local media directory.",
  );
  console.log(
    "Paths come from the env file and the Node runtime defaults, the same ones `mise run dev-node` uses.",
  );
  console.log("");
  console.log(
    "SQLite and local storage only. Drop a PostgreSQL database with your own tools.",
  );
}

export default async function main(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    printHelp();
    return;
  }

  const devEnv = loadNodeDevEnv();
  const target = resolveNodeDevTarget(devEnv.env, {
    task: TASK,
    sqliteOnly: true,
    localStorage: true,
  });

  const removed = await removeNodeDevSqlite(target);

  console.log(`Env file: ${describeScriptEnvPath(devEnv.envPath)}`);
  if (removed.length === 0) {
    console.log(`Nothing to delete at ${target.database}.`);
    return;
  }

  console.log("Deleted:");
  for (const path of removed) {
    console.log(`  ${path}`);
  }
}
