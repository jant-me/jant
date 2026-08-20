/**
 * Collections Listing Page Route
 *
 * Lists all collections with their Thread counts.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { requireAuth } from "../../middleware/auth.js";
import { getCollectionsDirectoryPath } from "../../lib/collection-paths.js";
import { getNavigationData } from "../../lib/navigation.js";
import { buildPageTitle } from "../../lib/page-title.js";
import { renderPublicPage } from "../../lib/render.js";
import { toPublicPath } from "../../lib/url.js";
import {
  buildSurfaceAlternates,
  getViewLang,
} from "../../lib/view-language.js";
import { CollectionEditorPage } from "../../ui/pages/CollectionEditorPage.js";
import { CollectionsPage } from "../../ui/pages/CollectionsPage.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const collectionsPageRoutes = new Hono<Env>();

function resolveReturnHref(
  value: string | undefined,
  fallback: string,
): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  return value;
}

collectionsPageRoutes.use("/new", requireAuth());

collectionsPageRoutes.get("/new", async (c) => {
  const navData = await getNavigationData(c);
  const defaultReturnHref = toPublicPath(
    getCollectionsDirectoryPath(),
    navData.sitePathPrefix,
  );
  const cancelHref = resolveReturnHref(
    c.req.query("returnTo"),
    defaultReturnHref,
  );

  return renderPublicPage(c, {
    title: buildPageTitle("New Collection", navData.siteName),
    navData,
    content: (
      <CollectionEditorPage
        mode="create"
        cancelHref={cancelHref}
        sitePathPrefix={navData.sitePathPrefix}
      />
    ),
  });
});

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
  const navData = await getNavigationData(c);
  // The numbers have to match the collection pages these rows link to, so they
  // carry this reader's visibility and this view's language.
  const directoryData = await c.var.services.collections.listDirectoryData({
    isAuthenticated: navData.isAuthenticated,
    lang: getViewLang(c) ?? undefined,
  });

  return renderPublicPage(c, {
    title: buildPageTitle("Collections", navData.siteName),
    alternateLanguages: buildSurfaceAlternates(c),
    navData,
    content: (
      <CollectionsPage
        items={directoryData.items}
        isAuthenticated={navData.isAuthenticated ?? false}
        navigationCollectionIds={navData.links.flatMap((item) =>
          item.type === "collection" && item.collectionId
            ? [item.collectionId]
            : [],
        )}
        sitePathPrefix={navData.sitePathPrefix}
        basePath={navData.basePath}
        siteOrigin={c.var.appConfig.siteOrigin}
      />
    ),
  });
}

collectionsPageRoutes.get("/", renderCollectionsDirectory);
