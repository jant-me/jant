import type BetterSqlite3 from "better-sqlite3";
import { createNodeDatabase, type Database } from "../db/index.js";
import type { RawQueryClient, RawQueryStatement } from "../db/raw-query.js";
import { sqliteSchemaBundle } from "../db/schema-bundle.js";
import { createAuth, type Auth } from "../auth.js";
import {
  getAuthSecret,
  getEnvString,
  getHostedControlPlaneProviderLabel,
  getHostedControlPlaneSsoSecret,
  getSiteResolutionMode,
  shouldUseSecureCookies,
} from "../lib/env.js";
import { createHostedControlPlaneClient } from "../lib/hosted-control-plane.js";
import { createMemoryRateLimiter } from "../lib/rate-limit-memory.js";
import type { RateLimiter } from "../lib/rate-limit.js";
import { createStorageDriver, type StorageDriver } from "../lib/storage.js";
import {
  createHostedHandoffService,
  type HostedHandoffService,
} from "../services/hosted-handoff.js";
import { createServices, type Services } from "../services/index.js";
import type { Site, SiteDomain } from "../types/entities.js";
import type { Bindings } from "../types/bindings.js";
import {
  getSingleSiteBootstrapOptions,
  getResolvedSiteBaseUrl,
  resolveCliSite,
  resolveRequestSite,
} from "./site.js";

export interface NodeRequestRuntime {
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
 * Single process-wide rate limiter for the Node runtime. Node serves all
 * requests out of one persistent process, so in-memory counters are
 * reliable and avoid per-request D1 round-trips. Constructed lazily on
 * first use so tests that never build a request runtime don't pay for it.
 */
let sharedNodeRateLimiter: RateLimiter | null = null;
function getNodeRateLimiter(): RateLimiter {
  sharedNodeRateLimiter ??= createMemoryRateLimiter();
  return sharedNodeRateLimiter;
}

export interface NodeCliRuntime {
  currentSite: Site;
  currentSiteDomain: SiteDomain | null;
  db: Database;
  services: Services;
  storage: StorageDriver | null;
}

function createBetterSqliteRawQuery(
  sqlite: BetterSqlite3.Database,
): RawQueryClient {
  return {
    prepare(query: string): RawQueryStatement {
      let params: unknown[] = [];

      return {
        bind(...nextParams: unknown[]) {
          params = nextParams;
          return this;
        },
        async all<T>() {
          const stmt = sqlite.prepare(query);
          return {
            results: stmt.all(...params) as T[],
          };
        },
      };
    },
  };
}

/**
 * Builds the per-request runtime objects for the Node path.
 *
 * The SQLite connection itself is created at process startup and attached to
 * the bindings as `NODE_SQLITE`.
 */
export async function createNodeRequestRuntime(
  env: Bindings,
  publicRequestUrl: string,
): Promise<NodeRequestRuntime> {
  const nodeDatabase = env.NODE_DATABASE;
  const sqlite = env.NODE_SQLITE;
  const db = nodeDatabase?.db ?? (sqlite ? createNodeDatabase(sqlite) : null);
  const rawQuery =
    nodeDatabase?.rawQuery ??
    (sqlite ? createBetterSqliteRawQuery(sqlite) : null);
  const databaseDialect = nodeDatabase?.dialect ?? "sqlite";
  const databaseSchema = nodeDatabase?.schema ?? sqliteSchemaBundle;

  if (!db || !rawQuery) {
    throw new Error("Node runtime requires a resolved database binding.");
  }

  const authSecret = getAuthSecret(env);
  const hostedControlPlaneSsoSecret = getHostedControlPlaneSsoSecret(env);
  if (!authSecret) {
    throw new Error("AUTH_SECRET should be set after startup validation.");
  }

  const slugIdLength =
    parseInt(getEnvString(env, "SLUG_ID_LENGTH") ?? "5", 10) || 5;
  const siteLookup = await resolveRequestSite(
    db,
    env,
    publicRequestUrl,
    databaseSchema,
  );
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
    databaseDialect,
    schema: databaseSchema,
    useSecureCookies: shouldUseSecureCookies(env, publicRequestUrl),
  });

  const servicesConfig = {
    databaseDialect,
    authSecret,
    bootstrapSite: getSingleSiteBootstrapOptions(env),
    enforceHostedMediaQuota: getSiteResolutionMode(env) === "host-based",
    hostedControlPlane: createHostedControlPlaneClient(env),
    siteResolutionMode: getSiteResolutionMode(env),
    slugIdLength,
    schema: databaseSchema,
  };
  const servicesForSite = (siteId: string): Services =>
    createServices(db, rawQuery, siteId, servicesConfig);

  return {
    auth,
    currentSite: siteLookup.site,
    currentSiteDomain: siteLookup.domain,
    db,
    hostedHandoff: createHostedHandoffService(db, auth, {
      providerLabel: getHostedControlPlaneProviderLabel(env),
      schema: databaseSchema,
      secret: hostedControlPlaneSsoSecret,
    }),
    rateLimiter: getNodeRateLimiter(),
    services: servicesForSite(siteLookup.site.id),
    servicesForSite,
    storage: createStorageDriver(env),
  };
}

/**
 * Builds the runtime objects needed by local CLI commands.
 *
 * Unlike the request runtime, this path does not require auth configuration.
 */
export async function createNodeCliRuntime(
  env: Bindings,
): Promise<NodeCliRuntime> {
  const nodeDatabase = env.NODE_DATABASE;
  const sqlite = env.NODE_SQLITE;
  const db = nodeDatabase?.db ?? (sqlite ? createNodeDatabase(sqlite) : null);
  const rawQuery =
    nodeDatabase?.rawQuery ??
    (sqlite ? createBetterSqliteRawQuery(sqlite) : null);
  const databaseDialect = nodeDatabase?.dialect ?? "sqlite";
  const databaseSchema = nodeDatabase?.schema ?? sqliteSchemaBundle;

  if (!db || !rawQuery) {
    throw new Error("Node CLI runtime requires a resolved database binding.");
  }

  const slugIdLength =
    parseInt(getEnvString(env, "SLUG_ID_LENGTH") ?? "5", 10) || 5;
  const siteLookup = await resolveCliSite(db, env, databaseSchema);

  return {
    currentSite: siteLookup.site,
    currentSiteDomain: siteLookup.domain,
    db,
    services: createServices(db, rawQuery, siteLookup.site.id, {
      databaseDialect,
      bootstrapSite: getSingleSiteBootstrapOptions(env),
      enforceHostedMediaQuota: getSiteResolutionMode(env) === "host-based",
      hostedControlPlane: createHostedControlPlaneClient(env),
      siteResolutionMode: getSiteResolutionMode(env),
      slugIdLength,
      schema: databaseSchema,
    }),
    storage: createStorageDriver(env),
  };
}
