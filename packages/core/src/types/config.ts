/**
 * Configuration System
 *
 * Single Source of Truth for all configuration fields.
 */

import {
  MAX_SITE_DESCRIPTION_LENGTH,
  MAX_SITE_FOOTER_LENGTH,
  MAX_SITE_NAME_LENGTH,
  type ArchiveLayout,
  type FeedKind,
} from "./constants.js";

export type ConfigEditorOptionsSource = "contentLanguage" | "timeZone";

export type ConfigEditorDefinition =
  | {
      type: "boolean";
    }
  | {
      type: "string";
      maxLength?: number;
    }
  | {
      type: "number";
      min?: number;
      max?: number;
      step?: number;
    }
  | {
      type: "enum";
      options: readonly string[];
      optionsSource?: never;
    }
  | {
      type: "enum";
      options?: never;
      optionsSource: ConfigEditorOptionsSource;
    };

export interface ConfigEditorLinkDefinition {
  type: "boolean" | "string";
  settingsPath: string;
  display: "value" | "configured";
  fallbackKey?: "DEFAULT_THEME" | "DEFAULT_FONT_THEME";
  fallbackValue?: string;
  resettable?: boolean;
}

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
  /** Another runtime field to inherit when this field has no own value. */
  fallbackKey?: "PAGE_SIZE";
  /**
   * Explicitly opts a safe runtime setting into Config Editor.
   *
   * Omission is intentional: environment infrastructure, secrets, and
   * internal state must never become editable merely because they are added
   * to the broader config registry.
   */
  editor?: ConfigEditorDefinition;
  /**
   * Adds a safe dedicated-page setting to the searchable Config Editor index
   * without duplicating its specialized editing workflow.
   */
  configEditorLink?: ConfigEditorLinkDefinition;
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
    editor: { type: "string", maxLength: MAX_SITE_NAME_LENGTH },
    configEditorLink: {
      type: "string",
      settingsPath: "/settings/general",
      display: "value",
      resettable: true,
    },
  },
  SITE_DESCRIPTION: {
    defaultValue: "",
    envOnly: false,
    envKeys: ["SITE_DESCRIPTION"],
    editor: { type: "string", maxLength: MAX_SITE_DESCRIPTION_LENGTH },
    configEditorLink: {
      type: "string",
      settingsPath: "/settings/general",
      display: "configured",
      resettable: true,
    },
  },
  SITE_LANGUAGE: {
    defaultValue: "en",
    envOnly: false,
    envKeys: ["SITE_LANGUAGE"],
    editor: { type: "enum", optionsSource: "contentLanguage" },
  },
  // Admin dashboard UI locale. Empty means "follow the content language"
  // (resolved through the catalog fallback chain, i.e. today's behaviour).
  DASHBOARD_LANGUAGE: {
    defaultValue: "",
    envOnly: false,
    envKeys: ["DASHBOARD_LANGUAGE"],
    editor: {
      type: "enum",
      options: ["", "en", "zh-Hans", "zh-Hant"],
    },
  },
  // Multilingual content. Both keys are deliberately DB-only:
  //
  // - No `envKeys`: an env var could flip multilingual on without the confirm
  //   step that stamps existing posts with the primary language, and every
  //   unstamped post would vanish from the root view. Adding a language through
  //   env would likewise skip the URL-prefix conflict check.
  // - No `editor`: `PUT /api/settings` and the generic Config Editor both gate
  //   on `"editor" in field`, so omitting it leaves exactly one writer — the
  //   language service, which owns the ordering these settings depend on.
  //
  // `configEditorLink` keeps them findable in settings search without making
  // them directly writable.
  MULTILINGUAL_ENABLED: {
    defaultValue: "false",
    envOnly: false,
    configEditorLink: {
      type: "boolean",
      settingsPath: "/settings/language",
      display: "value",
    },
  },
  // Comma-separated canonical BCP 47 tags, in switcher order. Never contains
  // the primary language. Comma-separated rather than JSON because tags cannot
  // contain commas: no escaping, readable in the settings table, order-preserving.
  ADDITIONAL_LANGUAGES: {
    defaultValue: "",
    envOnly: false,
    configEditorLink: {
      type: "string",
      settingsPath: "/settings/language",
      display: "configured",
    },
  },
  MAIN_RSS_FEED: {
    defaultValue: "featured",
    envOnly: false,
    envKeys: ["MAIN_RSS_FEED"],
    editor: { type: "enum", options: ["featured", "latest"] },
  },
  // The archive is the widest of Featured / Latest / All, and the other two
  // render as timelines. `list` keeps the trio consistent; `grid` turns the
  // page back into a tile catalogue.
  ARCHIVE_DEFAULT_LAYOUT: {
    defaultValue: "list",
    envOnly: false,
    envKeys: ["ARCHIVE_DEFAULT_LAYOUT"],
    editor: { type: "enum", options: ["list", "grid"] },
  },
  // Environment-only (deployment/infrastructure config)
  DEFAULT_THEME: {
    defaultValue: "tufte",
    envOnly: true,
    envKeys: ["DEFAULT_THEME"],
  },
  DEFAULT_FONT_THEME: {
    defaultValue: "classic",
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
    envOnly: false,
    envKeys: ["PAGE_SIZE"],
    editor: { type: "number", min: 1, max: 100, step: 1 },
  },
  SEARCH_PAGE_SIZE: {
    defaultValue: "",
    envOnly: false,
    fallbackKey: "PAGE_SIZE",
    envKeys: ["SEARCH_PAGE_SIZE"],
    editor: { type: "number", min: 1, max: 100, step: 1 },
  },
  ARCHIVE_PAGE_SIZE: {
    defaultValue: "",
    envOnly: false,
    fallbackKey: "PAGE_SIZE",
    envKeys: ["ARCHIVE_PAGE_SIZE"],
    editor: { type: "number", min: 1, max: 100, step: 1 },
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
    defaultValue: "1024",
    envOnly: true,
    envKeys: ["UPLOAD_MAX_FILE_SIZE_MB"],
  },
  SUMMARY_MAX_PARAGRAPHS: {
    defaultValue: "5",
    envOnly: false,
    envKeys: ["SUMMARY_MAX_PARAGRAPHS"],
    editor: { type: "number", min: 1, max: 50, step: 1 },
  },
  SUMMARY_MAX_CHARS: {
    defaultValue: "500",
    envOnly: false,
    envKeys: ["SUMMARY_MAX_CHARS"],
    editor: { type: "number", min: 1, max: 1500, step: 1 },
  },
  SLUG_ID_LENGTH: {
    defaultValue: "5",
    envOnly: true,
    envKeys: ["SLUG_ID_LENGTH"],
  },
  RSS_FEED_LIMIT: {
    defaultValue: "50",
    envOnly: false,
    envKeys: ["RSS_FEED_LIMIT"],
    editor: { type: "number", min: 1, max: 200, step: 1 },
  },
  RSS_PUBLISH_DELAY_SECONDS: {
    defaultValue: "300",
    envOnly: false,
    envKeys: ["RSS_PUBLISH_DELAY_SECONDS"],
    editor: { type: "number", min: 0, max: 7200, step: 1 },
  },

  // Internal settings (DB-only, not configurable via env or settings UI)
  THEME: {
    defaultValue: "",
    envOnly: false,
    internal: true,
    configEditorLink: {
      type: "string",
      settingsPath: "/settings/color-theme",
      display: "value",
      fallbackKey: "DEFAULT_THEME",
      resettable: true,
    },
  },
  CUSTOM_CSS: {
    defaultValue: "",
    envOnly: false,
    internal: true,
    configEditorLink: {
      type: "string",
      settingsPath: "/settings/custom-css",
      display: "configured",
    },
  },
  CUSTOM_HEAD_HTML: {
    defaultValue: "",
    envOnly: false,
    internal: true,
    configEditorLink: {
      type: "string",
      settingsPath: "/settings/code-injection",
      display: "configured",
    },
  },
  CUSTOM_BODY_END_HTML: {
    defaultValue: "",
    envOnly: false,
    internal: true,
    configEditorLink: {
      type: "string",
      settingsPath: "/settings/code-injection",
      display: "configured",
    },
  },
  SITE_AVATAR: {
    defaultValue: "",
    envOnly: false,
    internal: true,
    configEditorLink: {
      type: "string",
      settingsPath: "/settings/avatar",
      display: "configured",
    },
  },
  SHOW_HEADER_AVATAR: {
    defaultValue: "",
    envOnly: false,
    internal: true,
    configEditorLink: {
      type: "boolean",
      settingsPath: "/settings/avatar",
      display: "value",
      fallbackValue: "false",
      resettable: true,
    },
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
    configEditorLink: {
      type: "string",
      settingsPath: "/settings/font-theme",
      display: "value",
      fallbackKey: "DEFAULT_FONT_THEME",
      resettable: true,
    },
  },
  THEME_MODE: {
    defaultValue: "",
    envOnly: false,
    internal: true,
    configEditorLink: {
      type: "string",
      settingsPath: "/settings/color-theme",
      display: "value",
      fallbackValue: "auto",
      resettable: true,
    },
  },
  TIME_ZONE: {
    defaultValue: "UTC",
    envOnly: false,
    envKeys: ["TIME_ZONE"],
    editor: { type: "enum", optionsSource: "timeZone" },
  },
  SITE_FOOTER: {
    defaultValue: "",
    envOnly: false,
    envKeys: ["SITE_FOOTER"],
    editor: { type: "string", maxLength: MAX_SITE_FOOTER_LENGTH },
    configEditorLink: {
      type: "string",
      settingsPath: "/settings/general",
      display: "configured",
      resettable: true,
    },
  },
  SHOW_JANT_BRANDING_ON_HOME: {
    defaultValue: "false",
    envOnly: false,
    envKeys: ["SHOW_JANT_BRANDING_ON_HOME"],
    editor: { type: "boolean" },
  },
  NOINDEX: {
    defaultValue: "false",
    envOnly: false,
    envKeys: ["NOINDEX"],
    editor: { type: "boolean" },
  },
  PUBLIC_API_ENABLED: {
    defaultValue: "true",
    envOnly: false,
    envKeys: ["PUBLIC_API_ENABLED"],
    editor: { type: "boolean" },
  },
  RSS_FEEDS_ENABLED: {
    defaultValue: "true",
    envOnly: false,
    envKeys: ["RSS_FEEDS_ENABLED"],
    editor: { type: "boolean" },
  },
  DISCOVERY_COMPOSE_OPEN_SHORTCUT_AT: {
    defaultValue: "",
    envOnly: false,
    internal: true,
  },
  DISCOVERY_SLASH_COMMAND_AT: {
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

  // GitHub Sync (DB-only, managed via GitHub Sync settings page)
  GITHUB_SYNC_ENABLED: {
    defaultValue: "false",
    envOnly: false,
    internal: true,
    configEditorLink: {
      type: "boolean",
      settingsPath: "/settings/github-sync",
      display: "value",
    },
  },
  GITHUB_SYNC_REPO: {
    defaultValue: "",
    envOnly: false,
    internal: true,
    configEditorLink: {
      type: "string",
      settingsPath: "/settings/github-sync",
      display: "configured",
    },
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

  // Telegram bot pool (env-only). When TELEGRAM_BOT_TOKENS is set the bot
  // tokens are platform-managed (hosted, or a single-site operator who opts
  // in) and the settings UI hides the token field. Comma-separated list of
  // `<bot_id>:<secret>` tokens; TELEGRAM_WEBHOOK_SECRET is the shared
  // `secret_token` used when registering every pool bot's webhook.
  TELEGRAM_BOT_TOKENS: {
    defaultValue: "",
    envOnly: true,
    envKeys: ["TELEGRAM_BOT_TOKENS"],
  },
  TELEGRAM_WEBHOOK_SECRET: {
    defaultValue: "",
    envOnly: true,
    envKeys: ["TELEGRAM_WEBHOOK_SECRET"],
  },

  // Telegram bring-your-own bot (DB-only, single-site, managed via the
  // Telegram settings page when TELEGRAM_BOT_TOKENS is not set).
  TELEGRAM_BOT_TOKEN: {
    defaultValue: "",
    envOnly: false,
    internal: true,
  },
  TELEGRAM_BOT_ID: {
    defaultValue: "",
    envOnly: false,
    internal: true,
  },
  TELEGRAM_BOT_USERNAME: {
    defaultValue: "",
    envOnly: false,
    internal: true,
    configEditorLink: {
      type: "string",
      settingsPath: "/settings/telegram",
      display: "configured",
    },
  },
  /** Per-site `secret_token` for a bring-your-own bot's webhook. */
  TELEGRAM_BOT_WEBHOOK_SECRET: {
    defaultValue: "",
    envOnly: false,
    internal: true,
  },
} as const satisfies Record<string, ConfigField>;

export type ConfigKey = keyof typeof CONFIG_FIELDS;
export type ConfigEditorKey = {
  [K in ConfigKey]: (typeof CONFIG_FIELDS)[K] extends {
    editor: ConfigEditorDefinition;
  }
    ? K
    : never;
}[ConfigKey];

export type ConfigEditorVisibleKey = {
  [K in ConfigKey]: (typeof CONFIG_FIELDS)[K] extends
    | { editor: ConfigEditorDefinition }
    | { configEditorLink: ConfigEditorLinkDefinition }
    ? K
    : never;
}[ConfigKey];

export type ConfigEditorResettableKey = {
  [K in ConfigKey]: (typeof CONFIG_FIELDS)[K] extends {
    editor: ConfigEditorDefinition;
  }
    ? K
    : (typeof CONFIG_FIELDS)[K] extends {
          configEditorLink: { resettable: true };
        }
      ? K
      : never;
}[ConfigKey];

export interface ConfigEditorFieldState {
  key: ConfigEditorVisibleKey;
  mode: "edit" | "link";
  type: ConfigEditorDefinition["type"];
  value: string;
  fallbackValue: string;
  modified: boolean;
  locked: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly string[];
  settingsPath?: string;
  display?: ConfigEditorLinkDefinition["display"];
  resettable?: boolean;
  fallbackKey?: "PAGE_SIZE";
}
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
  /**
   * The site's content language, and — once multilingual content is on — its
   * primary language: the one served from the unprefixed root URLs.
   */
  siteLanguage: string;
  /**
   * Admin dashboard UI locale. Empty string means "follow the content
   * language" (derived via the catalog fallback chain). When set, it is one of
   * the translated catalog locales ("en", "zh-Hans", "zh-Hant").
   */
  dashboardLanguage: string;
  /** Whether the site serves per-language browsing views. */
  multilingualEnabled: boolean;
  /**
   * Canonical BCP 47 tags served under a URL prefix, in switcher order. Never
   * includes `siteLanguage`. Retained when multilingual is switched off so
   * turning it back on restores the same setup — and so the old prefixes can
   * still redirect rather than 404.
   */
  additionalLanguages: string[];
  mainRssFeed: FeedKind;
  /** Layout `/archive` uses when the URL names no explicit layout. */
  archiveDefaultLayout: ArchiveLayout;
  /** Canonical IANA timezone identifier used for date/time display. */
  timeZone: string;
  siteFooter: string;
  showJantBrandingOnHome: boolean;
  noindex: boolean;
  /** Whether published content can be read from JSON APIs without authentication. */
  publicApiEnabled: boolean;
  /** Whether the site publishes its Atom feed endpoints. */
  rssFeedsEnabled: boolean;

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

  // Summary extraction (DB > ENV > Default)
  /** Max paragraphs to include in auto-extracted summary. Defaults to 5. */
  summaryMaxParagraphs: number;
  /** Max characters to include in auto-extracted summary. Defaults to 500. */
  summaryMaxChars: number;

  // Pagination/feed (DB > ENV > Default)
  pageSize: number;
  searchPageSize: number;
  archivePageSize: number;
  rssFeedLimit: number;
  /** Seconds a published Post waits before it can appear in Atom feeds. */
  rssPublishDelaySeconds: number;

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
  customHeadHtml: string;
  customBodyEndHtml: string;

  // Site appearance (DB internal)
  siteAvatar: string;
  showHeaderAvatar: boolean;
  /** Derived: getMediaUrl(siteAvatar, publicUrl) */
  siteAvatarUrl: string;
  faviconVersion: string;

  // Rate limiting (ENV only)
  rateLimit: {
    /** When true, all rate-limit middleware becomes a no-op. */
    disabled: boolean;
    /** Per-IP cap for `/api/search` requests per 60-second window. */
    searchPerMinute: number;
  };

  // Settings form placeholders (ENV > Default, without DB)
  fallbacks: {
    siteName: string;
    siteDescription: string;
    defaultTheme: string;
  };
}
