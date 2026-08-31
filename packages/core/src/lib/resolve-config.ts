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
import type { ArchiveLayout, FeedKind } from "../types/constants.js";
import { ASSET_BASE_SEGMENT, getPublicAssetBasePath } from "./asset-path.js";
import { resolveDiscoverMode } from "./discover.js";
import {
  getAuthSecret,
  getConfiguredSingleSiteUrl,
  getConfiguredStorageDriver,
  getEnvString,
} from "./env.js";
import { parseLanguageList } from "../i18n/locales.js";
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
  if (!field.envOnly && Object.hasOwn(allSettings, key)) {
    return allSettings[key] ?? "";
  }

  // ENV > Default
  const envValue = getEnvString(env, ...(envKeys ?? []));
  if (envValue) return envValue;

  if (field.defaultValue) return field.defaultValue;
  if ("fallbackKey" in field && field.fallbackKey) {
    return resolve(field.fallbackKey, allSettings, env);
  }

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

  if (field.defaultValue) return field.defaultValue;
  if ("fallbackKey" in field && field.fallbackKey) {
    return resolveFallback(field.fallbackKey, env);
  }

  return field.defaultValue;
}

type RuntimeNumberConfigKey =
  | "PAGE_SIZE"
  | "SEARCH_PAGE_SIZE"
  | "ARCHIVE_PAGE_SIZE"
  | "SUMMARY_MAX_PARAGRAPHS"
  | "SUMMARY_MAX_CHARS"
  | "RSS_FEED_LIMIT"
  | "RSS_PUBLISH_DELAY_SECONDS";

function parseConfigInt(
  key: RuntimeNumberConfigKey,
  value: string,
  fallback: number,
): number {
  const normalized = value.trim();
  const parsed = Number(normalized);
  const definition = CONFIG_FIELDS[key].editor;
  return normalized.length > 0 &&
    Number.isInteger(parsed) &&
    (definition.min === undefined || parsed >= definition.min) &&
    (definition.max === undefined || parsed <= definition.max)
    ? parsed
    : fallback;
}

/**
 * Resolve the runtime limits used for automatic post summaries.
 *
 * Internal maintenance routes run before the full config middleware, so they
 * use this focused resolver instead of assuming `c.var.appConfig` exists.
 *
 * @param env - Runtime bindings.
 * @param allSettings - DB settings map when available.
 * @returns Positive summary extraction limits with configured defaults.
 * @example
 * ```ts
 * resolveSummaryConfig({ SUMMARY_MAX_CHARS: "240" }).maxChars;
 * // 240
 * ```
 */
export function resolveSummaryConfig(
  env: Bindings,
  allSettings: Record<string, string> = {},
): {
  maxParagraphs: number;
  maxChars: number;
} {
  return {
    maxParagraphs: parseConfigInt(
      "SUMMARY_MAX_PARAGRAPHS",
      resolve("SUMMARY_MAX_PARAGRAPHS", allSettings, env),
      5,
    ),
    maxChars: parseConfigInt(
      "SUMMARY_MAX_CHARS",
      resolve("SUMMARY_MAX_CHARS", allSettings, env),
      500,
    ),
  };
}

function parseFeedKind(value: string, fallback: FeedKind): FeedKind {
  return value === "latest" || value === "featured" ? value : fallback;
}

function parseArchiveLayout(
  value: string,
  fallback: ArchiveLayout,
): ArchiveLayout {
  return value === "list" || value === "grid" ? value : fallback;
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
  const summaryConfig = resolveSummaryConfig(env, allSettings);
  const pageSize = parseConfigInt(
    "PAGE_SIZE",
    resolve("PAGE_SIZE", allSettings, env),
    50,
  );
  const searchPageSize = parseConfigInt(
    "SEARCH_PAGE_SIZE",
    resolve("SEARCH_PAGE_SIZE", allSettings, env),
    pageSize,
  );
  const archivePageSize = parseConfigInt(
    "ARCHIVE_PAGE_SIZE",
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
  const hasDbDescription = Object.hasOwn(allSettings, "SITE_DESCRIPTION");
  const dbDescription = allSettings["SITE_DESCRIPTION"];
  const envDescription = getEnvString(env, "SITE_DESCRIPTION");
  const siteDescriptionExplicit = hasDbDescription
    ? !!dbDescription
    : !!envDescription;

  // Discover is "explicitly chosen" only when a value was actually stored or
  // configured. An absent row is what makes the noindex rule apply, so the
  // registry default must not stand in for it.
  const discoverExplicitValue = Object.hasOwn(allSettings, "DISCOVER")
    ? allSettings["DISCOVER"]
    : getEnvString(env, "DISCOVER");
  const noindex = demoMode || resolve("NOINDEX", allSettings, env) === "true";
  const rssFeedsEnabled =
    resolve("RSS_FEEDS_ENABLED", allSettings, env) === "true";

  return {
    // Site identity (DB > ENV > Default)
    siteName: resolve("SITE_NAME", allSettings, env),
    siteDescription: resolve("SITE_DESCRIPTION", allSettings, env),
    siteDescriptionExplicit,
    siteLanguage: resolve("SITE_LANGUAGE", allSettings, env),
    dashboardLanguage: resolve("DASHBOARD_LANGUAGE", allSettings, env),
    multilingualEnabled:
      resolve("MULTILINGUAL_ENABLED", allSettings, env) === "true",
    additionalLanguages: parseLanguageList(
      resolve("ADDITIONAL_LANGUAGES", allSettings, env),
    ),
    mainRssFeed: parseFeedKind(
      resolve("MAIN_RSS_FEED", allSettings, env),
      "featured",
    ),
    archiveDefaultLayout: parseArchiveLayout(
      resolve("ARCHIVE_DEFAULT_LAYOUT", allSettings, env),
      "list",
    ),
    timeZone: normalizeTimeZone(resolve("TIME_ZONE", allSettings, env)),
    siteFooter: resolve("SITE_FOOTER", allSettings, env),
    showJantBrandingOnHome:
      resolve("SHOW_JANT_BRANDING_ON_HOME", allSettings, env) === "true",
    noindex,
    discover: resolveDiscoverMode({
      explicitValue: discoverExplicitValue,
      demoMode,
      noindex,
      rssFeedsEnabled,
    }),
    publicApiEnabled:
      resolve("PUBLIC_API_ENABLED", allSettings, env) === "true",
    rssFeedsEnabled,

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

    // Summary extraction (DB > ENV > Default)
    summaryMaxParagraphs: summaryConfig.maxParagraphs,
    summaryMaxChars: summaryConfig.maxChars,

    // Slug (ENV only)
    slugIdLength: parseInt(getEnvString(env, "SLUG_ID_LENGTH") ?? "5", 10) || 5,

    // Pagination/feed (DB > ENV > Default)
    pageSize,
    searchPageSize,
    archivePageSize,
    rssFeedLimit: parseConfigInt(
      "RSS_FEED_LIMIT",
      resolve("RSS_FEED_LIMIT", allSettings, env),
      50,
    ),
    rssPublishDelaySeconds: parseConfigInt(
      "RSS_PUBLISH_DELAY_SECONDS",
      resolve("RSS_PUBLISH_DELAY_SECONDS", allSettings, env),
      300,
    ),

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
