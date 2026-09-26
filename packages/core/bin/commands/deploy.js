import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { run as runMigrate } from "./migrate.js";
import {
  DEFAULT_PUBLISH_DIR,
  preparePublicAssets,
  resolvePackageClientRoot,
} from "../lib/public-assets.js";
import { findRenamedOption } from "../lib/renamed-arguments.js";
import { resolveSitePathPrefix } from "../lib/site-url.js";
import { resolveWranglerAssetsDirectory } from "../lib/wrangler-config.js";

function splitArgs(argv) {
  const separatorIndex = argv.indexOf("--");
  if (separatorIndex === -1) {
    return { commandArgs: argv, wranglerArgs: [] };
  }

  return {
    commandArgs: argv.slice(0, separatorIndex),
    wranglerArgs: argv.slice(separatorIndex + 1),
  };
}

function resolveDeployPlan(options) {
  const sitePathPrefix = resolveSitePathPrefix({
    config: options.config,
    env: options.env,
    sitePathPrefix: options.sitePathPrefix,
  });

  if (sitePathPrefix) {
    return {
      assetsDir: resolve(process.cwd(), options.output),
      needsPrepare: true,
      sitePathPrefix,
    };
  }

  const configuredAssetsDir = resolveWranglerAssetsDirectory({
    configPath: options.config,
    env: options.env,
  });

  return {
    assetsDir: configuredAssetsDir
      ? resolve(process.cwd(), configuredAssetsDir)
      : resolvePackageClientRoot(import.meta.url),
    needsPrepare: false,
    sitePathPrefix,
  };
}

export async function run(argv) {
  const { commandArgs, wranglerArgs } = splitArgs(argv);
  const renamed = findRenamedOption("deploy", commandArgs, {
    "--site-path-prefix": "--path-prefix",
  });
  if (renamed) {
    console.error(`Error: ${renamed}`);
    process.exit(1);
  }
  const { values } = parseArgs({
    args: commandArgs,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      config: { type: "string", short: "c", default: "wrangler.toml" },
      env: { type: "string", short: "e" },
      output: { type: "string", short: "o", default: DEFAULT_PUBLISH_DIR },
      "path-prefix": { type: "string" },
      database: { type: "string", default: "DB" },
      "skip-migrate": { type: "boolean", default: false },
    },
  });

  if (values.help) {
    console.log("Usage: jant deploy [options] [-- <wrangler deploy args...>]");
    console.log("");
    console.log(
      "Apply remote migrations and deploy to Cloudflare Workers with the correct static asset directory.",
    );
    console.log("");
    console.log("Options:");
    console.log(
      "  -c, --config <path>     Wrangler config path (default: wrangler.toml)",
    );
    console.log("  -e, --env <name>        Wrangler environment name");
    console.log(
      `  -o, --output <path>     Publish directory for prefixed asset deploys (default: ${DEFAULT_PUBLISH_DIR})`,
    );
    console.log(
      "      --path-prefix <path> Override SITE_PATH_PREFIX instead of reading config",
    );
    console.log(
      "      --database <name>   D1 binding name for migrations (default: DB)",
    );
    console.log("      --skip-migrate      Skip remote migrations");
    console.log("");
    console.log(
      "Root-path deploys reuse the configured assets directory directly.",
    );
    console.log(
      "Subpath deploys automatically prepare a publish directory first.",
    );
    process.exit(0);
  }

  const plan = resolveDeployPlan({
    config: values.config,
    env: values.env,
    output: values.output,
    sitePathPrefix: values["path-prefix"],
  });

  if (!values["skip-migrate"]) {
    console.log("Running remote migrations...");
    const migrateArgs = ["--remote", "--database", values.database];
    if (values.config) {
      migrateArgs.push("--config", values.config);
    }
    if (values.env) {
      migrateArgs.push("--env", values.env);
    }
    await runMigrate(migrateArgs);
  }

  let assetsDir = plan.assetsDir;
  if (plan.needsPrepare) {
    console.log(`Preparing static assets for ${plan.sitePathPrefix || "/"}...`);
    const prepared = await preparePublicAssets({
      outputDir: values.output,
      sitePathPrefix: plan.sitePathPrefix,
    });
    assetsDir = prepared.outputDir;
  }

  console.log(`Deploying with assets from ${assetsDir}...`);

  const wranglerBin =
    process.platform === "win32" ? "wrangler.cmd" : "wrangler";
  const deployArgs = ["deploy", "--assets", assetsDir];
  if (values.config) {
    deployArgs.push("--config", values.config);
  }
  if (values.env) {
    deployArgs.push("--env", values.env);
  }
  deployArgs.push(...wranglerArgs);

  const result = spawnSync(wranglerBin, deployArgs, {
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.signal) {
    throw new Error(`wrangler deploy exited due to signal ${result.signal}.`);
  }

  if ((result.status ?? 1) !== 0) {
    throw new Error(
      `wrangler deploy failed with exit code ${result.status ?? 1}.`,
    );
  }
}
