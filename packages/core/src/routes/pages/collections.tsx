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
} from "../../lib/view-language.js";
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
): Promise<Response> {
  // The numbers have to match the collection pages these rows link to, so they
  // carry this reader's visibility and this view's language. Both come from the
  // request rather than from `navData` — `navData.isAuthenticated` is
  // `c.var.isAuthenticated` verbatim — so the two round trips stay parallel on
  // the widest page under `/collections`.
  const [directoryData, navData] = await Promise.all([
    c.var.services.collections.listDirectoryData({
      isAuthenticated: c.var.isAuthenticated,
      lang: getViewLang(c) ?? undefined,
    }),
    getNavigationData(c),
  ]);

  return renderPublicPage(c, {
    title: buildPageTitle("Collections", navData.siteName),
    alternateLanguages: buildSurfaceAlternates(c),
    navData,
    content: (
      <CollectionsPage
        items={directoryData.items}
        isAuthenticated={navData.isAuthenticated ?? false}
        navigationCollectionIds={collectNavigationCollectionIds(navData.links)}
        sitePathPrefix={navData.sitePathPrefix}
        basePath={navData.basePath}
        siteOrigin={c.var.appConfig.siteOrigin}
      />
    ),
  });
}

collectionsPageRoutes.get("/", renderCollectionsDirectory);
