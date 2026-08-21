import { and, eq, inArray, sql } from "drizzle-orm";
import {
  executeStatement,
  type Database,
  supportsDrizzleTransaction,
} from "../db/index.js";
import type { DatabaseDialect } from "../db/dialect.js";
import {
  sqliteSchemaBundle,
  type DatabaseSchema,
} from "../db/schema-bundle.js";
import type { Bindings } from "../types/bindings.js";
import type { StorageDriver } from "../lib/storage.js";
import { SETTINGS_KEYS } from "../lib/constants.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { createEntityId } from "../lib/ids.js";
import { getConfiguredSingleSiteUrl } from "../lib/env.js";
import { resolveConfig } from "../lib/resolve-config.js";
import { buildThemeStyle } from "../lib/theme.js";
import { now } from "../lib/time.js";
import { normalizeTimeZone } from "../lib/timezones.js";
import { detectLocaleFromHeader } from "../i18n/detect.js";
import { baseLocale } from "../i18n/locales.js";
import { BUILTIN_COLOR_THEMES } from "../ui/color-themes.js";
import {
  BUILTIN_FONT_THEMES,
  getCjkFontCssVariables,
  getFontThemeCssVariables,
} from "../ui/font-themes.js";
import type { Site, SiteDomain } from "../types.js";
import { createCollectionService } from "./collection.js";
// Note: `./export.js` is loaded lazily inside `exportManagedSite` because it
// pulls in Vite-specific `?raw` asset imports (CSS/HTML/JS templates) at
// module-load time. Importing it eagerly here would force every consumer of
// `services/index.ts` — including Node-only dev scripts run under tsx — to
// resolve those Vite-only imports just to construct the services bundle.
import { createMediaService } from "./media.js";
import { createNavItemService } from "./navigation.js";
import { createPathService } from "./path.js";
import { createPostService } from "./post.js";
import { createSettingsService } from "./settings.js";

const { sites: _sqliteSites, siteDomains: _sqliteSiteDomains } =
  sqliteSchemaBundle;

export interface CreateManagedSiteInput {
  key: string;
  primaryHost: string;
  siteName: string;
  siteLanguage?: string | null;
  timeZone?: string | null;
  /**
   * Optional caller-supplied idempotency key. When provided, retrying the same
   * request returns the previously created site instead of a 409 conflict.
   * Reusing the key with a different `key` or `primaryHost` is rejected as a
   * client bug.
   */
  idempotencyKey?: string | null;
}

export interface ManagedSiteResult {
  domain: SiteDomain;
  site: Site;
}

export interface DeleteManagedSiteDeps {
  storage?: StorageDriver | null;
}

export interface ManageManagedSiteDomainInput {
  host: string;
  makePrimary?: boolean;
}

export interface RenameManagedSiteInput {
  key: string;
  primaryHost: string;
}

export interface ExportManagedSiteDeps {
  env: Bindings;
  storage?: StorageDriver | null;
}

export interface ManagedSiteExportResult {
  filename: string;
  zip: Uint8Array;
}

export interface ManagedSiteMediaUsageResult {
  mediaBytesUsed: number;
  siteId: string;
}

export interface ManagedSitePostCountResult {
  publishedPostCount: number;
  siteId: string;
}

export interface ManagedSiteKeyAvailabilityResult {
  available: boolean;
  key: string;
}

