import { parseArgs } from "node:util";
import {
  DEFAULT_PUBLISH_DIR,
  preparePublicAssets,
} from "../../lib/public-assets.js";
import { resolveSitePathPrefix } from "../../lib/site-url.js";

const DEFAULT_CONFIG_PATH = "wrangler.toml";

export async function run(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", short: "h" },
      config: { type: "string", short: "c", default: DEFAULT_CONFIG_PATH },
      env: { type: "string", short: "e" },
      output: { type: "string", short: "o", default: DEFAULT_PUBLISH_DIR },
      "path-prefix": { type: "string" },
    },
  });

  if (values.help) {
    console.log("Usage: jant assets prepare [options]");
    console.log("");
    console.log(
      "Generate a Cloudflare publish directory for production assets.",
    );
    console.log("");
    console.log("Options:");
    console.log(
      `  -c, --config <path>     Wrangler config path (default: ${DEFAULT_CONFIG_PATH})`,
    );
    console.log("  -e, --env <name>        Wrangler environment name");
    console.log(
      `  -o, --output <path>     Output directory (default: ${DEFAULT_PUBLISH_DIR})`,
    );
    console.log(
      "      --path-prefix <path> Override SITE_PATH_PREFIX instead of reading config",
    );
    process.exit(0);
  }

  const sitePathPrefix = resolveSitePathPrefix({
    config: values.config,
    env: values.env,
    sitePathPrefix: values["path-prefix"],
  });
  const prepared = await preparePublicAssets({
    outputDir: values.output,
    sitePathPrefix,
  });

  console.log(`Prepared public assets in ${prepared.outputDir}`);
  console.log(`Public asset base path: ${prepared.publicAssetBasePath}`);
}
