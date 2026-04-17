/**
 * Configuration System
 *
 * Single Source of Truth for all configuration fields.
 */

/**
 * Configuration Registry - Single Source of Truth
 *
 * All available configuration fields with their metadata.
 * Add new fields here, and they'll automatically work everywhere.
 *
 * Priority logic:
 * - envOnly: false -> User-configurable (DB > ENV > Default)
 * - envOnly: true -> Environment-only (ENV > Default)
 */
interface ConfigField {
  defaultValue: string;
  envOnly: boolean;
  internal?: boolean;
  /**
   * Environment variable names in resolution order.
   */
  envKeys?: readonly string[];
}

export const CONFIG_FIELDS = {
  // User-configurable (can be modified in settings)
  SITE_NAME: {
    defaultValue: "Jant",
    envOnly: false,
    envKeys: ["SITE_NAME"],
  },
  SITE_DESCRIPTION: {
    defaultValue: "",
    envOnly: false,
    envKeys: ["SITE_DESCRIPTION"],
  },
  SITE_LANGUAGE: {
    defaultValue: "en",
    envOnly: false,
    envKeys: ["SITE_LANGUAGE"],
  },
  CJK_SERIF_FONT: {
    defaultValue: "off",
    envOnly: false,
    envKeys: ["CJK_SERIF_FONT"],
  },
  HOME_DEFAULT_VIEW: {
    defaultValue: "latest",
    envOnly: false,
    envKeys: ["HOME_DEFAULT_VIEW"],
  },
  MAIN_RSS_FEED: {
    defaultValue: "featured",
    envOnly: false,
    envKeys: ["MAIN_RSS_FEED"],
  },
  // Environment-only (deployment/infrastructure config)
  DEFAULT_THEME: {
    defaultValue: "tufte",
    envOnly: true,
    envKeys: ["DEFAULT_THEME"],
  },
  DEFAULT_FONT_THEME: {
    defaultValue: "tufte",
    envOnly: true,
    envKeys: ["DEFAULT_FONT_THEME"],
  },
  SITE_ORIGIN: {
    defaultValue: "",
    envOnly: true,
    envKeys: ["SITE_ORIGIN"],
  },
  SITE_PATH_PREFIX: {
    defaultValue: "",
    envOnly: true,
    envKeys: ["SITE_PATH_PREFIX"],
  },
  AUTH_SECRET: {
    defaultValue: "",
    envOnly: true,
    envKeys: ["AUTH_SECRET"],
  },
  R2_PUBLIC_URL: {
    defaultValue: "",
    envOnly: true,
    envKeys: ["R2_PUBLIC_URL"],
  },
  IMAGE_TRANSFORM_URL: {
    defaultValue: "",
    envOnly: true,
    envKeys: ["IMAGE_TRANSFORM_URL"],
  },
  DEMO_EMAIL: {
    defaultValue: "",
    envOnly: true,
    envKeys: ["DEMO_EMAIL"],
  },
  DEMO_PASSWORD: {
    defaultValue: "",
    envOnly: true,
    envKeys: ["DEMO_PASSWORD"],
  },
  DEMO_MODE: {
    defaultValue: "false",
    envOnly: true,
    envKeys: ["DEMO_MODE"],
  },
  PAGE_SIZE: {
    defaultValue: "50",
    envOnly: true,
    envKeys: ["PAGE_SIZE"],
  },
  SEARCH_PAGE_SIZE: {
    defaultValue: "",
    envOnly: true,
    envKeys: ["SEARCH_PAGE_SIZE"],
  },
  ARCHIVE_PAGE_SIZE: {
    defaultValue: "",
    envOnly: true,
    envKeys: ["ARCHIVE_PAGE_SIZE"],
  },
  STORAGE_DRIVER: {
    defaultValue: "r2",
    envOnly: true,
    envKeys: ["STORAGE_DRIVER"],
  },
  S3_ENDPOINT: {
    defaultValue: "",
    envOnly: true,
    envKeys: ["S3_ENDPOINT"],
  },
  S3_BUCKET: {
    defaultValue: "",
    envOnly: true,
    envKeys: ["S3_BUCKET"],
  },
  S3_ACCESS_KEY_ID: {
    defaultValue: "",
    envOnly: true,
    envKeys: ["S3_ACCESS_KEY_ID"],
  },
  S3_SECRET_ACCESS_KEY: {
    defaultValue: "",
    envOnly: true,
    envKeys: ["S3_SECRET_ACCESS_KEY"],
  },
  S3_REGION: {
    defaultValue: "auto",
    envOnly: true,
    envKeys: ["S3_REGION"],
  },
  S3_PUBLIC_URL: {
    defaultValue: "",
    envOnly: true,
    envKeys: ["S3_PUBLIC_URL"],
  },
  ASSET_BASE_URL: {
    defaultValue: "",
    envOnly: true,
    envKeys: ["ASSET_BASE_URL"],
  },
  UPLOAD_MAX_FILE_SIZE_MB: {
    defaultValue: "500",
    envOnly: true,
    envKeys: ["UPLOAD_MAX_FILE_SIZE_MB"],
  },
  SUMMARY_MAX_PARAGRAPHS: {
    defaultValue: "5",
    envOnly: true,
    envKeys: ["SUMMARY_MAX_PARAGRAPHS"],
  },
  SUMMARY_MAX_CHARS: {
    defaultValue: "500",
    envOnly: true,
    envKeys: ["SUMMARY_MAX_CHARS"],
  },
  SLUG_ID_LENGTH: {
    defaultValue: "5",
    envOnly: true,
    envKeys: ["SLUG_ID_LENGTH"],
  },
  RSS_FEED_LIMIT: {
    defaultValue: "50",
    envOnly: true,
    envKeys: ["RSS_FEED_LIMIT"],
  },

  // Internal settings (DB-only, not configurable via env or settings UI)
  THEME: {
    defaultValue: "",
    envOnly: false,
    internal: true,
  },
  CUSTOM_CSS: {
    defaultValue: "",
    envOnly: false,
    internal: true,
  },
  SITE_AVATAR: {
    defaultValue: "",
    envOnly: false,
    internal: true,
  },
  SHOW_HEADER_AVATAR: {
    defaultValue: "",
    envOnly: false,
    internal: true,
  },
  SITE_FAVICON_ICO: {
    defaultValue: "",
    envOnly: false,
    internal: true,
  },
  SITE_FAVICON_APPLE_TOUCH: {
    defaultValue: "",
    envOnly: false,
    internal: true,
  },
  SITE_FAVICON_VERSION: {
    defaultValue: "",
    envOnly: false,
    internal: true,
  },
  FONT_THEME: {
    defaultValue: "",
    envOnly: false,
    internal: true,
  },
  THEME_MODE: {
    defaultValue: "",
    envOnly: false,
    internal: true,
  },
  TIME_ZONE: {
    defaultValue: "UTC",
    envOnly: false,
    envKeys: ["TIME_ZONE"],
  },
  SITE_FOOTER: {
    defaultValue: "",
    envOnly: false,
    envKeys: ["SITE_FOOTER"],
  },
  SHOW_JANT_BRANDING_ON_HOME: {
    defaultValue: "",
    envOnly: false,
    envKeys: ["SHOW_JANT_BRANDING_ON_HOME"],
  },
  NOINDEX: {
    defaultValue: "",
    envOnly: false,
    envKeys: ["NOINDEX"],
  },
  DISCOVERY_COMPOSE_OPEN_SHORTCUT_AT: {
    defaultValue: "",
    envOnly: false,
    internal: true,
  },
  ONBOARDING_STATUS: {
    defaultValue: "pending",
    envOnly: false,
    internal: true,
  },
  PASSWORD_RESET_TOKEN: {
    defaultValue: "",
    envOnly: false,
    internal: true,
  },
  DELETE_CSRF_TOKEN: {
    defaultValue: "",
    envOnly: false,
    internal: true,
  },

  // GitHub Sync (DB-only, managed via GitHub Sync settings page)
  GITHUB_SYNC_ENABLED: {
    defaultValue: "false",
    envOnly: false,
    internal: true,
  },
  GITHUB_SYNC_REPO: {
    defaultValue: "",
    envOnly: false,
    internal: true,
  },
  GITHUB_SYNC_TOKEN: {
    defaultValue: "",
    envOnly: false,
    internal: true,
  },
  GITHUB_SYNC_WEBHOOK_SECRET: {
    defaultValue: "",
    envOnly: false,
    internal: true,
  },
  GITHUB_SYNC_WEBHOOK_ID: {
    defaultValue: "",
    envOnly: false,
    internal: true,
  },
  GITHUB_SYNC_LAST_PUSH_SHA: {
    defaultValue: "",
    envOnly: false,
    internal: true,
  },
  GITHUB_SYNC_LAST_PUSH_AT: {
    defaultValue: "",
    envOnly: false,
    internal: true,
  },
  GITHUB_SYNC_PENDING: {
    defaultValue: "",
    envOnly: false,
    internal: true,
  },
  /**
   * Unix-seconds timestamp captured when PENDING flips to "true".
   * Read alongside PENDING to detect a stuck flag from a crashed /
   * killed worker that never got to run its `finally` clause, so the
   * status card self-heals instead of showing "Syncing…" forever.
   */
  GITHUB_SYNC_PENDING_AT: {
    defaultValue: "",
    envOnly: false,
    internal: true,
  },
  /**
   * Set "true" when a trigger arrives while PENDING is already true.
   * The running sync consults this after its push and loops once more
   * so mid-push edits aren't lost.
   */
  GITHUB_SYNC_DIRTY: {
    defaultValue: "",
    envOnly: false,
    internal: true,
  },
  /** Last sync error message — surfaced on the status page when non-empty. */
  GITHUB_SYNC_LAST_ERROR: {
    defaultValue: "",
    envOnly: false,
    internal: true,
  },
  /** "pat" (default) or "app" — indicates which auth path to use for sync. */
  GITHUB_SYNC_AUTH_MODE: {
    defaultValue: "pat",
    envOnly: false,
    internal: true,
  },
  /** GitHub App installation id (only when AUTH_MODE = "app"). */
  GITHUB_SYNC_APP_INSTALLATION_ID: {
    defaultValue: "",
    envOnly: false,
    internal: true,
  },

  // GitHub App (env-only, shared across all sites on a hosted control plane).
  // When all three are configured, the GitHub App connect flow becomes
  // available in the GitHub Sync settings UI alongside the PAT flow.
  GITHUB_APP_ID: {
    defaultValue: "",
    envOnly: true,
    envKeys: ["GITHUB_APP_ID"],
  },
  GITHUB_APP_PRIVATE_KEY: {
    defaultValue: "",
    envOnly: true,
    envKeys: ["GITHUB_APP_PRIVATE_KEY"],
  },
  /** App slug used to build the installation URL `github.com/apps/<slug>`. */
  GITHUB_APP_SLUG: {
    defaultValue: "",
    envOnly: true,
    envKeys: ["GITHUB_APP_SLUG"],
  },
  /** Optional app-level webhook secret (overrides per-site secret for App-mode sites). */
  GITHUB_APP_WEBHOOK_SECRET: {
    defaultValue: "",
    envOnly: true,
    envKeys: ["GITHUB_APP_WEBHOOK_SECRET"],
  },
} as const satisfies Record<string, ConfigField>;