export interface SiteAdminService {
  addManagedSiteDomain(
    siteId: string,
    input: ManageManagedSiteDomainInput,
  ): Promise<SiteDomain[]>;
  createManagedSite(input: CreateManagedSiteInput): Promise<ManagedSiteResult>;
  /**
   * Lookup whether the given site key is free in `site`. Returns the
   * normalized key so the caller can confirm what was checked. Used by the
   * control plane before reserving a cloud_site row, so the user sees a
   * conflict on the form instead of after provisioning.
   */
  isManagedSiteKeyAvailable(
    key: string,
  ): Promise<ManagedSiteKeyAvailabilityResult>;
  exportManagedSite(
    siteId: string,
    deps: ExportManagedSiteDeps,
  ): Promise<ManagedSiteExportResult>;
  getManagedSiteMediaUsage(
    siteId: string,
  ): Promise<ManagedSiteMediaUsageResult>;
  /**
   * Batch published-post counts for hosted sites, keyed by site id. Used by the
   * control-plane admin site list to show how much content each blog has.
   * Unknown site ids resolve to a zero count instead of an error so a stale
   * control-plane pointer never fails the whole lookup.
   */
  getManagedSitePostCounts(
    siteIds: string[],
  ): Promise<ManagedSitePostCountResult[]>;
  suspendManagedSite(siteId: string): Promise<Site>;
  resumeManagedSite(siteId: string): Promise<Site>;
  /**
   * Atomically rename a managed site: change `sites.key` and rewrite the
   * existing primary domain's host. The primary domain row keeps its id, so
   * downstream projections that key off the domain id (e.g. the control
   * plane's `cloud_site_domain` projection) stay stable across the rename.
   *
   * Throws ConflictError if the new key or primary host collide with another
   * site (or with a non-primary domain on the same site). No-ops when the new
   * key and host both match the current values.
   */
  renameManagedSite(
    siteId: string,
    input: RenameManagedSiteInput,
  ): Promise<ManagedSiteResult>;
  deleteManagedSite(
    siteId: string,
    deps?: DeleteManagedSiteDeps,
  ): Promise<void>;
  deleteManagedSiteDomain(
    siteId: string,
    domainId: string,
  ): Promise<SiteDomain[]>;
  listManagedSiteDomains(siteId: string): Promise<SiteDomain[]>;
  setManagedSitePrimaryDomain(
    siteId: string,
    domainId: string,
  ): Promise<SiteDomain[]>;
  setManagedSiteDomainRedirect(
    siteId: string,
    domainId: string,
    redirectToPrimary: boolean,
  ): Promise<SiteDomain[]>;
}

