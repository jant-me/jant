import type { Context } from "hono";
import type { Bindings, FeedData, Post } from "../types.js";
import type { AppVariables } from "../types/app-context.js";
import type { PostFilters, ThreadRootPageOptions } from "../services/post.js";
import { DISCOVER_STATUS_PATH, getDiscoverFeedPath } from "./discover.js";
import { strongETag } from "./http-cache.js";
import { now, toISOString } from "./time.js";
import { toAbsoluteSiteUrl } from "./url.js";
import {
  buildSurfaceAlternates,
  getViewLang,
  viewBasePath,
} from "./view-language.js";

type FeedContext = Context<{ Bindings: Bindings; Variables: AppVariables }>;

/** Cache policy for dynamic Atom feed responses. */
const RSS_FEED_CACHE_CONTROL = "public, max-age=60";

/** Media type every Jant Atom feed is served as. */
const FEED_CONTENT_TYPE = "application/atom+xml; charset=utf-8";

/**
 * Serve a rendered Atom document.
 *
 * Every feed on the site goes through here, so the cache policy and the
 * validator are decided once rather than per route. The tag is derived from
 * the rendered bytes, which is what lets it cover everything a feed varies by
 * — the posts, the site name, the language view, the `jant:discover`
 * declaration — without enumerating those inputs.
 *
 * Emitting the validator is all this does with it. Answering a conditional
 * request is `withConditionalResponse`'s job at the edge of the app, outside
 * the Worker response cache, so that a poll is answered from a cache hit and
 * a cache miss alike — and so that a miss still stores the full document
 * instead of a `304` nobody can serve to the next reader.
 *
 * @param xml - Serialized Atom document
 * @returns The feed response, carrying its entity tag
 * @example
 * ```ts
 * return renderFeed(defaultFeedRenderer(feedData));
 * ```
 */
export async function renderFeed(xml: string): Promise<Response> {
  return new Response(xml, {
    headers: {
      "Content-Type": FEED_CONTENT_TYPE,
      "Cache-Control": RSS_FEED_CACHE_CONTROL,
      ETag: await strongETag(xml),
    },
  });
}

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
 * The most entries one feed response carries, whatever `?limit=` asks for.
 *
 * The parameter exists for a consumer reading a site for the first time — a
 * directory that wants a blog's history, not its last fifty posts — and this
 * bounds what any anonymous request can make the site render in one go.
 */
export const FEED_LIMIT_MAX = 500;

/**
 * Read a feed's `?limit=` value.
 *
 * A positive integer is honoured up to {@link FEED_LIMIT_MAX}; asking for more
 * gets the most there is. Anything else — missing, zero, negative, not a whole
 * number — leaves the site's own length in place, the same leniency `?format=`
 * gets: a feed reader gains nothing from an error page.
 *
 * @param raw - The query value as sent, if any
 * @param siteLimit - The site's `RSS_FEED_LIMIT`
 * @returns How many entries to render
 * @example
 * ```ts
 * parseFeedLimit("200", 50); // 200
 * parseFeedLimit("9000", 50); // 500
 * parseFeedLimit("abc", 50); // 50
 * ```
 */
export function parseFeedLimit(
  raw: string | undefined,
  siteLimit: number,
): number {
  if (raw === undefined || !/^\d+$/.test(raw)) return siteLimit;
  const requested = Number(raw);
  if (requested === 0) return siteLimit;
  return Math.min(requested, FEED_LIMIT_MAX);
}

/**
 * How many entries the feed being served carries.
 *
 * Every feed on the site reads its length here. `?limit=` changes how much of
 * a feed one response holds, not which feed it is, so nothing else reads it:
 * `rel="self"`, the language alternates and the Discover declaration all keep
 * naming the address without it.
 *
 * @param c - Request context
 * @returns The entry count to query for
 * @example
 * ```ts
 * posts.list({ ...filters, limit: getFeedLimit(c) });
 * ```
 */
export function getFeedLimit(c: FeedContext): number {
  return parseFeedLimit(c.req.query("limit"), c.var.appConfig.rssFeedLimit);
}

/**
 * The posts `/latest/feed` chooses from, before its length and its order.
 *
 * Written once because two places must agree on it: the feed itself, and the
 * Discover status endpoint, which tells a directory whether a post it holds
 * is still in this feed. A second copy of the rule is a directory told a post
 * is gone while the feed still carries it.
 *
 * @param input - The language view, if any, and the RSS delay's cutoff
 * @returns Filters for `posts.list`
 * @example
 * ```ts
 * posts.list({ ...latestFeedSelection({ lang, publishedBefore }), limit });
 * ```
 */
export function latestFeedSelection(input: {
  lang?: string;
  publishedBefore: number;
}) {
  return {
    status: "published",
    excludeReplies: true,
    excludeLatestHidden: true,
    excludePrivate: true,
    lang: input.lang,
    publishedBefore: input.publishedBefore,
  } satisfies PostFilters;
}

/**
 * The Threads `/featured/feed` chooses from: any with a featured post past
 * the RSS delay. See {@link latestFeedSelection} for why it is written once.
 *
 * @param input - The language view, if any, and the RSS delay's cutoff
 * @returns Options for `posts.listFeaturedThreadRootIds`
 * @example
 * ```ts
 * posts.listFeaturedThreadRootIds({
 *   ...featuredFeedSelection({ lang, publishedBefore }),
 *   limit,
 * });
 * ```
 */
export function featuredFeedSelection(input: {
  lang?: string;
  publishedBefore: number;
}) {
  return {
    status: "published",
    excludePrivate: true,
    lang: input.lang,
    publishedBefore: input.publishedBefore,
  } satisfies ThreadRootPageOptions;
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
 * Discover, with which feeds to poll and where to ask about posts it holds,
 * and where that site's other languages publish. Both are per-view, so they
 * are resolved from the request rather than from `AppConfig` alone, and both
 * are spread into every `FeedData` the site builds.
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
): Pick<
  FeedData,
  | "discover"
  | "discoverFeedUrl"
  | "discoverFeaturedFeedUrl"
  | "discoverStatusUrl"
  | "languageAlternates"
> {
  const { appConfig } = c.var;
  const absoluteFeedUrl = (feedPath: string) =>
    toAbsoluteSiteUrl(
      `${viewBasePath(c)}${feedPath}`,
      appConfig.siteUrl,
      appConfig.sitePathPrefix,
    );
  const feedPath = getDiscoverFeedPath(appConfig.discover);
  const discoverFeedUrl = feedPath ? absoluteFeedUrl(feedPath) : null;
  // Only beside `latest`: under `featured` the `feed` attribute already is the
  // featured feed, and there is nothing wider to name.
  const discoverFeaturedFeedUrl =
    appConfig.discover === "latest"
      ? absoluteFeedUrl(getDiscoverFeedPath("featured") ?? "/featured/feed")
      : null;
  // The API lives outside language views, so the view travels as `lang`: the
  // answer must be about the feeds this declaration sits in.
  const viewLang = getViewLang(c);
  const discoverStatusUrl = feedPath
    ? toAbsoluteSiteUrl(
        viewLang
          ? `${DISCOVER_STATUS_PATH}?lang=${encodeURIComponent(viewLang)}`
          : DISCOVER_STATUS_PATH,
        appConfig.siteUrl,
        appConfig.sitePathPrefix,
      )
    : null;

  return {
    discover: appConfig.discover,
    discoverFeedUrl,
    discoverFeaturedFeedUrl,
    discoverStatusUrl,
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
