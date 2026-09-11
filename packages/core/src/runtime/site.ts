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
import { NotFoundError, SiteUnavailableError } from "../lib/errors.js";
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
      requestUrl.pathname === "/api/github-sync/app-webhook" ||
      requestUrl.pathname.startsWith("/api/telegram/webhook/")
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
    // The host resolved, so the site is real — it is just suspended (hosted
    // plan ended, or an operator took it down). Serving a 404 here told the
    // visitor the address was wrong and told crawlers to drop the site, both
    // of which are false while it can still be restored.
    throw new SiteUnavailableError();
  }
  return resolved;
}

/**
 * The site a CLI command was told to act on. The `jant` CLI builds it from
 * `--site <key|id>`, `--host <host>` with `--path-prefix`, or `--url <url>`
 * (see `parseCliSiteSelector` in `bin/lib/site-selection.js`).
 */
export type CliSiteSelector =
  | { kind: "site"; idOrKey: string }
  | {
      kind: "host";
      host: string;
      /** The domain's stored prefix (`/blog`), or null for a root domain. */
      pathPrefix: string | null;
    };

/**
 * Printed when a host-based CLI command names no site. Kept word for word with
 * the raw-SQL resolver the D1 path uses in `bin/lib/site-selection.js`.
 */
const HOST_BASED_CLI_SITE_REQUIRED_MESSAGE =
  "host-based mode needs a target site. Pass --site <key|id>, --host <host>, or --url <url>.";

async function resolveSelectedCliSite(
  db: Database,
  selector: CliSiteSelector,
  databaseSchema: DatabaseSchema,
): Promise<SiteLookupResult> {
  const siteService = createSiteService(db, databaseSchema);

  if (selector.kind === "site") {
    const site = await siteService.getByIdOrKey(selector.idOrKey);
    if (!site) {
      throw new Error(`No site found for --site ${selector.idOrKey}.`);
    }
    return {
      site,
      domain: await siteService.getPrimaryDomainForSite(site.id),
    };
  }

  const resolved = await siteService.resolveByHost(
    selector.host,
    selector.pathPrefix,
  );
  if (!resolved) {
    throw new Error(
      `No site found for host "${selector.host}"${selector.pathPrefix ? ` and path prefix "${selector.pathPrefix}"` : ""}.`,
    );
  }
  return resolved;
}

/**
 * Resolve the site a CLI command acts on.
 *
 * A selector wins in either mode. Without one, single-site mode uses the
 * instance's one site, and host-based mode fails before touching the
 * database: a hosted database holds every tenant, so there is no default to
 * fall back to — not even when it happens to hold one site today.
 *
 * @param db - The database
 * @param env - Bindings that carry `SITE_RESOLUTION_MODE` and the single-site
 *   origin
 * @param selector - The site the command was told to act on, if any
 * @param databaseSchema - The schema bundle for the database's dialect
 * @returns The site and its domain
 * @throws {Error} When the selector matches no site, when host-based mode has
 *   no selector, or when single-site mode has not finished setup
 * @example
 * ```ts
 * await resolveCliSite(db, env, { kind: "site", idOrKey: "demo" });
 * ```
 */
export async function resolveCliSite(
  db: Database,
  env: Bindings,
  selector: CliSiteSelector | null = null,
  databaseSchema: DatabaseSchema = sqliteSchemaBundle,
): Promise<SiteLookupResult> {
  if (selector) {
    return resolveSelectedCliSite(db, selector, databaseSchema);
  }

  if (getSiteResolutionMode(env) === "host-based") {
    throw new Error(HOST_BASED_CLI_SITE_REQUIRED_MESSAGE);
  }

  const resolved = await createSiteService(
    db,
    databaseSchema,
  ).resolveSingleSite({
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
