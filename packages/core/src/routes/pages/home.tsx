/**
 * Home Page Route
 *
 * Timeline feed with per-type card components and thread previews.
 * Uses page-based pagination.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { msg } from "@lingui/core/macro";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { getNavigationData } from "../../lib/navigation.js";
import { getI18n } from "../../i18n/index.js";
import { formatPageLabel, parsePageNumber } from "../../lib/pagination.js";
import { buildPageTitle } from "../../lib/page-title.js";
import { renderPublicPage } from "../../lib/render.js";
import { assembleTimeline } from "../../lib/timeline.js";
import { toAbsoluteSiteUrl, toPublicPath } from "../../lib/url.js";
import {
  buildSurfaceAlternates,
  toViewPath,
  viewBasePath,
} from "../../lib/view-language.js";
import { buildWebSiteJsonLd } from "../../lib/structured-data.js";
import { HomePage } from "../../ui/pages/HomePage.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const homeRoutes = new Hono<Env>();

/**
 * Render the timeline home page for the current view language.
 *
 * @param c - Hono context
 * @returns Home page response
 */
export async function renderHomePage(c: Context<Env>): Promise<Response> {
  const i18n = getI18n(c);
  const page = parsePageNumber(c.req.query("page"));
  const paginatedPageTitle = formatPageLabel(page);
  const isAuthenticated = c.var.isAuthenticated;

  const timelinePromise = assembleTimeline(c, { page, isAuthenticated });

  const [navData, timeline] = await Promise.all([
    getNavigationData(c),
    timelinePromise,
  ]);

  const { items, currentPage, totalPages } = timeline;

  // WebSite + SearchAction structured data, emitted only on the first page
  // (the canonical site entry point) and only when a site URL is configured
  // so the search-box action resolves to an absolute URL.
  const { siteUrl } = c.var.appConfig;
  const websiteJsonLd =
    page === 1 && siteUrl
      ? buildWebSiteJsonLd({
          name: navData.siteName,
          url: toAbsoluteSiteUrl(
            viewBasePath(c) || "/",
            siteUrl,
            navData.sitePathPrefix,
          ),
          searchUrlTemplate: `${toAbsoluteSiteUrl(
            `${viewBasePath(c)}/search`,
            siteUrl,
            navData.sitePathPrefix,
          )}?q={search_term_string}`,
        })
      : undefined;

  const latestTitle = i18n._(
    msg({
      message: "Latest",
      comment: "@context: Browser page title for the latest feed",
    }),
  );

  return renderPublicPage(c, {
    title:
      page > 1
        ? buildPageTitle(latestTitle, paginatedPageTitle, navData.siteName)
        : navData.siteName,
    jsonLd: websiteJsonLd,
    alternateLanguages: buildSurfaceAlternates(c),
    navData,
    showHomeBranding:
      c.var.appConfig.showJantBrandingOnHome && currentPage === 1,
    content: (
      <HomePage
        items={items}
        baseUrl={toViewPath(c, "/")}
        currentPage={currentPage}
        totalPages={totalPages}
        isAuthenticated={isAuthenticated}
        signinUrl={`${toPublicPath("/signin", navData.sitePathPrefix)}?redirect=${encodeURIComponent(toViewPath(c, "/"))}`}
      />
    ),
  });
}

homeRoutes.get("/", renderHomePage);
