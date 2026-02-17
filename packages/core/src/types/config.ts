/**
 * Configuration System
 *
 * Single Source of Truth for all configuration fields.
 */

import type { ColorTheme } from "../ui/color-themes.js";
import type { FeedData, SitemapData } from "./views.js";

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
export const CONFIG_FIELDS = {
  // User-configurable (can be modified in dashboard)
  SITE_NAME: {
    defaultValue: "Jant",
    envOnly: false,
  },
  SITE_DESCRIPTION: {
    defaultValue: "A microblog powered by Jant",
    envOnly: false,
  },
  SITE_LANGUAGE: {
    defaultValue: "en",
    envOnly: false,
  },
  HOME_DEFAULT_VIEW: {
    defaultValue: "latest",
    envOnly: false,
  },

  // Environment-only (deployment/infrastructure config)
  SITE_URL: {
    defaultValue: "",
    envOnly: true,
  },
  AUTH_SECRET: {
    defaultValue: "",
    envOnly: true,
  },
  R2_PUBLIC_URL: {
    defaultValue: "",
    envOnly: true,
  },
  IMAGE_TRANSFORM_URL: {
    defaultValue: "",
    envOnly: true,
  },
  DEMO_EMAIL: {
    defaultValue: "",
    envOnly: true,
  },
  DEMO_PASSWORD: {
    defaultValue: "",
    envOnly: true,
  },
  PAGE_SIZE: {
    defaultValue: "20",
    envOnly: true,
  },
  STORAGE_DRIVER: {
    defaultValue: "r2",
    envOnly: true,
  },
  S3_ENDPOINT: {
    defaultValue: "",
    envOnly: true,
  },
  S3_BUCKET: {
    defaultValue: "",
    envOnly: true,
  },
  S3_ACCESS_KEY_ID: {
    defaultValue: "",
    envOnly: true,
  },
  S3_SECRET_ACCESS_KEY: {
    defaultValue: "",
    envOnly: true,
  },
  S3_REGION: {
    defaultValue: "auto",
    envOnly: true,
  },
  S3_PUBLIC_URL: {
    defaultValue: "",
    envOnly: true,
  },

  // Internal settings (DB-only, not configurable via env or dashboard)
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
  FONT_THEME: {
    defaultValue: "",
    envOnly: false,
    internal: true,
  },
  TIME_ZONE: {
    defaultValue: "UTC",
    envOnly: false,
  },
  SITE_FOOTER: {
    defaultValue: "",
    envOnly: false,
  },
  NOINDEX: {
    defaultValue: "",
    envOnly: false,
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
} as const;

export type ConfigKey = keyof typeof CONFIG_FIELDS;

/**
 * Main Jant configuration
 *
 * Configuration Philosophy:
 * - Use environment variables for runtime config (API keys, feature flags, site settings)
 * - Use code config (this object) for CSS customization and feed overrides
 *
 * Site-level settings (name, description, language) are configured via
 * environment variables, not here. See lib/config.ts for details.
 */
export interface JantConfig {
  /** CSS variable overrides (highest priority after custom CSS) */
  cssVariables?: Record<string, string>;
  /** Replace built-in color themes with custom list */
  colorThemes?: ColorTheme[];
  /** Custom feed renderers */
  feed?: {
    /** Custom RSS 2.0 renderer -- returns XML string */
    rss?: (data: FeedData) => string;
    /** Custom Atom renderer -- returns XML string */
    atom?: (data: FeedData) => string;
    /** Custom Sitemap renderer -- returns XML string */
    sitemap?: (data: SitemapData) => string;
  };
}
