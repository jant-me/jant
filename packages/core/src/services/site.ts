import { and, asc, eq, isNull, or } from "drizzle-orm";
import type { Database } from "../db/index.js";
import {
  sqliteSchemaBundle,
  type DatabaseSchema,
} from "../db/schema-bundle.js";
import { ConfigurationError } from "../lib/errors.js";
import { createEntityId } from "../lib/ids.js";
import { now } from "../lib/time.js";
import type { Site, SiteDomain } from "../types.js";

const { sites: _sqliteSites, siteDomains: _sqliteSiteDomains } =
  sqliteSchemaBundle;

export interface SiteLookupResult {
  site: Site;
  domain: SiteDomain | null;
}

export interface EnsureSingleSiteOptions {
  host?: string | null;
  key?: string;
  pathPrefix?: string | null;
}

export interface ResolveSingleSiteOptions extends EnsureSingleSiteOptions {
  createIfMissing?: boolean;
}

/**
 * Site lookups.
 *
 * `getOnlySite`, `resolveSingleSite` and `ensureSingleSite` belong to
 * single-site mode. They answer "which site is this instance?", which has no
 * answer on a hosted database, and once a second site exists they throw a
 * `ConfigurationError` telling the operator to restore
 * `SITE_RESOLUTION_MODE=host-based`. A host-based caller names its site
 * instead — by host (`resolveByHost`), or by id or key (`getByIdOrKey`) — and
 * never reaches those three.
 */
export interface SiteService {
  list(): Promise<Site[]>;
  getById(id: string): Promise<Site | null>;
  /**
   * Find the site an operator named by id or by key.
   *
   * Both columns are unique, and a managed key cannot contain the `_` every id
   * carries, so at most one site answers in practice. If a hand-edited key
   * ever equals another site's id, the id match wins.
   *
   * @param idOrKey - A site id (`sit_…`) or key
   * @returns The site, or null when neither column matches
   * @example
   * ```ts
   * await siteService.getByIdOrKey("demo");
   * ```
   */
  getByIdOrKey(idOrKey: string): Promise<Site | null>;
  getPrimaryDomainForSite(siteId: string): Promise<SiteDomain | null>;
  /**
   * The instance's one site. Single-site mode only.
   *
   * @returns The site, or null before setup has created it
   * @throws {ConfigurationError} When the database holds more than one site,
   *   which in single-site mode means it belongs to a host-based install
   * @example
   * ```ts
   * await siteService.getOnlySite();
   * ```
   */
  getOnlySite(): Promise<Site | null>;
  /**
   * The instance's one site and its domain, or the transient placeholder
   * before setup has created it. Single-site mode only.
   *
   * @param options - Where a new site's row and domain come from, and whether
   *   to create them when missing
   * @returns The site and its domain
   * @throws {ConfigurationError} When the database holds more than one site
   * @example
   * ```ts
   * await siteService.resolveSingleSite({ createIfMissing: false });
   * ```
   */
  resolveSingleSite(
    options?: ResolveSingleSiteOptions,
  ): Promise<SiteLookupResult>;
  /**
   * `resolveSingleSite` that creates the site when it is missing. Single-site
   * mode only.
   *
   * @param options - Where the new site's row and domain come from
   * @returns The site and its domain
   * @throws {ConfigurationError} When the database holds more than one site
   * @example
   * ```ts
   * await siteService.ensureSingleSite({ host: "example.com" });
   * ```
   */
  ensureSingleSite(
    options?: EnsureSingleSiteOptions,
  ): Promise<SiteLookupResult>;
  resolveByHost(
    host: string,
    pathPrefix?: string | null,
  ): Promise<SiteLookupResult | null>;
}

