import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  pullSiteExportDirectory,
  pullSiteExportZipFile,
} from "../../lib/site-pull-media.js";

function describeProgressUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.pathname || value;
  } catch {
    return value;
  }
}

function logPullProgress(event) {
  if (event.type === "scan-complete") {
    console.log(
      `Scanning export... found ${event.mediaReferences} referenced files in ${event.markdownFiles} content files`,
    );
    return;
  }

  if (event.type === "asset-downloaded") {
    console.log(
      `  [${event.index}/${event.total}] Downloaded ${describeProgressUrl(event.rawUrl)}`,
    );
    return;
  }

  if (event.type === "asset-reused") {
    console.log(
      `  [${event.index}/${event.total}] Reused ${describeProgressUrl(event.rawUrl)}`,
    );
    return;
  }

  if (event.type === "asset-failed") {
    console.log(
      `  [${event.index}/${event.total}] Failed ${describeProgressUrl(event.rawUrl)}${event.error ? ` (${event.error})` : ""}`,
    );
    return;
  }

  if (event.type === "rewrite-complete") {
    console.log(
      `Rewriting export files... updated ${event.filesUpdated} content files${event.configUpdated ? " and hugo.toml" : ""}`,
    );
  }
}

export async function run(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", short: "h" },
      path: { type: "string", default: "jant-site-export.zip" },
      output: { type: "string" },
    },
  });

  if (values.help) {
    console.log("Usage: jant site pull-media [options]");
    console.log("");
    console.log("Download referenced media into a Jant site export.");
    console.log("");
    console.log("Options:");
    console.log(
      "  --path         Path to an export ZIP or directory (default: jant-site-export.zip)",
    );
    console.log(
      "  --output       Output ZIP path when --path points to a ZIP (default: overwrite input)",
    );
    process.exit(0);
  }

  const inputPath = resolve(process.cwd(), values.path);
  const inputStat = await stat(inputPath).catch(() => null);
  if (!inputStat) {
    console.error(`Path not found: ${values.path}`);
    process.exit(1);
  }

  if (inputStat.isDirectory()) {
    if (values.output) {
      console.error("Error: --output is only supported for ZIP inputs");
      process.exit(1);
    }

    console.log(`Pulling media in ${values.path}...`);
    const stats = await pullSiteExportDirectory(inputPath, {
      logger: logPullProgress,
    });
    console.log(`Pulled media in ${values.path}`);
    console.log(
      `Media pull: pulled ${stats.downloaded} media files, ${stats.reused} already local, ${stats.failed} failed and were left as original URLs`,
    );
    return;
  }

  const outputPath = resolve(process.cwd(), values.output || values.path);
  console.log(`Pulling media in ${values.path}...`);
  const stats = await pullSiteExportZipFile(inputPath, outputPath, {
    logger: logPullProgress,
  });
  console.log(
    `Pulled media in ${values.path} -> ${values.output || values.path}`,
  );
  console.log(
    `Media pull: pulled ${stats.downloaded} media files, ${stats.reused} already local, ${stats.failed} failed and were left as original URLs`,
  );
}
