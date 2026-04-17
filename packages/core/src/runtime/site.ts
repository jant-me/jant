import type { Database } from "../db/index.js";
import {
  sqliteSchemaBundle,
  type DatabaseSchema,
} from "../db/schema-bundle.js";
import {
  getConfiguredSingleSiteOrigin,
  getConfiguredSingleSitePathPrefix,
  getConfiguredSingleSiteUrl,
  getSiteResolutionMode,
} from "../lib/env.js";
import { buildSiteUrl, normalizeSiteUrl } from "../lib/url.js";
import {
  createSiteService,
  createTransientSite,
  type EnsureSingleSiteOptions,
  type SiteLookupResult,
  TRANSIENT_SINGLE_SITE_ID,
} from "../services/site.js";
import { NotFoundError } from "../lib/errors.js";
import type { Bindings } from "../types/bindings.js";

function logHostedSiteResolutionFailure(input: {
  host: string;
  pathname: string;
  reason: "host-not-found" | "site-not-active";
  siteId?: string;
  siteKey?: string;
  siteStatus?: string;
}): void {
  const details = [
    `host=${input.host}`,
    `path=${input.pathname}`,
    `reason=${input.reason}`,
  ];

  if (input.siteId) {
    details.push(`siteId=${input.siteId}`);
  }

  if (input.siteKey) {
    details.push(`siteKey=${input.siteKey}`);
  }

  if (input.siteStatus) {
    details.push(`siteStatus=${input.siteStatus}`);
  }

  // eslint-disable-next-line no-console -- Hosted site routing misses must be visible in server logs.
  console.error(`[Jant] Hosted site resolution failed: ${details.join(" ")}`);
}

export function getSingleSiteBootstrapOptions(
  env: Bindings,
): EnsureSingleSiteOptions | undefined {
  const configuredSiteOrigin = getConfiguredSingleSiteOrigin(env).trim();
  if (!configuredSiteOrigin) {
    return undefined;
  }

  const parsed = new URL(normalizeSiteUrl(configuredSiteOrigin));
  return {
    host: parsed.host,
    pathPrefix: getConfiguredSingleSitePathPrefix(env) || null,
  };
}

export async function resolveRequestSite(
  db: Database,
  env: Bindings,
  publicRequestUrl: string,
  databaseSchema: DatabaseSchema = sqliteSchemaBundle,
): Promise<SiteLookupResult> {
  const siteService = createSiteService(db, databaseSchema);
  const resolutionMode = getSiteResolutionMode(env);
  const requestUrl = new URL(publicRequestUrl);

  if (resolutionMode === "single-site") {
    return siteService.resolveSingleSite({
      ...getSingleSiteBootstrapOptions(env),
      createIfMissing: false,
    });
  }

  const resolved = await siteService.resolveByHost(requestUrl.host);
  if (!resolved) {
    // Host-agnostic endpoints: these are reached via the control-plane
    // host (jant-cloud) or a fixed core host, not a tenant host, so
    // host-based site resolution cannot pin them to a tenant. The
    // handlers resolve affected sites themselves (e.g. from the webhook
    // payload's installation id) instead of relying on `currentSite`.
    if (
      requestUrl.pathname.startsWith("/api/internal/") ||
      requestUrl.pathname === "/api/github-sync/app-webhook"
    ) {
      return {
        site: createTransientSite("internal"),
        domain: null,
      };
    }
    logHostedSiteResolutionFailure({
      host: requestUrl.host,
      pathname: requestUrl.pathname,
      reason: "host-not-found",
    });
    throw new NotFoundError("Site");
  }
  if (resolved.site.status !== "active") {
    logHostedSiteResolutionFailure({
      host: requestUrl.host,
      pathname: requestUrl.pathname,
      reason: "site-not-active",
      siteId: resolved.site.id,
      siteKey: resolved.site.key,
      siteStatus: resolved.site.status,
    });
    throw new NotFoundError("Site");
  }
  return resolved;
}

export async function resolveCliSite(
  db: Database,
  env: Bindings,
  databaseSchema: DatabaseSchema = sqliteSchemaBundle,
): Promise<SiteLookupResult> {
  const siteService = createSiteService(db, databaseSchema);
  const resolutionMode = getSiteResolutionMode(env);

  if (resolutionMode === "single-site") {
    const resolved = await siteService.resolveSingleSite({
      ...getSingleSiteBootstrapOptions(env),
      createIfMissing: false,
    });

    if (resolved.site.id === TRANSIENT_SINGLE_SITE_ID) {
      throw new Error(
        "No site is configured for this instance yet. Finish /setup before running this command.",
      );
    }

    return resolved;
  }

  const onlySite = await siteService.getOnlySite();
  if (!onlySite) {
    throw new Error(
      "CLI site selection for host-based mode is not implemented yet.",
    );
  }

  return {
    site: onlySite,
    domain: null,
  };
}

export function getResolvedSiteBaseUrl(
  env: Bindings,
  publicRequestUrl: string,
  pathPrefix?: string | null,
): string {
  const resolutionMode = getSiteResolutionMode(env);
  if (resolutionMode === "single-site") {
    return (
      getConfiguredSingleSiteUrl(env) ||
      buildSiteUrl(
        new URL(publicRequestUrl).origin,
        getConfiguredSingleSitePathPrefix(env),
      )
    );
  }

  const requestUrl = new URL(publicRequestUrl);
  const normalizedPathPrefix = pathPrefix?.trim() || "";
  return `${requestUrl.origin}${normalizedPathPrefix}`;
}
