/**
 * Application Constants
 */

/**
 * Reserved URL paths that cannot be used for pages
 */
export const RESERVED_PATHS = [
  "featured",
  "signin",
  "signout",
  "setup",
  "dash",
  "api",
  "feed",
  "search",
  "archive",
  "notes",
  "articles",
  "links",
  "quotes",
  "media",
  "pages",
  "p",
  "c",
  "static",
  "assets",
  "health",
] as const;

export type ReservedPath = (typeof RESERVED_PATHS)[number];

/**
 * Check if a path is reserved
 */
export function isReservedPath(path: string): boolean {
  const firstSegment = path.split("/")[0]?.toLowerCase();
  return RESERVED_PATHS.includes(firstSegment as ReservedPath);
}

/**
 * Default pagination size
 */
export const DEFAULT_PAGE_SIZE = 100;

/**
 * Settings keys (match environment variable naming)
 */
export const SETTINGS_KEYS = {
  ONBOARDING_STATUS: "ONBOARDING_STATUS",
  SITE_NAME: "SITE_NAME",
  SITE_DESCRIPTION: "SITE_DESCRIPTION",
  SITE_LANGUAGE: "SITE_LANGUAGE",
  THEME: "THEME",
} as const;

export type SettingsKey = (typeof SETTINGS_KEYS)[keyof typeof SETTINGS_KEYS];

/**
 * Onboarding status values
 */
export const ONBOARDING_STATUS = {
  PENDING: "pending",
  COMPLETED: "completed",
} as const;

export type OnboardingStatus =
  (typeof ONBOARDING_STATUS)[keyof typeof ONBOARDING_STATUS];