function toSite(row: typeof _sqliteSites.$inferSelect): Site {
  return {
    id: row.id,
    key: row.key,
    status: row.status as Site["status"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSiteDomain(row: typeof _sqliteSiteDomains.$inferSelect): SiteDomain {
  return {
    id: row.id,
    siteId: row.siteId,
    host: row.host,
    pathPrefix: row.pathPrefix,
    kind: row.kind as SiteDomain["kind"],
    redirectToPrimary: row.redirectToPrimary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const TRANSIENT_SINGLE_SITE_ID = "sit_pending";

export function createTransientSite(key = "default"): Site {
  return {
    id: TRANSIENT_SINGLE_SITE_ID,
    key,
    status: "active",
    createdAt: 0,
    updatedAt: 0,
  };
}

function createSingleSiteModeConfigurationError(
  rows: readonly Pick<typeof _sqliteSites.$inferSelect, "id" | "key">[],
): ConfigurationError {
  const siteSummary = rows.map((row) => `${row.key} (${row.id})`).join(", ");

  return new ConfigurationError(
    `single-site mode found multiple sites in the database: ${siteSummary}. Restore SITE_RESOLUTION_MODE=host-based for this database, or remove the extra sites before restarting in single-site mode.`,
  );
}

export function createSiteService(
  db: Database,
  databaseSchema: DatabaseSchema = sqliteSchemaBundle,
): SiteService {
  const { siteDomains, sites } = databaseSchema;

  /**
   * Its error assumes single-site mode, which is the only mode that may reach
   * it — see `SiteService`.
   */
  async function loadSingleSiteRow() {
    const rows = await db
      .select()
      .from(sites)
      .orderBy(asc(sites.createdAt))
      .limit(3);

    if (rows.length > 1) {
      throw createSingleSiteModeConfigurationError(rows);
    }

    return rows[0];
  }

  return {
    async list() {
      const rows = await db.select().from(sites).orderBy(asc(sites.createdAt));
      return rows.map(toSite);
    },

    async getById(id) {
      const rows = await db
        .select()
        .from(sites)
        .where(eq(sites.id, id))
        .limit(1);
      return rows[0] ? toSite(rows[0]) : null;
    },

    async getByIdOrKey(idOrKey) {
      const rows = await db
        .select()
        .from(sites)
        .where(or(eq(sites.id, idOrKey), eq(sites.key, idOrKey)))
        .limit(2);
      const row = rows.find((candidate) => candidate.id === idOrKey) ?? rows[0];
      return row ? toSite(row) : null;
    },

    async getPrimaryDomainForSite(siteId) {
      const rows = await db
        .select()
        .from(siteDomains)
        .where(
          and(eq(siteDomains.siteId, siteId), eq(siteDomains.kind, "primary")),
        )
        .orderBy(asc(siteDomains.createdAt))
        .limit(1);

      return rows[0] ? toSiteDomain(rows[0]) : null;
    },

    async getOnlySite() {
      const row = await loadSingleSiteRow();
      if (!row) {
        return null;
      }
      return toSite(row);
    },

    async resolveSingleSite(options = {}) {
      const shouldCreateIfMissing = options.createIfMissing ?? false;
      const existingRow = await loadSingleSiteRow();
      const timestamp = now();
      const created = existingRow
        ? existingRow
        : shouldCreateIfMissing
          ? (
              await db
                .insert(sites)
                .values({
                  id: createEntityId("site"),
                  key: options.key?.trim() || "default",
                  status: "active",
                  createdAt: timestamp,
                  updatedAt: timestamp,
                })
                .returning()
            )[0]
          : null;

      if (!created) {
        return {
          site: createTransientSite(options.key?.trim() || "default"),
          domain: null,
        };
      }

      let domainRow: typeof siteDomains.$inferSelect | undefined;

      if (options.host) {
        const domainRows = await db
          .select()
          .from(siteDomains)
          .where(eq(siteDomains.siteId, created.id))
          .orderBy(asc(siteDomains.createdAt))
          .limit(1);

        domainRow = domainRows[0];

        if (!domainRow && shouldCreateIfMissing) {
          domainRow = (
            await db
              .insert(siteDomains)
              .values({
                id: createEntityId("siteDomain"),
                siteId: created.id,
                host: options.host,
                pathPrefix: options.pathPrefix?.trim() || null,
                kind: "primary",
                redirectToPrimary: true,
                createdAt: timestamp,
                updatedAt: timestamp,
              })
              .returning()
          )[0];
        }
      }

      return {
        site: toSite(created),
        domain: domainRow ? toSiteDomain(domainRow) : null,
      };
    },

    async ensureSingleSite(options = {}) {
      return this.resolveSingleSite({
        ...options,
        createIfMissing: true,
      });
    },

    async resolveByHost(host, pathPrefix) {
      const normalizedPathPrefix = pathPrefix?.trim() || null;
      const rows = await db
        .select({
          site: sites,
          domain: siteDomains,
        })
        .from(siteDomains)
        .innerJoin(sites, eq(siteDomains.siteId, sites.id))
        .where(
          and(
            eq(siteDomains.host, host),
            normalizedPathPrefix === null
              ? isNull(siteDomains.pathPrefix)
              : eq(siteDomains.pathPrefix, normalizedPathPrefix),
          ),
        )
        .limit(1);

      const row = rows[0];
      if (!row) {
        return null;
      }

      return {
        site: toSite(row.site),
        domain: toSiteDomain(row.domain),
      };
    },
  };
}
