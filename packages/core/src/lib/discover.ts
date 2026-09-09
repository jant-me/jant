/**
 * Jant Discover
 *
 * Discover is a public directory of Jant blogs: a crawler polls the Atom
 * feeds of sites that opt in and shows one recent post per blog at a time.
 * Core owns the protocol, not the directory — this module holds the site
 * setting's effective-mode rules and the identifiers the feed declaration is
 * built from. The declaration is specified in `docs/feeds.md`; how a directory
 * behaves is that directory's own business, documented where it lives.
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
 * 3. The owner's stored choice wins over anything derived, including
 *    `noindex`. Someone who ticked the box meant it.
 * 4. Without a stored choice, `noindex` implies `none`: hiding from search
 *    engines and being surfaced by a directory contradict each other, and the
 *    quieter reading is the safe one.
 * 5. Then the deployment default, from the `DISCOVER` binding. Hosted Jant
 *    sets it, so every blog it serves takes part until its owner says
 *    otherwise. It sits below `noindex` on purpose: a deployment saying
 *    "list my sites" is a default, not the answer of the person who hid this
 *    one from search engines.
 * 6. Otherwise `none`. A site nobody configured has not opted in, and the
 *    declaration is the consent record a directory reads — a site listed on
 *    the strength of a default its owner never chose was never asked.
 *
 * @param input - Resolved site configuration relevant to Discover
 * @returns The mode this site's feeds should declare
 * @example
 * ```ts
 * resolveDiscoverMode({
 *   storedValue: null, defaultValue: null,
 *   demoMode: false, noindex: false, rssFeedsEnabled: true,
 * }); // "none" — self-hosted, never opted in
 * resolveDiscoverMode({
 *   storedValue: null, defaultValue: "latest",
 *   demoMode: false, noindex: false, rssFeedsEnabled: true,
 * }); // "latest" — a deployment that lists its sites by default
 * ```
 */
export function resolveDiscoverMode(input: {
  /** The owner's own choice, stored in this site's settings. */
  storedValue: string | undefined | null;
  /**
   * What this deployment lists by default, from the `DISCOVER` binding.
   *
   * Absent for a self-hosted site, which is what makes Discover opt-in
   * there; hosted Jant sets it so its fleet is listed without every owner
   * having to ask.
   */
  defaultValue?: string | undefined | null;
  demoMode: boolean;
  /** Effective `noindex`, as resolved onto `AppConfig`. */
  noindex: boolean;
  rssFeedsEnabled: boolean;
}): DiscoverMode {
  if (input.demoMode) return "none";
  if (!input.rssFeedsEnabled) return "none";

  const stored = parseDiscoverSetting(input.storedValue);
  if (stored) return stored === "off" ? "none" : stored;

  if (input.noindex) return "none";

  const fallback = parseDiscoverSetting(input.defaultValue);
  if (fallback) return fallback === "off" ? "none" : fallback;

  return "none";
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

/**
 * Public posts a blog needs before the jant.me directory will list it.
 *
 * Not core's rule — the directory's, published on the Discover page — but
 * core states it so a site owner can see where they stand without asking
 * anybody. A directory of your own may decide differently.
 *
 * One post, and no minimum history at all. The directory used to ask for a
 * week of it as well, and dropped that: for a self-hosted blog the age can
 * only be read off the oldest post the feed still carries, which is strict
 * against an honest blog and no obstacle whatsoever to one that backdates.
 * What keeps day-one throwaways out is the opt-in itself.
 */
export const DISCOVER_MIN_PUBLIC_POSTS = 1;

/** Longest a directory waits before reading a newly announced feed. */
export const DISCOVER_FIRST_READ_MAX_HOURS = 6;

/** Where a site stands against the directory's threshold. */
export interface DiscoverMaturity {
  publicPostCount: number;
  /** The threshold is met. */
  established: boolean;
}

/**
 * Measure a site against the directory's threshold.
 *
 * @param input - The site's own public-post evidence
 * @returns The count to show, and whether the threshold is met
 * @example
 * ```ts
 * measureDiscoverMaturity({ publicPostCount: 5 });
 * // { publicPostCount: 5, established: true }
 * ```
 */
export function measureDiscoverMaturity(input: {
  publicPostCount: number;
}): DiscoverMaturity {
  return {
    publicPostCount: input.publicPostCount,
    established: input.publicPostCount >= DISCOVER_MIN_PUBLIC_POSTS,
  };
}

/**
 * The directory itself, derived from its base address.
 *
 * What "Jant Discover" means is best answered by the list itself, so the
 * settings page links here rather than to a page describing it. Derived for
 * the same reason as the submission form: a site announcing to a directory of
 * its own must link to that one, not to jant.me.
 *
 * @param directoryBaseUrl - The directory this deployment belongs to, from
 *   `getDiscoverDirectoryBaseUrl`
 * @returns Absolute URL of the directory, or `null` when there is none
 * @example
 * ```ts
 * getDiscoverDirectoryUrl("https://jant.me/");
 * // "https://jant.me/discover"
 * ```
 */
export function getDiscoverDirectoryUrl(
  directoryBaseUrl: string | undefined | null,
): string | null {
  if (!directoryBaseUrl) return null;
  try {
    return new URL("/discover", directoryBaseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * The directory's manual submission form, derived from its base address.
 *
 * Never hardcoded: a site announcing to a directory of its own must not be
 * sent to somebody else's form. Both paths are part of the same directory, so
 * one address is enough to find the other.
 *
 * @param directoryBaseUrl - The directory this deployment belongs to, from
 *   `getDiscoverDirectoryBaseUrl`
 * @returns Absolute URL of the form, or `null` when there is no directory
 * @example
 * ```ts
 * getDiscoverSubmitUrl("https://jant.me/");
 * // "https://jant.me/discover/submit"
 * ```
 */
export function getDiscoverSubmitUrl(
  directoryBaseUrl: string | undefined | null,
): string | null {
  if (!directoryBaseUrl) return null;
  try {
    return new URL("/discover/submit", directoryBaseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Split a sentence around the run of text that carries the directory link.
 *
 * The Discover help line reads as one sentence in every locale, so the link is
 * found by splitting the translated line on the translated word rather than by
 * gluing fragments together. A translation that drops or rewrites the word
 * simply renders as plain text — a sentence without a link, never a broken one.
 *
 * @param text - The translated sentence
 * @param term - The translated run of text the link belongs on
 * @returns The three parts, or `null` when the term is not in the sentence
 * @example
 * ```ts
 * splitLinkedTerm("A directory of blogs.", "directory");
 * // { before: "A ", term: "directory", after: " of blogs." }
 * ```
 */
export function splitLinkedTerm(
  text: string,
  term: string,
): { before: string; term: string; after: string } | null {
  if (!text || !term) return null;
  const at = text.indexOf(term);
  if (at === -1) return null;
  return {
    before: text.slice(0, at),
    term,
    after: text.slice(at + term.length),
  };
}
