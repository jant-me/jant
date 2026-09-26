import { parseArgs } from "node:util";
import { resolveSiteUrl } from "../../lib/site-url.js";

const INTERNAL_ADMIN_TOKEN_ENV_VAR = "INTERNAL_ADMIN_TOKEN";
const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 500;

function normalizeBaseUrl(value) {
  const trimmed = value.trim();
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function buildReindexUrl(siteUrl) {
  return new URL(
    "api/internal/search/reindex",
    normalizeBaseUrl(siteUrl),
  ).toString();
}

function parseBatchSize(rawLimit) {
  if (rawLimit === undefined) {
    return DEFAULT_BATCH_SIZE;
  }

  const limit = Number.parseInt(rawLimit, 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH_SIZE) {
    throw new Error(
      `Batch size must be an integer between 1 and ${MAX_BATCH_SIZE}.`,
    );
  }
  return limit;
}

async function requestBatch(url, token, { limit, cursor }) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cursor ? { limit, cursor } : { limit }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
  }

  return response.json();
}

function logBatchResult(batchIndex, result) {
  console.log(
    `  batch ${batchIndex}: processed=${result.processed} updated=${result.updated} skipped=${result.skipped}`,
  );
}

export async function run(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: "string" },
      env: { type: "string" },
      help: { type: "boolean", short: "h" },
      limit: { type: "string" },
      once: { type: "boolean", default: false },
      token: { type: "string" },
      url: { type: "string" },
    },
  });

  if (values.help) {
    console.log("Usage: jant search reindex [--url <url>] [options]");
    console.log("");
    console.log("Rebuild the search index for every non-deleted post by");
    console.log("recomputing `post.body_text` from the stored TipTap body.");
    console.log("Useful after changes to the text extraction logic — for");
    console.log("example, indexing link URLs from inline markdown links.");
    console.log("");
    console.log(
      "Idempotent: rows whose body_text is already up to date are skipped.",
    );
    console.log("");
    console.log("Options:");
    console.log("  --url           Target site URL");
    console.log(
      `  --limit         Batch size per request (default: ${DEFAULT_BATCH_SIZE}, max: ${MAX_BATCH_SIZE})`,
    );
    console.log(
      "  --once          Run a single batch and exit (default: loop until drained)",
    );
    console.log("  --token         Internal admin token");
    console.log(
      "  --config        Wrangler config file (default: wrangler.toml)",
    );
    console.log("  --env           Wrangler environment name");
    console.log("");
    console.log("Authentication:");
    console.log(
      `  export ${INTERNAL_ADMIN_TOKEN_ENV_VAR}=your-internal-admin-token`,
    );
    console.log("  jant search reindex --url https://your-site.example");
    console.log("");
    console.log(
      "If --url is omitted, uses SITE_ORIGIN + SITE_PATH_PREFIX from env or wrangler.toml.",
    );
    process.exit(0);
  }

  const siteUrl = resolveSiteUrl({
    url: values.url,
    config: values.config,
    env: values.env,
  });
  if (!siteUrl) {
    console.error(
      "Error: search reindex requires --url or SITE_ORIGIN in the environment or wrangler.toml.",
    );
    process.exit(1);
  }

  const token =
    values.token?.trim() || process.env[INTERNAL_ADMIN_TOKEN_ENV_VAR]?.trim();
  if (!token) {
    console.error(
      `Error: search reindex requires --token or ${INTERNAL_ADMIN_TOKEN_ENV_VAR}.`,
    );
    process.exit(1);
  }

  const batchSize = parseBatchSize(values.limit);
  const reindexUrl = buildReindexUrl(siteUrl);

  console.log(`Rebuilding search index for ${siteUrl}`);
  console.log(
    `  batch size: ${batchSize}${values.once ? " (single batch)" : ""}`,
  );

  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let batchIndex = 0;
  let cursor;

  for (;;) {
    batchIndex += 1;
    const result = await requestBatch(reindexUrl, token, {
      limit: batchSize,
      cursor,
    });
    logBatchResult(batchIndex, result);

    totalProcessed += result.processed;
    totalUpdated += result.updated;
    totalSkipped += result.skipped;

    if (values.once) break;
    if (result.done) break;

    // Stop if the server didn't advance the cursor — shouldn't happen with
    // the service-level contract, but avoids an infinite loop just in case.
    if (!result.nextCursor || result.nextCursor === cursor) {
      console.error(
        "Server returned no next cursor but reported more work; aborting to avoid an infinite loop.",
      );
      break;
    }
    cursor = result.nextCursor;
  }

  console.log("");
  console.log(
    `Done. processed=${totalProcessed} updated=${totalUpdated} skipped=${totalSkipped} batches=${batchIndex}`,
  );
}
