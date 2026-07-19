/**
 * Unified App Configuration
 *
 * Resolves all configuration from environment + DB settings into a single
 * immutable object. Created once per request in middleware, then accessed
 * via `c.var.appConfig` everywhere else.
 *
 * Priority: DB > ENV > Default (for user-configurable fields)
 *           ENV > Default (for envOnly fields)
 */

import type { Bindings } from "../types/bindings.js";
import type { AppConfig } from "../types/config.js";
import { CONFIG_FIELDS } from "../types/config.js";
import type { FeedKind } from "../types/constants.js";
import { ASSET_BASE_SEGMENT, getPublicAssetBasePath } from "./asset-path.js";
import {
  getAuthSecret,
  getConfiguredSingleSiteUrl,
  getConfiguredStorageDriver,
  getEnvString,
} from "./env.js";
import { getPublicUrlForProvider, getMediaUrl } from "./image.js";
import { normalizeTimeZone } from "./timezones.js";
import { getSiteOrigin, getSitePathPrefix, normalizeSiteUrl } from "./url.js";

/**
 * Resolve a single config value following priority rules.
 *
 * @param key - CONFIG_FIELDS key
 * @param allSettings - DB settings map
 * @param env - Worker bindings
 * @returns Resolved string value
 */
function resolve(
  key: string,
  allSettings: Record<string, string>,
  env: Bindings,
): string {
  const field = CONFIG_FIELDS[key as keyof typeof CONFIG_FIELDS];
  if (!field) return "";
  const envKeys = "envKeys" in field ? field.envKeys : undefined;

  // User-configurable: DB > ENV > Default
  if (!field.envOnly) {
    const dbValue = allSettings[key];
    if (dbValue) return dbValue;
  }

  // ENV > Default
  const envValue = getEnvString(env, ...(envKeys ?? []));
  if (envValue) return envValue;

  return field.defaultValue;
}

/**
 * Resolve a fallback value (ENV > Default), skipping the database.
 * Used for placeholder values in forms.
 *
 * @param key - CONFIG_FIELDS key
 * @param env - Worker bindings
 * @returns Fallback value
 */
function resolveFallback(key: string, env: Bindings): string {
  const field = CONFIG_FIELDS[key as keyof typeof CONFIG_FIELDS];
  if (!field) return "";
  const envKeys = "envKeys" in field ? field.envKeys : undefined;

  const envValue = getEnvString(env, ...(envKeys ?? []));
  if (envValue) return envValue;

  return field.defaultValue;
}

function parseConfigInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Resolve the environment-only limits used for automatic post summaries.
 *
 * Internal maintenance routes run before the full config middleware, so they
 * use this focused resolver instead of assuming `c.var.appConfig` exists.
 *
 * @param env - Runtime bindings.
 * @returns Positive summary extraction limits with configured defaults.
 * @example
 * ```ts
 * resolveSummaryConfig({ SUMMARY_MAX_CHARS: "240" }).maxChars;
 * // 240
 * ```
 */
export function resolveSummaryConfig(env: Bindings): {
  maxParagraphs: number;
  maxChars: number;
} {
  return {
    maxParagraphs: parseConfigInt(
      resolveFallback("SUMMARY_MAX_PARAGRAPHS", env),
      5,
    ),
    maxChars: parseConfigInt(resolveFallback("SUMMARY_MAX_CHARS", env), 500),
  };
}

function parseFeedKind(value: string, fallback: FeedKind): FeedKind {
  return value === "latest" || value === "featured" ? value : fallback;
}

/**
 * Build a complete AppConfig from environment bindings and DB settings.
 *
 * Pure function — no side effects, no DB access.
 *
 * @param env - Cloudflare Worker bindings
 * @param allSettings - All DB settings (from `services.settings.getAll()`)
 * @returns Fully resolved AppConfig
 *
 * @example
 * ```ts
 * const allSettings = await services.settings.getAll();
 * const appConfig = resolveConfig(c.env, allSettings);
 * ```
 */
