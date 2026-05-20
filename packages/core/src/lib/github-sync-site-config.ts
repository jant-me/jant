/**
 * Build the SiteConfig the GitHub Sync service needs from a request
 * context. Kept in its own file so routes, API handlers, and the
 * inline sync runner can share one source of truth — historically each
 * call site had its own near-identical copy.
 *
 * The shape mirrors `routes/api/export.ts` so `jant site export` and
 * `jant github sync` produce matching Hugo sites. They differ only in
 * media: `site export` bundles attachment bytes into `static/media/` for
 * a self-contained archive, while Sync links attachments by URL and
 * never writes their bytes into the repo. If you add a field to the
 * export route, add it here too.
 */

import type { SiteConfig } from "../services/export.js";
import type { AppVariables } from "../types/app-context.js";
import { getHomeDefaultViewFromNavItems } from "./navigation.js";

export async function buildSyncSiteConfig(c: {
  var: Pick<
    AppVariables,
    "services" | "appConfig" | "allSettings" | "themeStyle"
  >;
}): Promise<SiteConfig> {
  const { services, appConfig, allSettings, themeStyle } = c.var;
  const navItems = await services.navItems.list();
  const appleTouchKey = allSettings["SITE_FAVICON_APPLE_TOUCH"] ?? "";
  return {
    siteName: appConfig.siteName,
    siteUrl: appConfig.siteUrl,
    siteDescription: appConfig.siteDescription,
    siteLanguage: appConfig.siteLanguage,
    showJantBrandingOnHome: appConfig.showJantBrandingOnHome,
    homeDefaultView: getHomeDefaultViewFromNavItems(navItems),
    mainRssFeed: appConfig.mainRssFeed,
    siteFooter: appConfig.siteFooter,
    showHeaderAvatar: appConfig.showHeaderAvatar,
    siteAvatarUrl: appConfig.siteAvatarUrl,
    faviconIcoBase64: allSettings["SITE_FAVICON_ICO"] ?? undefined,
    appleTouchIconStorageKey: appleTouchKey || undefined,
    faviconVersion: appConfig.faviconVersion,
    themeId: appConfig.themeId,
    defaultThemeId: appConfig.defaultThemeId,
    fontThemeId: appConfig.fontThemeId,
    themeMode: appConfig.themeMode,
    noindex: appConfig.noindex,
    themeCss: themeStyle,
    customCss: appConfig.customCSS,
    r2PublicUrl: appConfig.r2PublicUrl,
    s3PublicUrl: appConfig.s3PublicUrl,
    localPublicUrl: appConfig.localPublicUrl,
    imageTransformUrl: appConfig.imageTransformUrl,
    sitePathPrefix: appConfig.sitePathPrefix,
    navItems,
    pageSize: appConfig.pageSize,
    archivePageSize: appConfig.archivePageSize,
    rssFeedLimit: appConfig.rssFeedLimit,
  };
}
