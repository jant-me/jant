import { parseArgs } from "node:util";
import { loadNodeRuntime } from "../lib/load-node-runtime.js";
import { autoloadNodeEnv } from "../lib/node-env.js";

export async function run(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log("Usage: jant start");
    console.log("");
    console.log("Start the Node.js server using environment variables.");
    console.log(
      "Reads `.env` in the current directory, or the file JANT_ENV_FILE",
    );
    console.log("names. Variables already set in the environment win.");
    console.log("");
    console.log("Required:");
    console.log("  AUTH_SECRET=your-secret");
    console.log("");
    console.log("Single-site mode usually also sets:");
    console.log("  SITE_ORIGIN=https://your-site.example");
    console.log("");
    console.log("Database:");
    console.log("  DATABASE_URL=file:<data-dir>/jant.sqlite");
    console.log("  DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DBNAME");
    console.log("");
    console.log("Node defaults:");
    console.log("  DATA_DIR=./data");
    console.log("  LOCAL_STORAGE_PATH=<data-dir>/media");
    console.log("  SITE_PATH_PREFIX=");
    console.log("  SITE_RESOLUTION_MODE=single-site");
    console.log("  STORAGE_DRIVER defaults to local on Node");
    console.log("");
    console.log("Host-based mode also requires:");
    console.log("  HOSTED_CONTROL_PLANE_BASE_URL=https://cloud.example");
    console.log("  HOSTED_CONTROL_PLANE_INTERNAL_TOKEN=...");
    console.log("  INTERNAL_ADMIN_TOKEN=...");
    console.log("  HOSTED_CONTROL_PLANE_DOMAIN_CHECK_SECRET=32+ chars");
    console.log("  HOSTED_CONTROL_PLANE_SSO_SECRET=32+ chars");
    process.exit(0);
  }

  autoloadNodeEnv();
  const { start } = await loadNodeRuntime();
  const handle = await start();
  console.log(`Jant listening on ${handle.url}`);
}
