import type { Context } from "hono";
import type { Bindings, FeedData, Post } from "../types.js";
import type { AppVariables } from "../types/app-context.js";
import { getDiscoverFeedPath } from "./discover.js";
import { now, toISOString } from "./time.js";
import { toAbsoluteSiteUrl } from "./url.js";
import { buildSurfaceAlternates, viewBasePath } from "./view-language.js";

type FeedContext = Context<{ Bindings: Bindings; Variables: AppVariables }>;

/** Cache policy for dynamic Atom feed responses. */
export const RSS_FEED_CACHE_CONTROL = "public, max-age=60";

/**
 * Convert an RSS publication delay into the exclusive upper bound expected by
 * Post service queries.
 *
 * Posts published exactly `delaySeconds` ago are eligible. Because publication
 * timestamps use whole seconds while `publishedBefore` is exclusive, the bound
 * is one second after the latest eligible timestamp.
 *
 * @param delaySeconds - Non-negative publication delay in seconds
 * @param currentTime - Current Unix timestamp, injectable for deterministic use
 * @returns Exclusive `publishedBefore` timestamp for RSS queries
 * @example
 * ```ts
 * getRssPublishedBefore(300, 1_000); // 701, so publishedAt <= 700 is eligible
 * ```
 */
export function getRssPublishedBefore(
  delaySeconds: number,
  currentTime = now(),
): number {
  return currentTime - delaySeconds + 1;
}

/**
 * Resolve the Atom `updated` timestamp for a Thread entry from content that is
 * actually present in the feed.
 *
 * @param root - Thread root used as a fallback when no Thread rows are loaded
 * @param thread - Eligible Thread Posts included in the Atom entry
 * @param additionalTimestamps - Other entry updates, such as Collection membership
 * @returns Latest update timestamp as an ISO 8601 string
 * @example
 * ```ts
 * getFeedEntryUpdatedAt(root, [root, reply], [collectedAt]);
 * ```
 */
export function getFeedEntryUpdatedAt(
  root: Pick<Post, "publishedAt" | "updatedAt">,
  thread: readonly Pick<Post, "publishedAt" | "updatedAt">[] | undefined,
  additionalTimestamps: readonly (number | null | undefined)[] = [],
): string {
  let updatedAt = Math.max(root.updatedAt, root.publishedAt ?? root.updatedAt);

  for (const post of thread ?? []) {
    updatedAt = Math.max(
      updatedAt,
      post.updatedAt,
      post.publishedAt ?? post.updatedAt,
    );
  }
  for (const timestamp of additionalTimestamps) {
    if (timestamp !== null && timestamp !== undefined) {
      updatedAt = Math.max(updatedAt, timestamp);
    }
  }

  return toISOString(updatedAt);
}

/**
 * Discovery fields every Atom feed header carries.
 *
 * A consumer holding one of a site's feeds — any of them — should be able to
 * learn two things from it: whether the site wants to be listed in Jant
 * Discover and which feed to poll for it, and where that site's other
 * languages publish. Both are per-view, so they are resolved from the request
 * rather than from `AppConfig` alone, and both are spread into every
 * `FeedData` the site builds.
 *
 * @param c - Request context
 * @param options - `query` is the canonical query string this feed's siblings
 *   share, leading `?` included; a filtered feed must pass its own so the
 *   alternates point at the same filter rather than the unfiltered feed
 * @returns The Discover and language-alternate half of a `FeedData`
 * @example
 * ```ts
 * defaultFeedRenderer({ ...buildFeedDiscoveryFields(c), siteName, posts, … });
 * ```
 */
export function buildFeedDiscoveryFields(
  c: FeedContext,
  options?: { query?: string },
): Pick<FeedData, "discover" | "discoverFeedUrl" | "languageAlternates"> {
  const { appConfig } = c.var;
  const feedPath = getDiscoverFeedPath(appConfig.discover);
  const discoverFeedUrl = feedPath
    ? toAbsoluteSiteUrl(
        `${viewBasePath(c)}${feedPath}`,
        appConfig.siteUrl,
        appConfig.sitePathPrefix,
      )
    : null;

  return {
    discover: appConfig.discover,
    discoverFeedUrl,
    // Alternates follow the feed's canonical URL, not the request's, so a feed
    // reached with tracking params still points its siblings at the canonical
    // form. `x-default` is defined for web pages a search engine ranks; it
    // means nothing to a feed reader, so it is left off.
    languageAlternates: buildSurfaceAlternates(c, {
      query: options?.query ?? "",
      xDefault: false,
    }),
  };
}
