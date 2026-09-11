/**
 * Jant Discover
 *
 * Discover is a public directory of Jant blogs: a crawler polls the Atom
 * feeds of sites that opt in and lists their posts — the ones marked
 * Featured on its home, link and quote posts on lists of their own. Core owns
 * the protocol, not the directory — this module holds the site setting's
 * effective-mode rules and the identifiers the feed declaration is built
 * from. The declaration is specified in `docs/feeds.md`; how a directory
 * behaves is that directory's own business, documented where it lives.
 *
 * `featured` survives as a stored value: older releases offered it as a
 * choice, and a site that made it still declares it, which a directory reads
 * as "only this feed". Nothing writes it any more.
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
 * Site-relative path of the endpoint a directory asks about posts it holds.
 *
 * A feed shows a site's newest posts, so a post missing from it may have been
 * taken out or may only have been pushed past the feed's length — and the
 * permalink cannot settle it either, because a post hidden from Latest or
 * unfeatured is still a live page. This answers the question outright: for
 * each post, whether it is in the Latest feed and whether its Thread is in the
 * featured feed. The declaration names it in its `status` attribute, so a
 * directory never builds the address itself.
 */
export const DISCOVER_STATUS_PATH = "/api/discover/posts";

/** Most post ids one status request may ask about. */
export const DISCOVER_STATUS_MAX_IDS = 50;

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

/**
 * How long the jant.me directory holds a post it has read before showing it.
 *
 * The directory's rule — its `PUBLIC_DELAY_SECONDS` — stated here for the same
 * reason as `DISCOVER_MIN_PUBLIC_POSTS`: the help line under the Discover
 * checkbox tells an author how long they have to edit a post before it shows.
 * A tuning value on the directory's side; this moves with it.
 */
export const DISCOVER_PUBLIC_DELAY_HOURS = 24;

/**
 * The directory's names for its two format lists.
 *
 * Proper names that stay in English in every locale, as the directory's own
 * tabs spell them. They are placeholder values rather than catalog entries: a
 * catalog entry for a word that must not be translated is one a later
 * translation pass can quietly "fix", and the help line links each list by
 * finding this exact run of text.
 */
export const DISCOVER_LIST_NAMES = {
  links: "Links",
  quotes: "Quotes",
} as const;

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

/** The directory's public pages that the Discover help line links to. */
export interface DiscoverPageUrls {
  /** The directory's home: the posts blogs have marked Featured. */
  home: string;
  /** Every link post, under the list name `Links`. */
  links: string;
  /** Every quote post, under the list name `Quotes`. */
  quotes: string;
  /** How blogs are listed: joining, review, and what takes a blog off. */
  rules: string;
}

/**
 * The directory's public pages, derived from its base address.
 *
 * What "Jant Discover" means is best answered by the list itself, so the name
 * links to the home rather than to a page describing it; the rules page is
 * linked separately, for an author asking how their own posts get there.
 * Derived for the same reason as the submission form: a site announcing to a
 * directory of its own must link to that one, not to jant.me. The paths are
 * jant.me's, where the three lists sit flat and the rules sit under
 * `/discover`.
 *
 * @param directoryBaseUrl - The directory this deployment belongs to, from
 *   `getDiscoverDirectoryBaseUrl`
 * @returns Absolute URLs of the pages, or `null` when there is no directory
 * @example
 * ```ts
 * getDiscoverPageUrls("https://jant.me/");
 * // {
 * //   home: "https://jant.me/discover",
 * //   links: "https://jant.me/links",
 * //   quotes: "https://jant.me/quotes",
 * //   rules: "https://jant.me/discover/about",
 * // }
 * ```
 */
export function getDiscoverPageUrls(
  directoryBaseUrl: string | undefined | null,
): DiscoverPageUrls | null {
  if (!directoryBaseUrl) return null;
  try {
    const at = (path: string) => new URL(path, directoryBaseUrl).toString();
    return {
      home: at("/discover"),
      links: at("/links"),
      quotes: at("/quotes"),
      rules: at("/discover/about"),
    };
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

/** One run of a sentence, and where it links when it is a link. */
export interface TextRun {
  text: string;
  href?: string;
}

/**
 * Split a sentence into runs, making each given term a link.
 *
 * The Discover help line reads as one sentence in every locale, so each link is
 * found by searching the translated line for its translated term rather than by
 * gluing fragments together. A term the translation drops or rewrites stays
 * plain text — a sentence short one link, never a broken one. Each term links
 * once, at its first occurrence no other link has claimed; longer terms are
 * placed first, so a term inside another cannot take its place.
 *
 * @param text - The translated sentence
 * @param links - Each run of text to link, and where it goes
 * @returns The whole sentence as consecutive runs, in order
 * @example
 * ```ts
 * linkTerms("See Links and Quotes.", [
 *   { term: "Links", href: "/links" },
 *   { term: "Quotes", href: "/quotes" },
 * ]);
 * // [
 * //   { text: "See " },
 * //   { text: "Links", href: "/links" },
 * //   { text: " and " },
 * //   { text: "Quotes", href: "/quotes" },
 * //   { text: "." },
 * // ]
 * ```
 */
export function linkTerms(
  text: string,
  links: readonly { term: string; href: string }[],
): TextRun[] {
  const claimed: { start: number; end: number; href: string }[] = [];
  const ordered = links
    .filter((link) => link.term && link.href)
    .sort((a, b) => b.term.length - a.term.length);

  for (const { term, href } of ordered) {
    for (
      let start = text.indexOf(term);
      start !== -1;
      start = text.indexOf(term, start + 1)
    ) {
      const end = start + term.length;
      if (claimed.some((run) => start < run.end && run.start < end)) continue;
      claimed.push({ start, end, href });
      break;
    }
  }

  claimed.sort((a, b) => a.start - b.start);
  const runs: TextRun[] = [];
  let at = 0;
  for (const { start, end, href } of claimed) {
    if (start > at) runs.push({ text: text.slice(at, start) });
    runs.push({ text: text.slice(start, end), href });
    at = end;
  }
  if (at < text.length) runs.push({ text: text.slice(at) });
  return runs;
}