export type ConfigKey = keyof typeof CONFIG_FIELDS;
export const THEME_MODES = ["auto", "light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/**
 * Unified application configuration
 *
 * Resolved once per request from DB settings + env + defaults.
 * Access via `c.var.appConfig` in routes and lib functions.
 */
export interface AppConfig {
  // Site identity (DB > ENV > Default)
  siteName: string;
  siteDescription: string;
  /** true only when description is set in DB or ENV (not just the default) */
  siteDescriptionExplicit: boolean;
  siteLanguage: string;
  /** CJK serif font locale: "off", "zh-Hans", "zh-Hant", "ja", or "ko" */
  cjkSerifFont: string;
  homeDefaultView: string;
  mainRssFeed: string;
  /** Canonical IANA timezone identifier used for date/time display. */
  timeZone: string;
  siteFooter: string;
  showJantBrandingOnHome: boolean;
  noindex: boolean;

  // Infrastructure (ENV only)
  siteUrl: string;
  siteOrigin: string;
  sitePathPrefix: string;
  assetBasePath: string;
  authConfigured: boolean;

  // Media (ENV only)
  storageDriver: string;
  r2PublicUrl: string;
  s3PublicUrl: string;
  localPublicUrl: string;
  imageTransformUrl: string;

  // Upload (ENV only, parsed to number)
  /** Max upload file size in MB. Defaults to 500. */
  uploadMaxFileSize: number;

  // Summary extraction (ENV only)
  /** Max paragraphs to include in auto-extracted summary. Defaults to 5. */
  summaryMaxParagraphs: number;
  /** Max characters to include in auto-extracted summary. Defaults to 500. */
  summaryMaxChars: number;

  // Pagination/Feed (ENV only, parsed to number)
  pageSize: number;
  searchPageSize: number;
  archivePageSize: number;
  rssFeedLimit: number;

  // Slug (ENV only)
  /** Length of random IDs used in auto-generated slugs. Defaults to 5. */
  slugIdLength: number;

  // Demo (ENV only)
  demoEmail: string;
  demoPassword: string;
  demoMode: boolean;

  // Theme (DB internal)
  themeId: string;
  defaultThemeId: string;
  fontThemeId: string;
  defaultFontThemeId: string;
  themeMode: ThemeMode;
  customCSS: string;

  // Site appearance (DB internal)
  siteAvatar: string;
  showHeaderAvatar: boolean;
  /** Derived: getMediaUrl(siteAvatar, publicUrl) */
  siteAvatarUrl: string;
  faviconVersion: string;

  // Settings form placeholders (ENV > Default, without DB)
  fallbacks: {
    siteName: string;
    siteDescription: string;
    defaultTheme: string;
  };
}
