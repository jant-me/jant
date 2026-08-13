import { createAuth, type Auth } from "../auth.js";
import { createDatabase, type Database } from "../db/index.js";
import { sqliteSchemaBundle } from "../db/schema-bundle.js";
import {
  getAuthSecret,
  getEnvString,
  getHostedControlPlaneProviderLabel,
  getHostedControlPlaneSsoSecret,
  getSiteResolutionMode,
  shouldUseSecureCookies,
} from "../lib/env.js";
import { createHostedControlPlaneClient } from "../lib/hosted-control-plane.js";
import { createD1RateLimiter } from "../lib/rate-limit-d1.js";
import type { RateLimiter } from "../lib/rate-limit.js";
import { createStorageDriver, type StorageDriver } from "../lib/storage.js";
import {
  createHostedHandoffService,
  type HostedHandoffService,
} from "../services/hosted-handoff.js";
import { createServices, type Services } from "../services/index.js";
import type { Bindings } from "../types/bindings.js";
import type { Site, SiteDomain } from "../types/entities.js";
import {
  getResolvedSiteBaseUrl,
  getSingleSiteBootstrapOptions,
  resolveRequestSite,
} from "./site.js";

export interface CloudflareRequestRuntime {
  auth: Auth;
  currentSite: Site;
  currentSiteDomain: SiteDomain | null;
  db: Database;
  hostedHandoff: HostedHandoffService;
  rateLimiter: RateLimiter;
  services: Services;
  /**
   * Builds a `Services` object scoped to an arbitrary site. Used by
   * host-agnostic handlers (e.g. the Telegram webhook) that resolve the
   * target site from request data rather than the hostname.
   */
  servicesForSite: (siteId: string) => Services;
  storage: StorageDriver | null;
}

/**
 * Builds the per-request runtime objects for the current Cloudflare path.
 *
 * This isolates the Worker-specific database/session wiring so the app factory
 * can evolve toward runtime-agnostic composition.
 */
export async function createCloudflareRequestRuntime(
  env: Bindings,
  publicRequestUrl: string,
  options?: {
    /**
     * Anchor this request's first read to the primary instead of any replica.
     * Set for requests that carry a session cookie — see `createRequestRuntime`.
     */
    anchorReadsToPrimary?: boolean;
  },
): Promise<CloudflareRequestRuntime> {
  if (!env.DB) {
    throw new Error("Cloudflare runtime requires a DB binding.");
  }
  const authSecret = getAuthSecret(env);
  const hostedControlPlaneSsoSecret = getHostedControlPlaneSsoSecret(env);
  if (!authSecret) {
    throw new Error("AUTH_SECRET should be set after startup validation.");
  }

  // Use withSession() to enable D1 Read Replication. The constraint applies to
  // the session's *first* query; every later query is anchored to the bookmark
  // that one returns, so the whole request is sequentially consistent.
  //
  // Bookmarks are not carried across requests, so an unconstrained first read
  // may land on a replica that has not caught up yet. For anonymous traffic
  // that is fine and it is the point of replication. For a request holding a
  // session cookie it is not: the session row is written on the primary, and a
  // lagging replica answers "no such session" — the visitor is bounced to
  // sign-in even though they never signed out.
  const session = env.DB.withSession(
    options?.anchorReadsToPrimary ? "first-primary" : "first-unconstrained",
  );

  // Note: Drizzle ORM doesn't officially support D1DatabaseSession yet
  // (issue #2226), but it works at runtime.
  const db = createDatabase(session as unknown as D1Database);
  const slugIdLength =
    parseInt(getEnvString(env, "SLUG_ID_LENGTH") ?? "5", 10) || 5;
  const siteLookup = await resolveRequestSite(db, env, publicRequestUrl);
  const baseURL = getResolvedSiteBaseUrl(
    env,
    publicRequestUrl,
    siteLookup.domain?.pathPrefix ?? null,
  );
  const auth = createAuth(db, {
    allowSystemUserProvisioning:
      Boolean(hostedControlPlaneSsoSecret) &&
      getSiteResolutionMode(env) === "host-based",
    secret: authSecret,
    baseURL,
    databaseDialect: "sqlite",
    schema: sqliteSchemaBundle,
    useSecureCookies: shouldUseSecureCookies(env, publicRequestUrl),
  });

  const servicesConfig = {
    databaseDialect: "sqlite" as const,
    bootstrapSite: getSingleSiteBootstrapOptions(env),
    enforceHostedMediaQuota: getSiteResolutionMode(env) === "host-based",
    hostedControlPlane: createHostedControlPlaneClient(env),
    siteResolutionMode: getSiteResolutionMode(env),
    slugIdLength,
    schema: sqliteSchemaBundle,
  };
  const servicesForSite = (siteId: string): Services =>
    createServices(db, session, siteId, servicesConfig);

  return {
    auth,
    currentSite: siteLookup.site,
    currentSiteDomain: siteLookup.domain,
    db,
    hostedHandoff: createHostedHandoffService(db, auth, {
      providerLabel: getHostedControlPlaneProviderLabel(env),
      schema: sqliteSchemaBundle,
      secret: hostedControlPlaneSsoSecret,
    }),
    rateLimiter: createD1RateLimiter(db, sqliteSchemaBundle),
    services: servicesForSite(siteLookup.site.id),
    servicesForSite,
    storage: createStorageDriver(env),
  };
}
