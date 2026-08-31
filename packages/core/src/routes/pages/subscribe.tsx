/**
 * Subscribe Page Route
 *
 * `/subscribe` — how to follow this site, for a reader who does not already
 * know. The nav's feed entry points here rather than at `/feed`, which hands a
 * browser a screen of Atom XML.
 *
 * Three feeds, always, on every site: the main feed, the opposite end of the
 * same list, and the complete record. Nothing here is conditioned on what the
 * site happens to contain — every Jant site's subscribe page looks the same, so
 * the page needs no service calls and no database round-trip at all.
 *
 * Collection feeds are deliberately absent. Wanting one collection and not the
 * rest is a rare intent on a single-author site, and it already has a better
 * home: the feed icon on the collection you are reading. Listing them here
 * would tax every reader's attention for a few readers' benefit. The full route
 * table lives in `docs/feeds.md`.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { msg } from "@lingui/core/macro";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { getI18n } from "../../i18n/index.js";
import { getNavigationData } from "../../lib/navigation.js";
import { buildPageTitle } from "../../lib/page-title.js";
import { renderPublicPage } from "../../lib/render.js";
import { toAbsoluteSiteUrl, toPublicPath } from "../../lib/url.js";
import {
  buildSurfaceAlternates,
  viewBasePath,
} from "../../lib/view-language.js";
import { SubscribePage } from "../../ui/pages/SubscribePage.js";
import type { SubscribeFeed } from "../../ui/pages/SubscribePage.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const subscribeRoutes = new Hono<Env>();

/**
 * Render the subscribe page for the current view language.
 *
 * @param c - Hono context
 * @returns The page, or 404 when feeds are switched off site-wide
 */
export async function renderSubscribePage(c: Context<Env>): Promise<Response> {
  const { appConfig } = c.var;

  // With feeds off there is nothing to subscribe to, and the nav entry is
  // filtered out too — so the page 404s rather than listing dead addresses.
  if (!appConfig.rssFeedsEnabled) return c.notFound();

  const navData = await getNavigationData(c);
  const i18n = getI18n(c);

  // Readers paste these into a reader, so they have to be whole addresses, and
  // they have to stay inside the language view they were read from.
  const siteUrl =
    appConfig.siteUrl ||
    new URL(toPublicPath("/", appConfig.sitePathPrefix), c.req.url).toString();
  const feedUrl = (path: string): string =>
    toAbsoluteSiteUrl(
      `${viewBasePath(c)}${path}`,
      siteUrl,
      appConfig.sitePathPrefix,
    );

  // The page each feed is the feed of. Relative, unlike the addresses: these
  // are links to follow here and now, not strings to paste elsewhere.
  const pageUrl = (path: string): string =>
    toPublicPath(`${viewBasePath(c)}${path}`, appConfig.sitePathPrefix);

  const latestLabel = i18n._(
    msg({
      message: "Latest",
      comment: "@context: Subscribe page name for the latest public posts feed",
    }),
  );
  const latestDescription = i18n._(
    msg({
      message: "The same posts as the home page.",
      comment:
        "@context: Subscribe page description of the latest posts feed. The home page and this feed run the same query, so they carry the same posts.",
    }),
  );
  // `/latest` redirects to `/` — the home page is the canonical latest
  // timeline, and its query is the one this feed runs.
  const latestPageUrl = pageUrl("/");
  const featuredLabel = i18n._(
    msg({
      message: "Featured",
      comment: "@context: Subscribe page name for the featured posts feed",
    }),
  );
  const featuredDescription = i18n._(
    msg({
      message: "Only the posts marked as featured.",
      comment:
        "@context: Subscribe page description of the featured posts feed",
    }),
  );
  const featuredPageUrl = pageUrl("/featured");

  const mainIsLatest = appConfig.mainRssFeed === "latest";

  const mainFeed: SubscribeFeed = {
    label: i18n._(
      msg({
        message: "Main feed",
        comment: "@context: Subscribe page name for the site's main feed",
      }),
    ),
    url: feedUrl("/feed"),
    // Named for what it currently carries. `/feed` is either end of the list
    // depending on the site's setting, and "main feed" alone says neither.
    // The description and the page it links to are the same pair the row
    // below uses for that feed, so the two rows can never disagree.
    description: mainIsLatest ? latestDescription : featuredDescription,
    pageUrl: mainIsLatest ? latestPageUrl : featuredPageUrl,
  };

  // The other end of the same list. Offering `/latest/feed` beside a `/feed`
  // that already returns the latest posts would be two names for one feed —
  // exactly the confusion this page exists to end. The stable aliases are an
  // author's concern and stay in General settings and the docs.
  const otherEnd: SubscribeFeed = mainIsLatest
    ? {
        label: featuredLabel,
        url: feedUrl("/featured/feed"),
        description: featuredDescription,
        pageUrl: featuredPageUrl,
      }
    : {
        label: latestLabel,
        url: feedUrl("/latest/feed"),
        description: latestDescription,
        pageUrl: latestPageUrl,
      };

  const archiveFeed: SubscribeFeed = {
    label: i18n._(
      msg({
        message: "All",
        comment:
          "@context: Subscribe page name for the full archive feed. Matches the Archive page's own nav label.",
      }),
    ),
    url: feedUrl("/archive/feed"),
    // Says what it adds over the others rather than sounding like the default
    // choice, so a reader who wants everything recognizes it and a reader who
    // wants the main line knows to skip it.
    description: i18n._(
      msg({
        message:
          "Every published post, including those kept off the home page.",
        comment:
          "@context: Subscribe page description of the full archive feed. Says what it adds over the other two rather than sounding like the default pick.",
      }),
    ),
    pageUrl: pageUrl("/archive"),
  };

  return renderPublicPage(c, {
    title: buildPageTitle(
      i18n._(
        msg({
          message: "Subscribe",
          comment: "@context: Browser page title for the subscribe page",
        }),
      ),
      navData.siteName,
    ),
    alternateLanguages: buildSurfaceAlternates(c),
    navData,
    content: (
      <SubscribePage mainFeed={mainFeed} otherFeeds={[otherEnd, archiveFeed]} />
    ),
  });
}

subscribeRoutes.get("/", renderSubscribePage);
