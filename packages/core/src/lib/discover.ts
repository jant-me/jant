/**
 * Jant Discover
 *
 * Discover is a public directory of Jant blogs: a crawler polls the Atom
 * feeds of sites that opt in and shows one recent post per blog at a time.
 * Core owns the protocol, not the directory — this module holds the site
 * setting's effective-mode rules and the identifiers the feed declaration is
 * built from. The behaviour of the directory itself is documented at
 * `/docs/discover`.
 */

/**
 * XML namespace for Jant's own feed extensions.
 *
 * A permanent identifier, not an environment-dependent URL: a feed served
 * from any host declares this exact URI, the same policy published markdown
 * links follow. Feed readers ignore elements in namespaces they do not know,
 * so subscribers see nothing.
 */
export const DISCOVER_NAMESPACE_URI = "https://jant.me/ns";

/** Stored value of the `DISCOVER` site setting. */
export type DiscoverSetting = "latest" | "featured" | "off";

/**
 * Effective Discover mode, as declared in the feed.
 *
 * `none` rather than `off` because it is what a crawler reads, and the
 * element's absence already means "this site predates Discover" — the two
 * states are different and must stay tellable apart.
 */
export type DiscoverMode = "latest" | "featured" | "none";

const DISCOVER_SETTINGS: readonly DiscoverSetting[] = [
  "latest",
  "featured",
  "off",
];

/**
 * Parse a stored or environment-supplied Discover setting.
 *
 * @param raw - Raw setting value, from the DB or an environment binding
 * @returns The setting, or `null` when absent or unrecognized
 * @example
 * ```ts
 * parseDiscoverSetting("featured"); // "featured"
 * parseDiscoverSetting("yes"); // null
 * ```
 */
export function parseDiscoverSetting(
  raw: string | undefined | null,
): DiscoverSetting | null {
  const value = raw?.trim();
  if (!value) return null;
  return DISCOVER_SETTINGS.includes(value as DiscoverSetting)
    ? (value as DiscoverSetting)
    : null;
}

/**
 * Derive the effective Discover mode from the site's configuration.
 *
 * The rules, in the order they are applied:
 *
 * 1. A demo site is never listed. Demos exist to be thrown away, and the
 *    same lock already applies to search indexing.
 * 2. A site with feeds turned off has nothing to poll — every feed path
 *    404s — so it cannot honestly declare that it is listed.
 * 3. An explicit choice wins over anything derived. Someone who ticked the
 *    box meant it.
 * 4. Without an explicit choice, `noindex` implies `none`: hiding from
 *    search engines and being surfaced by a directory contradict each other,
 *    and the quieter reading is the safe one.
 * 5. Otherwise `latest` — Discover is opt-out for ordinary sites.
 *
 * @param input - Resolved site configuration relevant to Discover
 * @returns The mode this site's feeds should declare
 * @example
 * ```ts
 * resolveDiscoverMode({
 *   explicitValue: null, demoMode: false, noindex: true, rssFeedsEnabled: true,
 * }); // "none" — hidden from search engines, never explicitly enrolled
 * ```
 */
export function resolveDiscoverMode(input: {
  /** Explicitly stored setting, from the DB or an environment binding. */
  explicitValue: string | undefined | null;
  demoMode: boolean;
  /** Effective `noindex`, as resolved onto `AppConfig`. */
  noindex: boolean;
  rssFeedsEnabled: boolean;
}): DiscoverMode {
  if (input.demoMode) return "none";
  if (!input.rssFeedsEnabled) return "none";

  const explicit = parseDiscoverSetting(input.explicitValue);
  if (explicit) return explicit === "off" ? "none" : explicit;

  return input.noindex ? "none" : "latest";
}

/**
 * Site-relative path of the feed a Discover crawler should poll.
 *
 * The declaration names the feed to poll rather than leaving a crawler to
 * guess, so a site that lists only its featured posts is polled at
 * `/featured/feed` and never at `/latest/feed`.
 *
 * @param mode - Effective Discover mode
 * @returns Site-relative feed path, or `null` when the site is not listed
 * @example
 * ```ts
 * getDiscoverFeedPath("featured"); // "/featured/feed"
 * getDiscoverFeedPath("none"); // null
 * ```
 */
export function getDiscoverFeedPath(mode: DiscoverMode): string | null {
  switch (mode) {
    case "latest":
      return "/latest/feed";
    case "featured":
      return "/featured/feed";
    case "none":
      return null;
  }
}

/** Longest a directory waits before reading a newly announced feed. */
export const DISCOVER_FIRST_READ_MAX_HOURS = 6;

/**
 * The directory's manual submission form, derived from its ping endpoint.
 *
 * Never hardcoded: a site announcing to a directory of its own must not be
 * sent to somebody else's form. Both paths are part of the same directory, so
 * its ping URL is enough to find the other.
 *
 * @param pingUrl - The configured `DISCOVER_PING_URL`
 * @returns Absolute URL of the form, or `null` when there is no directory
 * @example
 * ```ts
 * getDiscoverSubmitUrl("https://jant.me/api/discover/ping");
 * // "https://jant.me/discover/submit"
 * ```
 */
export function getDiscoverSubmitUrl(
  pingUrl: string | undefined | null,
): string | null {
  if (!pingUrl) return null;
  try {
    return new URL("/discover/submit", pingUrl).toString();
  } catch {
    return null;
  }
}
