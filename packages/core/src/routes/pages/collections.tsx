/**
 * Collections Listing Page Route
 *
 * Lists all collections with their Thread counts.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import {
  collectNavigationCollectionIds,
  getNavigationData,
} from "../../lib/navigation.js";
import { buildPageTitle } from "../../lib/page-title.js";
import { renderPublicPage } from "../../lib/render.js";
import {
  buildSurfaceAlternates,
  getViewLang,
  toViewPath,
  viewBasePath,
} from "../../lib/view-language.js";
import { toAbsoluteSiteUrl } from "../../lib/url.js";
import {
  markdownResponse,
  renderCollectionsDirectoryMarkdown,
  wantsMarkdown,
} from "../../lib/markdown-page.js";
import { CollectionsPage } from "../../ui/pages/CollectionsPage.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const collectionsPageRoutes = new Hono<Env>();

/**
 * Render the collections directory.
 *
 * The directory itself is site skeleton: every collection is listed in every
 * language view, because a collection that is empty in one language is still
 * part of how the site is organized. Only its links carry the view prefix.
 *
 * @param c - Hono context
 * @returns Collections directory response
 */
export async function renderCollectionsDirectory(
  c: Context<Env>,
  options: { forceMarkdown?: boolean } = {},
): Promise<Response> {
  c.set("viewTarget", { kind: "path" });
  // The numbers have to match the collection pages these rows link to, so they
  // carry this reader's visibility and this view's language. Both come from the
  // request rather than from `navData` — `navData.isAuthenticated` is
  // `c.var.isAuthenticated` verbatim — so the two round trips stay parallel on
  // the widest page under `/collections`.
  const [directoryData, navData] = await Promise.all([
    c.var.services.collections.listDirectoryData({
      isAuthenticated: c.var.isAuthenticated,
      lang: getViewLang(c) ?? undefined,
      timeZone: c.var.appConfig.timeZone,
    }),
    getNavigationData(c),
  ]);

  const markdownHref = toViewPath(c, "/collections.md");
  if (options.forceMarkdown || wantsMarkdown(c)) {
    const { siteUrl, sitePathPrefix, publicApiEnabled } = c.var.appConfig;
    const pageUrl = toAbsoluteSiteUrl(
      `${viewBasePath(c)}/collections`,
      siteUrl,
      sitePathPrefix,
    );
    const md = renderCollectionsDirectoryMarkdown({
      siteName: navData.siteName,
      siteDescription: navData.siteDescription || undefined,
      siteUrl,
      sitePathPrefix,
      pageUrl,
      publicApiEnabled,
      language: getViewLang(c) ?? c.var.appConfig.siteLanguage,
      items: directoryData.items,
    });
    return markdownResponse(c, md, { canonicalHref: pageUrl });
  }

  return renderPublicPage(c, {
    page: "collections",
    title: buildPageTitle("Collections", navData.siteName),
    alternateLanguages: buildSurfaceAlternates(c),
    markdownHref,
    navData,
    content: (
      <CollectionsPage
        items={directoryData.items}
        isAuthenticated={navData.isAuthenticated ?? false}
        navigationCollectionIds={collectNavigationCollectionIds(navData.links)}
        sitePathPrefix={navData.sitePathPrefix}
        basePath={navData.basePath}
        siteOrigin={c.var.appConfig.siteOrigin}
        feedsEnabled={c.var.appConfig.rssFeedsEnabled}
      />
    ),
  });
}

collectionsPageRoutes.get("/", (c) => renderCollectionsDirectory(c));
