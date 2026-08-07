/**
 * Application Constants
 */

/**
 * Reserved URL paths that cannot be used for pages
 */
export const RESERVED_PATHS = [
  "featured",
  "latest",
  "signin",
  "signout",
  "setup",
  "settings",
  "dash",
  "api",
  "feed",
  "search",
  "archive",
  "media",
  "pages",
  "reset",
  "collections",
  "compose",
  "preview",
  "new",
  "static",
  "assets",
  "_assets",
  "healthz",
  "readyz",
  "skill.md",
] as const;

export type ReservedPath = (typeof RESERVED_PATHS)[number];

/**
 * Check if a path is reserved
 *
 * @param path - Stored path form (no leading slash)
 * @param languagePrefixes - URL prefixes of the site's additional languages
 *   (lowercase tags). While those are live, `/{prefix}` and everything under it
 *   is served by the language views, so no slug or custom URL may claim them.
 *   Passed per call rather than baked into the static list because the set is
 *   per-site and changes at runtime.
 * @returns Whether the path's first segment is unavailable
 * @example
 * isReservedPath("archive"); // true
 * isReservedPath("ja/hello", ["ja"]); // true
 * isReservedPath("ja/hello"); // false — no language configured
 */
export function isReservedPath(
  path: string,
  languagePrefixes: readonly string[] = [],
): boolean {
  const firstSegment = path.split("/")[0]?.toLowerCase();
  if (!firstSegment) return false;
  if (RESERVED_PATHS.includes(firstSegment as ReservedPath)) return true;
  return languagePrefixes.includes(firstSegment);
}

/**
 * Settings keys - derived from CONFIG_FIELDS (Single Source of Truth)
 *
 * Only non-envOnly fields and internal fields are stored in DB settings.
 * Environment-only fields (SITE_ORIGIN, SITE_PATH_PREFIX, AUTH_SECRET, etc.)
 * are never in the DB.
 */
import { CONFIG_FIELDS, type ConfigKey } from "../types.js";

type SettingsFieldKey = {
  [K in ConfigKey]: (typeof CONFIG_FIELDS)[K] extends { envOnly: false }
    ? K
    : never;
}[ConfigKey];

export const SETTINGS_KEYS = Object.fromEntries(
  Object.entries(CONFIG_FIELDS)
    .filter(([, field]) => !field.envOnly || "internal" in field)
    .map(([key]) => [key, key]),
) as { [K in SettingsFieldKey]: K };

export type SettingsKey = SettingsFieldKey;

/**
 * Onboarding status values
 */
export const ONBOARDING_STATUS = {
  PENDING: "pending",
  COMPLETED: "completed",
} as const;

export type OnboardingStatus =
  (typeof ONBOARDING_STATUS)[keyof typeof ONBOARDING_STATUS];
