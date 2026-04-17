/**
 * Build the SiteConfig the GitHub Sync service needs from a request
 * context. Kept in its own file so routes, API handlers, and the
 * inline sync runner can share one source of truth — historically each
 * call site had its own near-identical copy.
 */

import type { SiteConfig } from "../services/export.js";
import type { AppVariables } from "../types/app-context.js";

export function buildSyncSiteConfig(c: {
  var: { appConfig: AppVariables["appConfig"] };
}): SiteConfig {
  const cfg = c.var.appConfig;
  return {
    siteName: cfg.siteName,
    siteUrl: cfg.siteUrl,
    siteDescription: cfg.siteDescription,
    siteLanguage: cfg.siteLanguage,
    showJantBrandingOnHome: cfg.showJantBrandingOnHome,
    homeDefaultView: cfg.homeDefaultView,
    siteFooter: cfg.siteFooter,
    showHeaderAvatar: cfg.showHeaderAvatar,
    siteAvatarUrl: cfg.siteAvatarUrl,
    themeId: cfg.themeId,
    defaultThemeId: cfg.defaultThemeId,
    fontThemeId: cfg.fontThemeId,
    themeMode: cfg.themeMode,
    noindex: cfg.noindex,
    customCss: cfg.customCSS,
    r2PublicUrl: cfg.r2PublicUrl,
    s3PublicUrl: cfg.s3PublicUrl,
    localPublicUrl: cfg.localPublicUrl,
    imageTransformUrl: cfg.imageTransformUrl,
    sitePathPrefix: cfg.sitePathPrefix,
    navItems: [],
    pageSize: cfg.pageSize,
    archivePageSize: cfg.archivePageSize,
  };
}
