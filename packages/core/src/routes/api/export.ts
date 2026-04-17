/**
 * Export API Routes
 */

import { Hono } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { getHomeDefaultViewFromNavItems } from "../../lib/navigation.js";
import { requireAuthApi } from "../../middleware/auth.js";
import { createExportService } from "../../services/export.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const exportApiRoutes = new Hono<Env>();

exportApiRoutes.post("/zola", requireAuthApi(), async (c) => {
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
      showJantBrandingOnHome: appConfig.showJantBrandingOnHome,
      homeDefaultView: getHomeDefaultViewFromNavItems(navItems),
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
    },
    {
      storage: c.var.storage,
    },
  );
  const zip = await exportService.generateZolaSite();
  return new Response(zip, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="jant-export.zip"',
      "Content-Length": String(zip.byteLength),
    },
  });
});
