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
  "subscribe",
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
  // Files served at the root. Only a custom URL could take one of these (a
  // slug has no dot), and the route answering first would leave it unreachable.
  "robots.txt",
  "manifest.webmanifest",
  "favicon.ico",
  "apple-touch-icon.png",
  // Public storage for keys stored before the `media/` layout.
  "sites",
] as const;

/**
 * Sitemap file names, reserved as a family: `sitemap.xml` and every
 * `sitemap-*.xml` it links to, including the numbered post sitemaps, and any
 * the sitemap adds later.
 */
const RESERVED_SITEMAP_PATTERN = /^sitemap(?:-[a-z0-9-]+)?\.xml$/;

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
 * isReservedPath("_drafts"); // true — Jant's namespace
 * isReservedPath(".well-known/security.txt"); // true
 * isReservedPath("sitemap-posts-2.xml"); // true
 * isReservedPath("ja/hello", ["ja"]); // true
 * isReservedPath("ja/hello"); // false — no language configured
 */
export function isReservedPath(
  path: string,
  languagePrefixes: readonly string[] = [],
): boolean {
  const firstSegment = path.split("/")[0]?.toLowerCase();
  if (!firstSegment) return false;
  // A slug starts with a letter or digit, so a first segment that starts with
  // `_` or `.` can only be Jant's: new system addresses go there (`/_assets`,
  // `/__sso`, `/.well-known/`) and never take an address the author has.
  if (/^[_.]/.test(firstSegment)) return true;
  if (RESERVED_PATHS.includes(firstSegment as ReservedPath)) return true;
  if (RESERVED_SITEMAP_PATTERN.test(firstSegment)) return true;
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
 * Onboarding status values.
 *
 * `provisioned` is the hosted middle state: a control plane created the site
 * and its owner, so the site is real and servable, but nobody has yet answered
 * the questions only a person can answer — the language they write in. It is
 * deliberately distinct from `pending`, which means the site has no owner at
 * all and nothing but setup should be reachable.
 */
export const ONBOARDING_STATUS = {
  PENDING: "pending",
  PROVISIONED: "provisioned",
  COMPLETED: "completed",
} as const;

export type OnboardingStatus =
  (typeof ONBOARDING_STATUS)[keyof typeof ONBOARDING_STATUS];
