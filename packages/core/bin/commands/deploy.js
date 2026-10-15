import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { run as runMigrate } from "./migrate.js";
import {
  BEFORE_GOING_LIVE_URL,
  needsFirstDeploySetup,
  runFirstDeploySetup,
} from "../lib/cloudflare-setup.js";
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

/**
 * Decide what a `--ci` run does before it deploys.
 *
 * The deploy workflow create-jant projects ship runs on every push, also in
 * repos that deploy another way: one-click deploys build with Cloudflare's
 * Workers Builds and have no Cloudflare secrets in GitHub. With neither
 * credential set there is nothing to deploy with, so the run is skipped
 * without failing. Half the credentials means a deploy was meant, so that
 * fails. A `database_id` that is still the placeholder fails too: the first
 * deploy writes the real ID into `wrangler.toml`, and a CI checkout can't
 * commit it, so the first deploy belongs on the author's computer.
 *
 * @param {{ env: Record<string, string | undefined>, needsSetup: boolean }} input
 *   - `env`: the environment the deploy runs in
 *   - `needsSetup`: whether `database_id` is still the placeholder
 * @returns {{ action: "deploy" } | { action: "skip" | "fail", message: string }}
 * @example
 * ciPreflight({ env: {}, needsSetup: false });
 * // { action: "skip", message: "Deploy skipped: ..." }
 */
export function ciPreflight({ env, needsSetup }) {
  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();

  if (!token && !accountId) {
    return {
      action: "skip",
      message:
        "Deploy skipped: neither CLOUDFLARE_API_TOKEN nor CLOUDFLARE_ACCOUNT_ID is set. A repo Cloudflare already deploys, such as one made by one-click deploy, needs neither. To deploy from GitHub Actions, add the CF_API_TOKEN and CF_ACCOUNT_ID repository secrets.",
    };
  }
  if (!token) {
    return {
      action: "fail",
      message:
        "CLOUDFLARE_ACCOUNT_ID is set but CLOUDFLARE_API_TOKEN isn't. Add the API token (the CF_API_TOKEN repository secret in the GitHub workflow), or remove both to skip deploys from here.",
    };
  }
  if (needsSetup) {
    return {
      action: "fail",
      message:
        'wrangler.toml still has database_id = "local". Run the first deploy on your computer with `jant deploy` (`npm run deploy` in a create-jant project): it creates the D1 database and writes its ID into wrangler.toml. Then commit wrangler.toml.',
    };
  }
  return { action: "deploy" };
}

/**
 * Add a line to the GitHub Actions run summary, when there is one.
 *
 * @param {string} message - What to show
 * @param {Record<string, string | undefined>} env - The environment to read
 *   `GITHUB_STEP_SUMMARY` from
 * @returns {void}
 * @example
 * writeStepSummary("Deploy skipped: ...", process.env);
 */
function writeStepSummary(message, env) {
  if (!env.GITHUB_STEP_SUMMARY) return;
  appendFileSync(env.GITHUB_STEP_SUMMARY, `### jant deploy\n\n${message}\n`);
}

/**
 * Whether the arguments passed on to `wrangler deploy` ask for a dry run.
 * Only Wrangler sees the flag: the remote migrations and the first-deploy
 * setup run before it, so a dry run has to skip both.
 *
 * @param {string[]} wranglerArgs - The arguments after `--`
 * @returns {boolean} True when one of them is `--dry-run`
 * @example
 * asksForDryRun(["--dry-run"]); // true
 */
export function asksForDryRun(wranglerArgs) {
  return wranglerArgs.some(
    (arg) => arg === "--dry-run" || arg.startsWith("--dry-run="),
  );
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
      ci: { type: "boolean", default: false },
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
    console.log(
      "      --ci                Deploy from an automated run, such as GitHub Actions",
    );
    console.log("");
    console.log(
      'The first deploy of a new project, whose D1 database_id is still "local",',
    );
    console.log(
      "creates the D1 database, the R2 buckets, and AUTH_SECRET on Cloudflare,",
    );
    console.log(
      "reusing any that already exist, and writes the database ID to wrangler.toml.",
    );
    console.log("");
    console.log(
      "With --ci, a run with neither CLOUDFLARE_API_TOKEN nor CLOUDFLARE_ACCOUNT_ID",
    );
    console.log(
      'set is skipped without failing, and a database_id that is still "local" fails',
    );
    console.log("instead of running the first deploy.");
    console.log("");
    console.log(
      "Root-path deploys reuse the configured assets directory directly.",
    );
    console.log(
      "Subpath deploys automatically prepare a publish directory first.",
    );
    process.exit(0);
  }

  const needsSetup = needsFirstDeploySetup({
    configPath: values.config,
    env: values.env,
    database: values.database,
  });

  if (asksForDryRun(wranglerArgs)) {
    if (!values["skip-migrate"]) {
      console.error(
        "Error: `-- --dry-run` reaches Wrangler only after the remote migrations have run. Add --skip-migrate to dry-run the Worker upload alone.",
      );
      process.exit(1);
    }
    if (needsSetup) {
      console.error(
        "Error: A dry run can't make the first deploy, which creates the Cloudflare resources and writes database_id into wrangler.toml. Deploy once without --dry-run first.",
      );
      process.exit(1);
    }
  }

  if (values.ci) {
    const preflight = ciPreflight({ env: process.env, needsSetup });
    if (preflight.action !== "deploy") {
      writeStepSummary(preflight.message, process.env);
      if (preflight.action === "fail") {
        console.error(`Error: ${preflight.message}`);
        process.exit(1);
      }
      console.log(preflight.message);
      return;
    }
  }

  const setup = needsSetup
    ? await runFirstDeploySetup({
        configPath: values.config,
        env: values.env,
        database: values.database,
      })
    : null;

  try {
    await deploy(values, wranglerArgs, setup?.secretsFile ?? null);
  } catch (error) {
    if (setup) {
      setup.restore();
      console.error(
        'wrangler.toml is back to database_id = "local". Deploying again reuses what this run created.',
      );
    }
    throw error;
  } finally {
    setup?.cleanup();
  }

  if (setup) {
    console.log("");
    console.log(
      "First deploy done. Commit wrangler.toml: it now holds the D1 database ID.",
    );
    console.log(
      "Open the URL above to create the admin account. To use your own domain, bind it first:",
    );
    console.log(BEFORE_GOING_LIVE_URL);
  }
}

async function deploy(values, wranglerArgs, secretsFile) {
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
  if (secretsFile) {
    deployArgs.push("--secrets-file", secretsFile);
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
