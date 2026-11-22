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
import {
  buildSurfaceAlternates,
  toViewPath,
  viewBasePath,
} from "../../lib/view-language.js";
import { toAbsoluteSiteUrl } from "../../lib/url.js";
import {
  markdownResponse,
  renderThreadListMarkdown,
  wantsMarkdown,
} from "../../lib/markdown-page.js";
import { defaultFeedRenderer } from "../../lib/feed.js";
import { feedsPublished, renderFeed } from "../../lib/feed-policy.js";
import { buildFeedData } from "../feed/feed.js";
import { FeaturedPage } from "../../ui/pages/FeaturedPage.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const featuredRoutes = new Hono<Env>();

/**
 * Render the featured timeline for the current view language.
 *
 * @param c - Hono context
 * @returns Featured page response
 */
export async function renderFeaturedPage(
  c: Context<Env>,
  options: { forceMarkdown?: boolean } = {},
): Promise<Response> {
  c.set("viewTarget", { kind: "path" });
  // The chrome and the timeline are independent, so they load together. The
  // timeline only ever wanted `navData.isAuthenticated`, which is
  // `c.var.isAuthenticated` verbatim.
  const navDataPromise = getNavigationData(c);
  const i18n = getI18n(c);

  const page = parsePageNumber(c.req.query("page"));
  const featuredTitle = i18n._(
    msg({
      message: "Featured",
      comment: "@context: Browser page title for the featured feed",
    }),
  );
  const paginatedPageTitle = formatPageLabel(page);
  const [navData, { items, currentPage, totalPages }] = await Promise.all([
    navDataPromise,
    assembleFeaturedTimeline(c, {
      page,
      isAuthenticated: c.var.isAuthenticated,
    }),
  ]);

  const markdownHref = toViewPath(c, "/featured.md");
  if (options.forceMarkdown || wantsMarkdown(c)) {
    const { siteUrl, sitePathPrefix, publicApiEnabled } = c.var.appConfig;
    const pageUrl = toAbsoluteSiteUrl(
      `${viewBasePath(c)}/featured`,
      siteUrl,
      sitePathPrefix,
    );
    const markdownUrl = toAbsoluteSiteUrl(
      `${viewBasePath(c)}/featured.md`,
      siteUrl,
      sitePathPrefix,
    );
    const md = renderThreadListMarkdown({
      title: buildPageTitle(featuredTitle, navData.siteName),
      pageUrl,
      markdownUrl,
      siteName: navData.siteName,
      siteDescription: navData.siteDescription || undefined,
      siteUrl,
      sitePathPrefix,
      publicApiEnabled,
      language: c.var.viewLang ?? c.var.appConfig.siteLanguage,
      items,
      currentPage,
      totalPages,
      nextPageUrl:
        currentPage < totalPages
          ? `${markdownUrl}?page=${currentPage + 1}`
          : undefined,
    });
    return markdownResponse(c, md, { canonicalHref: pageUrl });
  }

  return renderPublicPage(c, {
    page: "featured",
    title:
      page > 1
        ? buildPageTitle(featuredTitle, paginatedPageTitle, navData.siteName)
        : buildPageTitle(featuredTitle, navData.siteName),
    alternateLanguages: buildSurfaceAlternates(c),
    markdownHref,
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

featuredRoutes.get("/", (c) => renderFeaturedPage(c));

/**
 * Render the featured Atom feed for the current view language.
 *
 * @param c - Hono context
 * @returns Atom feed response
 */
export async function renderFeaturedFeed(c: Context<Env>): Promise<Response> {
  if (!feedsPublished(c)) return c.notFound();
  const feedData = await buildFeedData(c, {
    kind: "featured",
    selfPath: "/featured/feed",
  });
  return renderFeed(defaultFeedRenderer(feedData));
}

/** Legacy atom.xml suffix → canonical /featured/feed, inside the same view. */
export function redirectLegacyFeaturedFeed(
  c: Context<Env>,
): Response | Promise<Response> {
  if (!feedsPublished(c)) return c.notFound();
  return c.redirect(toViewPath(c, "/featured/feed"), 308);
}

// Atom — /featured/feed (canonical featured feed)
featuredRoutes.get("/feed", renderFeaturedFeed);
featuredRoutes.get("/feed/atom.xml", redirectLegacyFeaturedFeed);
