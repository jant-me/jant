/**
 * Export API Routes
 */

import { Hono } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { requireAuthApi } from "../../middleware/auth.js";
import { createExportService } from "../../services/export.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const exportApiRoutes = new Hono<Env>();

exportApiRoutes.post("/hugo", requireAuthApi(), async (c) => {
  const { services, appConfig, allSettings, themeStyle } = c.var;
  const navItems = await services.navItems.list();
  const appleTouchKey = allSettings["SITE_FAVICON_APPLE_TOUCH"] ?? "";
  const exportService = createExportService(
    services,
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
    },
    {
      storage: c.var.storage,
    },
  );
  // Streamed: stored media is read as the archive goes out, so the response
  // starts at once and memory stays flat whatever the site's size.
  return new Response(await exportService.generateHugoSite(), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="jant-export.zip"',
    },
  });
});
