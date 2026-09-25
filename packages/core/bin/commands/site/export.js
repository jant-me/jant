import { createWriteStream, mkdirSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";
import {
  CLI_API_TOKEN_ENV_VAR,
  getCliApiToken,
} from "../../lib/cli-api-token.js";
import { pullSiteExportDirectory } from "../../lib/site-pull-media.js";
import {
  extractZipFile,
  writeDirectoryToZip,
} from "../../lib/zip-archive.js";

/**
 * Stream the site's export archive to a file. The site streams it too, and a
 * site that bundles its media answers with gigabytes.
 *
 * @param {string} url - Site URL
 * @param {string} token - API token
 * @param {string} destination - File to write
 */
async function downloadSiteArchive(url, token, destination) {
  const response = await fetch(`${url.replace(/\/$/, "")}/api/export/hugo`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  await mkdir(dirname(destination), { recursive: true });
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(destination),
  );
}

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
      `Pulling media references... found ${event.mediaReferences} referenced files in ${event.markdownFiles} content files`,
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

function printUsage() {
  console.log("Usage: jant site export <url> [options]");
  console.log("");
  console.log("Export a Jant site as a Hugo ZIP archive or directory.");
  console.log("");
  console.log("Arguments:");
  console.log("  <url>           Jant site URL (required)");
  console.log("");
  console.log("Options:");
  console.log(
    "  --output, -o    Output ZIP path (default: jant-site-export.zip)",
  );
  console.log(
    "  --directory, -d Export directly to a directory for hugo serve/debugging",
  );
  console.log(
    "  --pull-media    Download referenced media into static/media/ (default: on)",
  );
  console.log("  --no-pull-media Skip the media pull and keep original URLs");
  console.log("  --token         API token (overrides JANT_API_TOKEN)");
  console.log("");
  console.log("Authentication:");
  console.log(`  export ${CLI_API_TOKEN_ENV_VAR}=jnt_your_token`);
  console.log("  jant site export https://your-site.example");
  console.log("");
  console.log("Examples:");
  console.log("  jant site export https://your-site.example -o ./export.zip");
  console.log(
    "  jant site export https://your-site.example -d ./jant-site && cd ./jant-site && hugo serve",
  );
}

export async function run(argv) {
  const noPullMedia = argv.includes("--no-pull-media");
  const filteredArgv = argv.filter((arg) => arg !== "--no-pull-media");
  const { values, positionals } = parseArgs({
    args: filteredArgv,
    allowPositionals: true,
    options: {
      directory: {
        type: "string",
        short: "d",
      },
      help: { type: "boolean", short: "h" },
      "pull-media": { type: "boolean" },
      output: {
        type: "string",
        short: "o",
        default: "jant-site-export.zip",
      },
      token: { type: "string" },
    },
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  const url = positionals[0];
  if (!url) {
    console.error("Error: site URL is required");
    console.error("");
    printUsage();
    process.exit(1);
  }
  if (positionals.length > 1) {
    console.error(
      `Error: unexpected extra arguments: ${positionals.slice(1).join(" ")}`,
    );
    process.exit(1);
  }

  if (values.directory && values.output !== "jant-site-export.zip") {
    console.error("Error: use either --output or --directory, not both");
    process.exit(1);
  }

  const output = resolve(process.cwd(), values.output);
  const outputDirectory = values.directory
    ? resolve(process.cwd(), values.directory)
    : null;
  const token = getCliApiToken(process.env, values.token);
  const pullMedia = values["pull-media"] ?? !noPullMedia;

  if (!token) {
    console.error(
      `Error: site export requires ${CLI_API_TOKEN_ENV_VAR} or --token`,
    );
    process.exit(1);
  }

  // Fail before the download, not after it: pulling a real site's media
  // takes minutes.
  if (outputDirectory) {
    let existingEntries = [];
    try {
      mkdirSync(outputDirectory, { recursive: true });
      existingEntries = readdirSync(outputDirectory, {
        withFileTypes: true,
      }).filter((entry) => !entry.name.startsWith("."));
    } catch {
      console.error(`Error: couldn't prepare directory ${values.directory}`);
      process.exit(1);
    }
    if (existingEntries.length > 0) {
      console.error(
        `Error: directory is not empty: ${values.directory}. Choose an empty directory path.`,
      );
      process.exit(1);
    }
  }

  console.log(`Exporting site from ${url}...`);

  // Nothing to add: the site's archive is the export.
  if (!pullMedia && !outputDirectory) {
    console.log(`Writing ${values.output}...`);
    const partial = `${output}.partial`;
    try {
      await downloadSiteArchive(url, token, partial);
      await rename(partial, output);
    } catch (error) {
      await rm(partial, { force: true });
      throw error;
    }
    console.log(`Exported site from ${url} to ${values.output}`);
    return;
  }

  // Unpacked to disk and media downloaded next to it, so the export never
  // holds more than one media file in memory.
  const tempDir = await mkdtemp(join(tmpdir(), "jant-site-export-"));
  const workDir = outputDirectory ?? join(tempDir, "site");
  let pullStats = null;

  try {
    const archivePath = join(tempDir, "site.zip");
    await downloadSiteArchive(url, token, archivePath);
    await extractZipFile(archivePath, workDir);
    await rm(archivePath, { force: true });

    if (pullMedia) {
      console.log("Pulling media...");
      pullStats = await pullSiteExportDirectory(workDir, {
        assetLoader: null,
        logger: logPullProgress,
      });
    }

    if (outputDirectory) {
      console.log(`Exported site from ${url} to ${values.directory}`);
      console.log(`Preview with: cd ${values.directory} && hugo serve`);
    } else {
      console.log(`Writing ${values.output}...`);
      await writeDirectoryToZip(workDir, output);
      console.log(`Exported site from ${url} to ${values.output}`);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  if (pullStats) {
    const details = [
      `pulled ${pullStats.downloaded} media files`,
      pullStats.reused > 0 ? `${pullStats.reused} already local` : null,
      pullStats.failed > 0
        ? `${pullStats.failed} failed and were left as original URLs`
        : null,
    ]
      .filter(Boolean)
      .join(", ");
    console.log(`Media pull: ${details}`);
  }
}