export interface SiteAdminServiceConfig {
  siteResolutionMode?: "single-site" | "host-based";
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

function isMissingSqliteFtsTable(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ""}`
      : String(error);

  return message.includes("no such table: post_fts");
}

export function createSiteAdminService(
  db: Database,
  databaseSchema: DatabaseSchema = sqliteSchemaBundle,
  databaseDialect: DatabaseDialect = "sqlite",
  config: SiteAdminServiceConfig = {},
): SiteAdminService {
  const {
    apiTokens,
    collectionDirectoryItems,
    collections,
    media,
    navItems,
    pathRegistry,
    smartCollections,
    threadCollections,
    posts,
    settings,
    siteDomains,
    siteMembers,
    sites,
  } = databaseSchema;
  const siteResolutionMode = config.siteResolutionMode ?? "single-site";

  function assertManagedSiteOperationsEnabled(): void {
    if (siteResolutionMode !== "host-based") {
      throw new ConflictError(
        "Managed site operations are only available in host-based mode.",
      );
    }
  }

  function getManagedSiteBaseUrl(
    env: Bindings,
    domain: Pick<SiteDomain, "host" | "pathPrefix"> | null,
  ): string | undefined {
    if (!domain) {
      return undefined;
    }

    let protocol = "https:";
    const configuredSiteUrl = getConfiguredSingleSiteUrl(env);
    if (configuredSiteUrl) {
      try {
        protocol = new URL(configuredSiteUrl).protocol || protocol;
      } catch {
        // Fall back to https for hosted exports.
      }
    }

    const pathPrefix = domain.pathPrefix ?? "";
    return `${protocol}//${domain.host}${pathPrefix}`;
  }

  async function loadByIdempotencyKey(
    targetDb: Database,
    idempotencyKey: string,
  ): Promise<ManagedSiteResult | null> {
    const siteRow = (
      await targetDb
        .select()
        .from(sites)
        .where(eq(sites.provisioningIdempotencyKey, idempotencyKey))
        .limit(1)
    )[0];
    if (!siteRow) {
      return null;
    }

    const domainRow = (
      await targetDb
        .select()
        .from(siteDomains)
        .where(
          and(
            eq(siteDomains.siteId, siteRow.id),
            eq(siteDomains.kind, "primary"),
          ),
        )
        .limit(1)
    )[0];
    if (!domainRow) {
      // A site row without a primary domain means the original creation aborted
      // mid-transaction on a dialect without real transactions. Treat as not
      // found so the caller can retry; the partial unique index will surface a
      // genuine duplicate.
      return null;
    }

    return {
      site: toSite(siteRow),
      domain: toSiteDomain(domainRow),
    };
  }

  async function completeManagedSiteSetup(
    targetDb: Database,
    siteId: string,
    input: {
      siteName: string;
      siteLanguage?: string | null;
      timeZone: string;
    },
  ): Promise<void> {
    const settingsService = createSettingsService(
      targetDb,
      siteId,
      databaseSchema,
      databaseDialect,
    );
    if ((await settingsService.getOnboardingStatus()) !== "pending") {
      return;
    }

    await settingsService.set(SETTINGS_KEYS.SITE_NAME, input.siteName);
    // The control plane can only pass a guess — today it forwards the locale
    // the owner was browsing it in, which is their reading language, not
    // necessarily the one they write in. It stands in until setup asks, so the
    // site is never languageless, and setup offers it preselected.
    await settingsService.updateLocaleSettings(
      {
        siteLanguage: input.siteLanguage?.trim()
          ? detectLocaleFromHeader(input.siteLanguage)
          : baseLocale,
        timeZone: input.timeZone,
      },
      {
        oldLanguage: "",
      },
    );
    const navItems = createNavItemService(targetDb, siteId, databaseSchema);
    await navItems.materializeDefaultNavigation();
    // Not `completeOnboarding()`: the site is real and readable from here, but
    // its owner still owes setup the one answer nothing can infer.
    await settingsService.markSiteProvisioned();
  }

  async function createWithDatabase(
    targetDb: Database,
    input: CreateManagedSiteInput,
  ): Promise<ManagedSiteResult> {
    const siteKey = input.key.trim();
    const primaryHost = input.primaryHost.trim().toLowerCase();
    const siteName = input.siteName.trim();
    // Browser-detected timezone metadata is optional. Preserve any runtime-
    // supported IANA name or fixed offset, but never fail the whole managed
    // site transaction when a browser reports a value this runtime does not
    // recognize.
    const timeZone = normalizeTimeZone(input.timeZone);
    const idempotencyKey = input.idempotencyKey?.trim() || null;

    if (idempotencyKey) {
      const existing = await loadByIdempotencyKey(targetDb, idempotencyKey);
      if (existing) {
        if (
          existing.site.key !== siteKey ||
          existing.domain.host !== primaryHost
        ) {
          throw new ConflictError(
            "Idempotency key was reused with a different site key or primary host.",
          );
        }
        await completeManagedSiteSetup(targetDb, existing.site.id, {
          siteName,
          siteLanguage: input.siteLanguage,
          timeZone,
        });
        return existing;
      }
    }

    const existingSite = await targetDb
      .select({ id: sites.id })
      .from(sites)
      .where(eq(sites.key, siteKey))
      .limit(1);
    if (existingSite[0]) {
      throw new ConflictError("Site key is already in use.");
    }

    const existingDomain = await targetDb
      .select({ id: siteDomains.id })
      .from(siteDomains)
      .where(eq(siteDomains.host, primaryHost))
      .limit(1);
    if (existingDomain[0]) {
      throw new ConflictError("Primary host is already in use.");
    }

    const timestamp = now();
    const siteId = createEntityId("site");
    const domainId = createEntityId("siteDomain");

    const siteRow = (
      await targetDb
        .insert(sites)
        .values({
          id: siteId,
          key: siteKey,
          status: "active",
          provisioningIdempotencyKey: idempotencyKey,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning()
    )[0];
    if (!siteRow) {
      throw new Error("Creating the managed site did not return a site row.");
    }

    const domainRow = (
      await targetDb
        .insert(siteDomains)
        .values({
          id: domainId,
          siteId,
          host: primaryHost,
          pathPrefix: null,
          kind: "primary",
          redirectToPrimary: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning()
    )[0];
    if (!domainRow) {
      throw new Error(
        "Creating the managed site did not return a primary domain row.",
      );
    }

    await completeManagedSiteSetup(targetDb, siteId, {
      siteName,
      siteLanguage: input.siteLanguage,
      timeZone,
    });

    return {
      site: toSite(siteRow),
      domain: toSiteDomain(domainRow),
    };
  }

  async function collectStorageKeysForSite(siteId: string): Promise<string[]> {
    const mediaRows = await db
      .select({
        posterKey: media.posterKey,
        storageKey: media.storageKey,
      })
      .from(media)
      .where(eq(media.siteId, siteId));

    const settingRows = await db
      .select({
        key: settings.key,
        value: settings.value,
      })
      .from(settings)
      .where(eq(settings.siteId, siteId));

    const keys = new Set<string>();
    for (const row of mediaRows) {
      keys.add(row.storageKey);
      if (row.posterKey) {
        keys.add(row.posterKey);
      }
    }

    for (const row of settingRows) {
      if (
        row.key === SETTINGS_KEYS.SITE_AVATAR ||
        row.key === SETTINGS_KEYS.SITE_FAVICON_APPLE_TOUCH
      ) {
        if (row.value.trim()) {
          keys.add(row.value);
        }
      }
    }

    return [...keys];
  }

  async function deleteSiteRows(
    targetDb: Database,
    siteId: string,
  ): Promise<void> {
    const existingSite = await targetDb
      .select({ id: sites.id })
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1);
    if (!existingSite[0]) {
      throw new NotFoundError("Site");
    }

    await targetDb
      .delete(threadCollections)
      .where(eq(threadCollections.siteId, siteId));
    await targetDb.delete(pathRegistry).where(eq(pathRegistry.siteId, siteId));
    await targetDb
      .delete(collectionDirectoryItems)
      .where(eq(collectionDirectoryItems.siteId, siteId));
    await targetDb.delete(media).where(eq(media.siteId, siteId));
    await targetDb.delete(navItems).where(eq(navItems.siteId, siteId));

    await executeStatement(
      targetDb,
      sql`UPDATE post SET reply_to_id = NULL, thread_id = id WHERE site_id = ${siteId} AND reply_to_id IS NOT NULL`,
    );
    await targetDb.delete(posts).where(eq(posts.siteId, siteId));

    // Both kinds of collection, and smart ones first — a smart collection holds
    // a `collection_id`. There is no constraint forcing that order any more
    // (see the note on the column in `db/schema.ts`), but this function names
    // every table it clears, and leaving one to an implicit cascade from `site`
    // is how the next table gets forgotten.
    await targetDb
      .delete(smartCollections)
      .where(eq(smartCollections.siteId, siteId));
    await targetDb.delete(collections).where(eq(collections.siteId, siteId));
    await targetDb.delete(apiTokens).where(eq(apiTokens.siteId, siteId));
    await targetDb.delete(settings).where(eq(settings.siteId, siteId));
    await targetDb.delete(siteMembers).where(eq(siteMembers.siteId, siteId));
    await targetDb.delete(siteDomains).where(eq(siteDomains.siteId, siteId));
    await targetDb.delete(sites).where(eq(sites.id, siteId));

    if (databaseDialect === "sqlite") {
      try {
        await executeStatement(
          targetDb,
          sql`INSERT INTO post_fts(post_fts) VALUES ('rebuild')`,
        );
      } catch (error) {
        if (!isMissingSqliteFtsTable(error)) {
          throw error;
        }
      }
    }
  }

  async function requireSite(
    targetDb: Database,
    siteId: string,
  ): Promise<void> {
    const existingSite = await targetDb
      .select({ id: sites.id })
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1);
    if (!existingSite[0]) {
      throw new NotFoundError("Site");
    }
  }

  async function requireSiteRow(
    targetDb: Database,
    siteId: string,
  ): Promise<typeof sites.$inferSelect> {
    const existingSite = await targetDb
      .select()
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1);
    if (!existingSite[0]) {
      throw new NotFoundError("Site");
    }

    return existingSite[0];
  }

  async function setManagedSiteStatus(
    targetDb: Database,
    siteId: string,
    status: Site["status"],
  ): Promise<Site> {
    const siteRow = await requireSiteRow(targetDb, siteId);
    if (siteRow.status === status) {
      return toSite(siteRow);
    }

    const timestamp = now();
    const updatedSite = (
      await targetDb
        .update(sites)
        .set({
          status,
          updatedAt: timestamp,
        })
        .where(eq(sites.id, siteId))
        .returning()
    )[0];
    if (!updatedSite) {
      throw new NotFoundError("Site");
    }

    return toSite(updatedSite);
  }

  async function listSiteDomainRows(
    targetDb: Database,
    siteId: string,
  ): Promise<(typeof siteDomains.$inferSelect)[]> {
    return targetDb
      .select()
      .from(siteDomains)
      .where(eq(siteDomains.siteId, siteId))
      .orderBy(
        sql`CASE WHEN ${siteDomains.kind} = 'primary' THEN 0 ELSE 1 END`,
        siteDomains.createdAt,
      );
  }

  async function listManagedSiteDomains(siteId: string): Promise<SiteDomain[]> {
    const normalizedSiteId = siteId.trim();
    if (!normalizedSiteId) {
      throw new NotFoundError("Site");
    }

    await requireSite(db, normalizedSiteId);
    const rows = await listSiteDomainRows(db, normalizedSiteId);
    return rows.map(toSiteDomain);
  }

  async function getManagedSiteMediaUsage(
    siteId: string,
  ): Promise<ManagedSiteMediaUsageResult> {
    const normalizedSiteId = siteId.trim();
    if (!normalizedSiteId) {
      throw new NotFoundError("Site");
    }

    await requireSite(db, normalizedSiteId);
    const rows = await db
      .select({
        mediaBytesUsed: sql<number>`coalesce(sum(${media.size}), 0)`,
      })
      .from(media)
      .where(eq(media.siteId, normalizedSiteId));

    return {
      mediaBytesUsed: Number(rows[0]?.mediaBytesUsed ?? 0),
      siteId: normalizedSiteId,
    };
  }

  async function getManagedSitePostCounts(
    siteIds: string[],
  ): Promise<ManagedSitePostCountResult[]> {
    const normalizedSiteIds = [
      ...new Set(siteIds.map((siteId) => siteId.trim()).filter(Boolean)),
    ];
    if (normalizedSiteIds.length === 0) {
      return [];
    }

    const rows = await db
      .select({
        publishedPostCount: sql<number>`cast(count(*) as integer)`,
        siteId: posts.siteId,
      })
      .from(posts)
      .where(
        and(
          inArray(posts.siteId, normalizedSiteIds),
          eq(posts.status, "published"),
        ),
      )
      .groupBy(posts.siteId);

    const countBySiteId = new Map(
      rows.map((row) => [row.siteId, Number(row.publishedPostCount ?? 0)]),
    );

    return normalizedSiteIds.map((siteId) => ({
      publishedPostCount: countBySiteId.get(siteId) ?? 0,
      siteId,
    }));
  }

  async function mutateSiteDomains(
    siteId: string,
    mutate: (targetDb: Database, normalizedSiteId: string) => Promise<void>,
  ): Promise<SiteDomain[]> {
    const normalizedSiteId = siteId.trim();
    if (!normalizedSiteId) {
      throw new NotFoundError("Site");
    }

    if (supportsDrizzleTransaction(db, databaseDialect)) {
      await db.transaction(async (tx) => {
        await mutate(tx as unknown as Database, normalizedSiteId);
      });
    } else {
      await mutate(db, normalizedSiteId);
    }

    return listManagedSiteDomains(normalizedSiteId);
  }

  return {
    async listManagedSiteDomains(siteId) {
      assertManagedSiteOperationsEnabled();
      return listManagedSiteDomains(siteId);
    },
    async createManagedSite(input) {
      assertManagedSiteOperationsEnabled();
      if (supportsDrizzleTransaction(db, databaseDialect)) {
        return db.transaction(async (tx) =>
          createWithDatabase(tx as unknown as Database, input),
        );
      }

      return createWithDatabase(db, input);
    },
    async isManagedSiteKeyAvailable(key) {
      assertManagedSiteOperationsEnabled();
      const normalizedKey = key.trim();
      const existing = await db
        .select({ id: sites.id })
        .from(sites)
        .where(eq(sites.key, normalizedKey))
        .limit(1);
      return { available: !existing[0], key: normalizedKey };
    },
    async getManagedSiteMediaUsage(siteId) {
      assertManagedSiteOperationsEnabled();
      return getManagedSiteMediaUsage(siteId);
    },
    async getManagedSitePostCounts(siteIds) {
      assertManagedSiteOperationsEnabled();
      return getManagedSitePostCounts(siteIds);
    },
    async exportManagedSite(siteId, deps) {
      assertManagedSiteOperationsEnabled();
      const normalizedSiteId = siteId.trim();
      if (!normalizedSiteId) {
        throw new NotFoundError("Site");
      }

      const siteRow = await requireSiteRow(db, normalizedSiteId);
      const domains = await listManagedSiteDomains(normalizedSiteId);
      const primaryDomain =
        domains.find((domain) => domain.kind === "primary") ?? null;

      const settings = createSettingsService(
        db,
        normalizedSiteId,
        databaseSchema,
        databaseDialect,
      );
      const paths = createPathService(db, normalizedSiteId, databaseSchema);
      const navItems = createNavItemService(
        db,
        normalizedSiteId,
        databaseSchema,
      );
      const posts = createPostService(
        db,
        {
          databaseDialect,
          slugIdLength: 5,
        },
        normalizedSiteId,
        paths,
        databaseSchema,
      );
      const collections = createCollectionService(
        db,
        normalizedSiteId,
        paths,
        databaseSchema,
        databaseDialect,
      );
      const mediaService = createMediaService(
        db,
        normalizedSiteId,
        databaseSchema,
        databaseDialect,
      );

      const allSettings = await settings.getAll();
      const appConfig = resolveConfig(deps.env, allSettings, {
        siteUrl: getManagedSiteBaseUrl(deps.env, primaryDomain) ?? undefined,
      });
      const activeTheme = BUILTIN_COLOR_THEMES.find(
        (theme) => theme.id === appConfig.themeId,
      );
      const fontTheme = appConfig.fontThemeId
        ? BUILTIN_FONT_THEMES.find(
            (theme) => theme.id === appConfig.fontThemeId,
          )
        : undefined;
      // The static export is one site-wide stylesheet, so it uses the site
      // language for the CJK stack. Per-page language overrides are a runtime
      // concern that a flat Hugo export has no equivalent for.
      const fontOverrides = {
        ...getCjkFontCssVariables(appConfig.siteLanguage),
        ...(fontTheme ? getFontThemeCssVariables(fontTheme) : {}),
      };
      const themeCss = buildThemeStyle(
        activeTheme,
        appConfig.themeMode,
        fontOverrides,
      );
      const navItemList = await navItems.list();
      const appleTouchKey = allSettings[SETTINGS_KEYS.SITE_FAVICON_APPLE_TOUCH];
      const { createExportService } = await import("./export.js");
      const exportService = createExportService(
        {
          collections,
          media: mediaService,
          paths,
          posts,
        },
        {
          siteName: appConfig.siteName,
          siteUrl: appConfig.siteUrl,
          siteDescription: appConfig.siteDescription,
          siteLanguage: appConfig.siteLanguage,
          multilingualEnabled: appConfig.multilingualEnabled,
          additionalLanguages: appConfig.additionalLanguages,
          showJantBrandingOnHome: appConfig.showJantBrandingOnHome,
          publicApiEnabled: appConfig.publicApiEnabled,
          rssFeedsEnabled: appConfig.rssFeedsEnabled,
          mainRssFeed: appConfig.mainRssFeed,
          archiveDefaultLayout: appConfig.archiveDefaultLayout,
          siteFooter: appConfig.siteFooter,
          showHeaderAvatar: appConfig.showHeaderAvatar,
          siteAvatarUrl: appConfig.siteAvatarUrl,
          faviconIcoBase64: allSettings[SETTINGS_KEYS.SITE_FAVICON_ICO],
          appleTouchIconStorageKey: appleTouchKey || undefined,
          faviconVersion: appConfig.faviconVersion,
          themeId: appConfig.themeId,
          defaultThemeId: appConfig.defaultThemeId,
          fontThemeId: appConfig.fontThemeId,
          themeMode: appConfig.themeMode,
          noindex: appConfig.noindex,
          themeCss,
          customCss: appConfig.customCSS,
          r2PublicUrl: appConfig.r2PublicUrl,
          s3PublicUrl: appConfig.s3PublicUrl,
          localPublicUrl: appConfig.localPublicUrl,
          imageTransformUrl: appConfig.imageTransformUrl,
          sitePathPrefix: appConfig.sitePathPrefix,
          navItems: navItemList,
          pageSize: appConfig.pageSize,
          archivePageSize: appConfig.archivePageSize,
          rssFeedLimit: appConfig.rssFeedLimit,
        },
        {
          storage: deps.storage ?? null,
        },
      );

      return {
        filename: `${siteRow.key}-site-export.zip`,
        zip: await exportService.generateHugoSite(),
      };
    },
    async suspendManagedSite(siteId) {
      assertManagedSiteOperationsEnabled();
      const normalizedSiteId = siteId.trim();
      if (!normalizedSiteId) {
        throw new NotFoundError("Site");
      }

      if (!supportsDrizzleTransaction(db, databaseDialect)) {
        return setManagedSiteStatus(db, normalizedSiteId, "suspended");
      }

      return db.transaction(async (tx) =>
        setManagedSiteStatus(
          tx as unknown as Database,
          normalizedSiteId,
          "suspended",
        ),
      );
    },
    async resumeManagedSite(siteId) {
      assertManagedSiteOperationsEnabled();
      const normalizedSiteId = siteId.trim();
      if (!normalizedSiteId) {
        throw new NotFoundError("Site");
      }

      if (!supportsDrizzleTransaction(db, databaseDialect)) {
        return setManagedSiteStatus(db, normalizedSiteId, "active");
      }

      return db.transaction(async (tx) =>
        setManagedSiteStatus(
          tx as unknown as Database,
          normalizedSiteId,
          "active",
        ),
      );
    },
    async deleteManagedSite(siteId, deps) {
      assertManagedSiteOperationsEnabled();
      const normalizedSiteId = siteId.trim();
      if (!normalizedSiteId) {
        throw new NotFoundError("Site");
      }

      if (deps?.storage) {
        const keysToDelete = await collectStorageKeysForSite(normalizedSiteId);
        if (keysToDelete.length > 0) {
          const storageDriver = deps.storage;
          await Promise.allSettled(
            keysToDelete.map((key) => storageDriver.delete(key)),
          );
        }
      }

      if (!supportsDrizzleTransaction(db, databaseDialect)) {
        await deleteSiteRows(db, normalizedSiteId);
        return;
      }

      await db.transaction(async (tx) => {
        await deleteSiteRows(tx as unknown as Database, normalizedSiteId);
      });
    },
    async addManagedSiteDomain(siteId, input) {
      assertManagedSiteOperationsEnabled();
      return mutateSiteDomains(siteId, async (targetDb, normalizedSiteId) => {
        await requireSite(targetDb, normalizedSiteId);

        const host = input.host.trim().toLowerCase();
        if (!host) {
          throw new ConflictError("Domain host is required.");
        }

        const existingHost = await targetDb
          .select({ id: siteDomains.id, siteId: siteDomains.siteId })
          .from(siteDomains)
          .where(eq(siteDomains.host, host))
          .limit(1);
        if (existingHost[0]) {
          if (existingHost[0].siteId === normalizedSiteId) {
            throw new ConflictError(
              "Domain is already connected to this site.",
            );
          }

          throw new ConflictError("Domain is already in use.");
        }

        const timestamp = now();
        if (input.makePrimary) {
          // Newly-added primaries (e.g. custom domains) are unverified at this
          // point. Leave any demoted alias serving directly so the site stays
          // reachable while the new primary's DNS propagates. The caller is
          // expected to flip redirectToPrimary back on once the new primary is
          // confirmed to work.
          await targetDb
            .update(siteDomains)
            .set({
              kind: "alias",
              redirectToPrimary: false,
              updatedAt: timestamp,
            })
            .where(eq(siteDomains.siteId, normalizedSiteId));
        }

        await targetDb.insert(siteDomains).values({
          id: createEntityId("siteDomain"),
          siteId: normalizedSiteId,
          host,
          pathPrefix: null,
          kind: input.makePrimary ? "primary" : "alias",
          redirectToPrimary: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      });
    },
    async setManagedSiteDomainRedirect(siteId, domainId, redirectToPrimary) {
      assertManagedSiteOperationsEnabled();
      return mutateSiteDomains(siteId, async (targetDb, normalizedSiteId) => {
        await requireSite(targetDb, normalizedSiteId);

        const normalizedDomainId = domainId.trim();
        const current = await targetDb
          .select({ id: siteDomains.id })
          .from(siteDomains)
          .where(
            sql`${siteDomains.id} = ${normalizedDomainId} AND ${siteDomains.siteId} = ${normalizedSiteId}`,
          )
          .limit(1);
        if (!current[0]) {
          throw new NotFoundError("Site domain");
        }

        const timestamp = now();
        await targetDb
          .update(siteDomains)
          .set({
            redirectToPrimary,
            updatedAt: timestamp,
          })
          .where(eq(siteDomains.id, normalizedDomainId));
      });
    },
    async setManagedSitePrimaryDomain(siteId, domainId) {
      assertManagedSiteOperationsEnabled();
      return mutateSiteDomains(siteId, async (targetDb, normalizedSiteId) => {
        await requireSite(targetDb, normalizedSiteId);

        const normalizedDomainId = domainId.trim();
        const current = await targetDb
          .select()
          .from(siteDomains)
          .where(
            sql`${siteDomains.id} = ${normalizedDomainId} AND ${siteDomains.siteId} = ${normalizedSiteId}`,
          )
          .limit(1);
        const domainRow = current[0];
        if (!domainRow) {
          throw new NotFoundError("Site domain");
        }

        if (domainRow.kind === "primary") {
          return;
        }

        const timestamp = now();
        await targetDb
          .update(siteDomains)
          .set({
            kind: "alias",
            redirectToPrimary: true,
            updatedAt: timestamp,
          })
          .where(eq(siteDomains.siteId, normalizedSiteId));
        await targetDb
          .update(siteDomains)
          .set({
            kind: "primary",
            redirectToPrimary: true,
            updatedAt: timestamp,
          })
          .where(eq(siteDomains.id, normalizedDomainId));
      });
    },
    async deleteManagedSiteDomain(siteId, domainId) {
      assertManagedSiteOperationsEnabled();
      return mutateSiteDomains(siteId, async (targetDb, normalizedSiteId) => {
        await requireSite(targetDb, normalizedSiteId);

        const normalizedDomainId = domainId.trim();
        const current = await targetDb
          .select()
          .from(siteDomains)
          .where(
            sql`${siteDomains.id} = ${normalizedDomainId} AND ${siteDomains.siteId} = ${normalizedSiteId}`,
          )
          .limit(1);
        const domainRow = current[0];
        if (!domainRow) {
          throw new NotFoundError("Site domain");
        }

        if (domainRow.kind === "primary") {
          throw new ConflictError(
            "Set another primary domain before removing this one.",
          );
        }

        await targetDb
          .delete(siteDomains)
          .where(eq(siteDomains.id, normalizedDomainId));
      });
    },
    async renameManagedSite(siteId, input) {
      assertManagedSiteOperationsEnabled();
      const normalizedSiteId = siteId.trim();
      if (!normalizedSiteId) {
        throw new NotFoundError("Site");
      }

      const newKey = input.key.trim();
      const newPrimaryHost = input.primaryHost.trim().toLowerCase();
      if (!newKey) {
        throw new ConflictError("Site key is required.");
      }
      if (!newPrimaryHost) {
        throw new ConflictError("Primary host is required.");
      }

      async function performRename(
        targetDb: Database,
      ): Promise<ManagedSiteResult> {
        const siteRow = await requireSiteRow(targetDb, normalizedSiteId);

        const primaryRows = await targetDb
          .select()
          .from(siteDomains)
          .where(
            and(
              eq(siteDomains.siteId, normalizedSiteId),
              eq(siteDomains.kind, "primary"),
            ),
          )
          .limit(1);
        const primaryRow = primaryRows[0];
        if (!primaryRow) {
          throw new NotFoundError("Site primary domain");
        }

        if (siteRow.key === newKey && primaryRow.host === newPrimaryHost) {
          return {
            domain: toSiteDomain(primaryRow),
            site: toSite(siteRow),
          };
        }

        if (siteRow.key !== newKey) {
          const conflictingSite = await targetDb
            .select({ id: sites.id })
            .from(sites)
            .where(eq(sites.key, newKey))
            .limit(1);
          if (conflictingSite[0]) {
            throw new ConflictError("Site key is already in use.");
          }
        }

        if (primaryRow.host !== newPrimaryHost) {
          const conflictingDomain = await targetDb
            .select({ id: siteDomains.id, siteId: siteDomains.siteId })
            .from(siteDomains)
            .where(eq(siteDomains.host, newPrimaryHost))
            .limit(1);
          if (conflictingDomain[0]) {
            throw new ConflictError("Primary host is already in use.");
          }
        }

        const timestamp = now();
        const updatedSiteRow = (
          await targetDb
            .update(sites)
            .set({ key: newKey, updatedAt: timestamp })
            .where(eq(sites.id, normalizedSiteId))
            .returning()
        )[0];
        if (!updatedSiteRow) {
          throw new NotFoundError("Site");
        }

        const updatedDomainRow = (
          await targetDb
            .update(siteDomains)
            .set({ host: newPrimaryHost, updatedAt: timestamp })
            .where(eq(siteDomains.id, primaryRow.id))
            .returning()
        )[0];
        if (!updatedDomainRow) {
          throw new NotFoundError("Site primary domain");
        }

        return {
          domain: toSiteDomain(updatedDomainRow),
          site: toSite(updatedSiteRow),
        };
      }

      if (supportsDrizzleTransaction(db, databaseDialect)) {
        return db.transaction(async (tx) =>
          performRename(tx as unknown as Database),
        );
      }

      return performRename(db);
    },
  };
}
