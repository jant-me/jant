/**
 * Featured Page Route
 *
 * Shows featured posts as a timeline feed.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { msg } from "@lingui/core/macro";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { getI18n } from "../../i18n/index.js";
import { getNavigationData } from "../../lib/navigation.js";
import { formatPageLabel, parsePageNumber } from "../../lib/pagination.js";
import { buildPageTitle } from "../../lib/page-title.js";
import { renderPublicPage } from "../../lib/render.js";
import { assembleFeaturedTimeline } from "../../lib/timeline.js";
import { buildSurfaceAlternates, toViewPath } from "../../lib/view-language.js";
import { defaultFeedRenderer } from "../../lib/feed.js";
import { buildFeedData, renderFeed } from "../feed/feed.js";
import { FeaturedPage } from "../../ui/pages/FeaturedPage.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const featuredRoutes = new Hono<Env>();

/**
 * Render the featured timeline for the current view language.
 *
 * @param c - Hono context
 * @returns Featured page response
 */
export async function renderFeaturedPage(c: Context<Env>): Promise<Response> {
  const navData = await getNavigationData(c);
  const i18n = getI18n(c);

  const page = parsePageNumber(c.req.query("page"));
  const featuredTitle = i18n._(
    msg({
      message: "Featured",
      comment: "@context: Browser page title for the featured feed",
    }),
  );
  const paginatedPageTitle = formatPageLabel(page);
  const { items, currentPage, totalPages } = await assembleFeaturedTimeline(c, {
    page,
    isAuthenticated: navData.isAuthenticated,
  });

  return renderPublicPage(c, {
    title:
      page > 1
        ? buildPageTitle(featuredTitle, paginatedPageTitle, navData.siteName)
        : buildPageTitle(featuredTitle, navData.siteName),
    alternateLanguages: buildSurfaceAlternates(c),
    navData,
    content: (
      <FeaturedPage
        items={items}
        currentPage={currentPage}
        totalPages={totalPages}
        baseUrl={toViewPath(c, "/featured")}
      />
    ),
  });
}

featuredRoutes.get("/", renderFeaturedPage);

/**
 * Render the featured Atom feed for the current view language.
 *
 * @param c - Hono context
 * @returns Atom feed response
 */
export async function renderFeaturedFeed(c: Context<Env>): Promise<Response> {
  const feedData = await buildFeedData(c, {
    kind: "featured",
    selfPath: "/featured/feed",
  });
  return renderFeed(defaultFeedRenderer(feedData));
}

/** Legacy atom.xml suffix → canonical /featured/feed, inside the same view. */
export function redirectLegacyFeaturedFeed(c: Context<Env>): Response {
  return c.redirect(toViewPath(c, "/featured/feed"), 308);
}

// Atom — /featured/feed (canonical featured feed)
featuredRoutes.get("/feed", renderFeaturedFeed);
featuredRoutes.get("/feed/atom.xml", redirectLegacyFeaturedFeed);