export function resolveConfig(
  env: Bindings,
  allSettings: Record<string, string>,
  options?: { siteUrl?: string },
): AppConfig {
  const summaryConfig = resolveSummaryConfig(env);
  const pageSize = parseConfigInt(resolve("PAGE_SIZE", allSettings, env), 50);
  const searchPageSize = parseConfigInt(
    resolve("SEARCH_PAGE_SIZE", allSettings, env),
    pageSize,
  );
  const archivePageSize = parseConfigInt(
    resolve("ARCHIVE_PAGE_SIZE", allSettings, env),
    pageSize,
  );
  const siteUrl = normalizeSiteUrl(
    options?.siteUrl ?? getConfiguredSingleSiteUrl(env),
  );
  const siteOrigin = getSiteOrigin(siteUrl);
  const sitePathPrefix = getSitePathPrefix(siteUrl);
  const storageDriver = getConfiguredStorageDriver(env);
  const r2PublicUrl = getEnvString(env, "R2_PUBLIC_URL") || "";
  const s3PublicUrl = getEnvString(env, "S3_PUBLIC_URL") || "";
  const localPublicUrl = getEnvString(env, "LOCAL_PUBLIC_URL") || "";
  const imageTransformUrl = getEnvString(env, "IMAGE_TRANSFORM_URL") || "";
  const demoMode = getEnvString(env, "DEMO_MODE") === "true";

  // Resolve avatar URL from storage key
  const siteAvatar = allSettings["SITE_AVATAR"] ?? "";
  let siteAvatarUrl = "";
  if (siteAvatar) {
    const publicUrl = getPublicUrlForProvider(
      storageDriver,
      r2PublicUrl,
      s3PublicUrl,
      localPublicUrl,
    );
    siteAvatarUrl = getMediaUrl(siteAvatar, publicUrl, sitePathPrefix);
  }

  // Description is "explicit" when set in DB or ENV (not just the default)
  const dbDescription = allSettings["SITE_DESCRIPTION"];
  const envDescription = getEnvString(env, "SITE_DESCRIPTION");
  const siteDescriptionExplicit = !!(dbDescription || envDescription);

  return {
    // Site identity (DB > ENV > Default)
    siteName: resolve("SITE_NAME", allSettings, env),
    siteDescription: resolve("SITE_DESCRIPTION", allSettings, env),
    siteDescriptionExplicit,
    siteLanguage: resolve("SITE_LANGUAGE", allSettings, env),
    dashboardLanguage: resolve("DASHBOARD_LANGUAGE", allSettings, env),
    cjkSerifFont: resolve("CJK_SERIF_FONT", allSettings, env),
    mainRssFeed: parseFeedKind(
      resolve("MAIN_RSS_FEED", allSettings, env),
      "featured",
    ),
    timeZone: normalizeTimeZone(resolve("TIME_ZONE", allSettings, env)),
    siteFooter: resolve("SITE_FOOTER", allSettings, env),
    showJantBrandingOnHome:
      resolve("SHOW_JANT_BRANDING_ON_HOME", allSettings, env) === "true",
    noindex: demoMode || resolve("NOINDEX", allSettings, env) === "true",

    // Infrastructure (ENV only)
    siteUrl,
    siteOrigin,
    sitePathPrefix,
    assetBasePath: (() => {
      const assetBaseUrl = (getEnvString(env, "ASSET_BASE_URL") ?? "")
        .trim()
        .replace(/\/+$/, "");
      return assetBaseUrl
        ? `${assetBaseUrl}/${ASSET_BASE_SEGMENT}`
        : getPublicAssetBasePath(sitePathPrefix);
    })(),
    authConfigured: !!getAuthSecret(env),

    // Media (ENV only)
    storageDriver,
    r2PublicUrl,
    s3PublicUrl,
    localPublicUrl,
    imageTransformUrl,

    // Upload (ENV only)
    uploadMaxFileSize:
      parseInt(getEnvString(env, "UPLOAD_MAX_FILE_SIZE_MB") ?? "1024", 10) ||
      1024,

    // Summary extraction (ENV only)
    summaryMaxParagraphs: summaryConfig.maxParagraphs,
    summaryMaxChars: summaryConfig.maxChars,

    // Slug (ENV only)
    slugIdLength: parseInt(getEnvString(env, "SLUG_ID_LENGTH") ?? "5", 10) || 5,

    // Pagination/Feed (ENV only)
    pageSize,
    searchPageSize,
    archivePageSize,
    rssFeedLimit:
      parseInt(getEnvString(env, "RSS_FEED_LIMIT") ?? "50", 10) || 50,

    // Demo (ENV only)
    demoEmail: getEnvString(env, "DEMO_EMAIL") || "",
    demoPassword: getEnvString(env, "DEMO_PASSWORD") || "",
    demoMode,

    // Theme (DB internal)
    themeId:
      allSettings["THEME"] ||
      getEnvString(env, "DEFAULT_THEME") ||
      CONFIG_FIELDS.DEFAULT_THEME.defaultValue,
    defaultThemeId:
      getEnvString(env, "DEFAULT_THEME") ||
      CONFIG_FIELDS.DEFAULT_THEME.defaultValue,
    fontThemeId:
      allSettings["FONT_THEME"] ||
      getEnvString(env, "DEFAULT_FONT_THEME") ||
      CONFIG_FIELDS.DEFAULT_FONT_THEME.defaultValue,
    defaultFontThemeId:
      getEnvString(env, "DEFAULT_FONT_THEME") ||
      CONFIG_FIELDS.DEFAULT_FONT_THEME.defaultValue,
    themeMode:
      allSettings["THEME_MODE"] === "light" ||
      allSettings["THEME_MODE"] === "dark"
        ? allSettings["THEME_MODE"]
        : "auto",
    customCSS: allSettings["CUSTOM_CSS"] ?? "",
    customHeadHtml: allSettings["CUSTOM_HEAD_HTML"] ?? "",
    customBodyEndHtml: allSettings["CUSTOM_BODY_END_HTML"] ?? "",

    // Site appearance (DB internal)
    siteAvatar,
    showHeaderAvatar: allSettings["SHOW_HEADER_AVATAR"] === "true",
    siteAvatarUrl,
    faviconVersion: allSettings["SITE_FAVICON_VERSION"] ?? "",

    // Rate limiting (ENV only). Defaults are conservative enough for a
    // human typing in the search UI but reject bot floods.
    rateLimit: {
      disabled: getEnvString(env, "RATE_LIMIT_DISABLED") === "true",
      searchPerMinute:
        parseInt(getEnvString(env, "RATE_LIMIT_SEARCH_PER_MIN") ?? "30", 10) ||
        30,
    },

    // Settings form placeholders (ENV > Default, without DB)
    fallbacks: {
      siteName: resolveFallback("SITE_NAME", env),
      siteDescription: resolveFallback("SITE_DESCRIPTION", env),
      defaultTheme: resolveFallback("DEFAULT_THEME", env),
    },
  };
}
