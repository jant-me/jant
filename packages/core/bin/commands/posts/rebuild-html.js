import { parseArgs } from "node:util";
import { resolveSiteUrl } from "../../lib/site-url.js";

const INTERNAL_ADMIN_TOKEN_ENV_VAR = "INTERNAL_ADMIN_TOKEN";
const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;

function normalizeBaseUrl(value) {
  const trimmed = value.trim();
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function buildRebuildUrl(siteUrl, siteId) {
  const path = siteId
    ? `api/internal/sites/${encodeURIComponent(siteId)}/posts/body-html/rebuild`
    : "api/internal/posts/body-html/rebuild";
  return new URL(path, normalizeBaseUrl(siteUrl)).toString();
}

function parseBatchSize(rawLimit) {
  if (rawLimit === undefined) return DEFAULT_BATCH_SIZE;

  const limit = Number.parseInt(rawLimit, 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH_SIZE) {
    throw new Error(
      `Batch size must be an integer between 1 and ${MAX_BATCH_SIZE}.`,
    );
  }
  return limit;
}

async function requestBatch(url, token, { limit, cursor, dryRun }) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      limit,
      ...(cursor ? { cursor } : {}),
      ...(dryRun ? { dryRun: true } : {}),
    }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `HTTP ${response.status}: ${responseText || response.statusText}`,
    );
  }

  return response.json();
}

function logBatchResult(batchIndex, result) {
  console.log(
    `  batch ${batchIndex}: processed=${result.processed} wouldRebuild=${result.wouldRebuild} rebuilt=${result.rebuilt} wouldUpgradeFootnotes=${result.wouldUpgradeFootnotes ?? 0} upgradedFootnotes=${result.upgradedFootnotes ?? 0} skipped=${result.skipped} conflicted=${result.conflicted} failed=${result.failed}`,
  );
  for (const failure of result.failures ?? []) {
    console.error(`    ${failure.postId}: ${failure.error}`);
  }
}

export async function run(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      env: { type: "string" },
      help: { type: "boolean", short: "h" },
      limit: { type: "string" },
      once: { type: "boolean", default: false },
      site: { type: "string" },
      token: { type: "string" },
      url: { type: "string" },
    },
  });

  if (values.help) {
    console.log("Usage: jant posts rebuild-html [--url <url>] [options]");
    console.log("");
    console.log(
      "Upgrade recognized legacy footnotes and rebuild stored post body HTML.",
    );
    console.log(
      "The operation is site-scoped, cursor-paginated, and idempotent.",
    );
    console.log("");
    console.log("Options:");
    console.log("  --url           Target site or internal core URL");
    console.log(
      "  --site          Explicit managed site TypeID (host-based mode)",
    );
    console.log(
      `  --limit         Batch size (default: ${DEFAULT_BATCH_SIZE}, max: ${MAX_BATCH_SIZE})`,
    );
    console.log("  --dry-run       Report changes without writing them");
    console.log("  --once          Run one batch and exit");
    console.log("  --token         Internal admin token");
    console.log("  --config        Wrangler config file");
    console.log("  --env           Wrangler environment name");
    process.exit(0);
  }

  const siteUrl = resolveSiteUrl({
    url: values.url,
    config: values.config,
    env: values.env,
  });
  if (!siteUrl) {
    throw new Error(
      "posts rebuild-html requires --url or SITE_ORIGIN in the environment or wrangler.toml.",
    );
  }

  const token =
    values.token?.trim() || process.env[INTERNAL_ADMIN_TOKEN_ENV_VAR]?.trim();
  if (!token) {
    throw new Error(
      `posts rebuild-html requires --token or ${INTERNAL_ADMIN_TOKEN_ENV_VAR}.`,
    );
  }

  const siteId = values.site?.trim();
  const limit = parseBatchSize(values.limit);
  const dryRun = values["dry-run"];
  const rebuildUrl = buildRebuildUrl(siteUrl, siteId);
  const scope = siteId ? `managed site ${siteId}` : siteUrl;

  console.log(`${dryRun ? "Checking" : "Rebuilding"} post HTML for ${scope}`);
  console.log(
    `  batch size: ${limit}${values.once ? " (single batch)" : ""}${dryRun ? " (dry run)" : ""}`,
  );

  const totals = {
    processed: 0,
    wouldRebuild: 0,
    rebuilt: 0,
    wouldUpgradeFootnotes: 0,
    upgradedFootnotes: 0,
    skipped: 0,
    conflicted: 0,
    failed: 0,
  };
  let cursor;
  let batchIndex = 0;
  let targetVersion;

  for (;;) {
    batchIndex += 1;
    const result = await requestBatch(rebuildUrl, token, {
      limit,
      cursor,
      dryRun,
    });
    logBatchResult(batchIndex, result);

    for (const key of Object.keys(totals)) {
      totals[key] += result[key] ?? 0;
    }
    targetVersion = result.targetVersion;

    if (values.once || result.done) break;
    if (!result.nextCursor || result.nextCursor === cursor) {
      throw new Error(
        "Server reported more work without advancing the cursor; aborting.",
      );
    }
    cursor = result.nextCursor;
  }

  console.log("");
  console.log(
    `Done. targetVersion=${targetVersion ?? "unknown"} processed=${totals.processed} wouldRebuild=${totals.wouldRebuild} rebuilt=${totals.rebuilt} wouldUpgradeFootnotes=${totals.wouldUpgradeFootnotes} upgradedFootnotes=${totals.upgradedFootnotes} skipped=${totals.skipped} conflicted=${totals.conflicted} failed=${totals.failed} batches=${batchIndex}`,
  );

  if (totals.failed > 0 || totals.conflicted > 0) {
    throw new Error(
      "Some rows were not rebuilt. Fix invalid bodies or rerun after concurrent edits settle.",
    );
  }
}
