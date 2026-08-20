/**
 * Navigation Helper
 *
 * Provides shared data fetching for public page navigation.
 */

import type { Context } from "hono";
import type { Collection, NavItem, NavItemView } from "../types.js";
import { toNavItemViews } from "./view.js";
import { languageScopeBasePath, viewBasePath } from "./view-language.js";
import { render as renderMarkdown, toPlainText } from "./markdown.js";

/**
 * Navigation data needed by public page rendering
 */
export interface NavigationData {
  links: NavItemView[];
  currentPath: string;
  /** Deployment path prefix, such as `/blog`. */
  sitePathPrefix: string;
  /**
   * Public path prefix for reader-facing surfaces. Equals `sitePathPrefix`
   * outside a language view, and carries the language prefix inside one
   * (`/blog/en`). Pass this — not `sitePathPrefix` — to anything building
   * links to the home page, archive, search, feeds or collections.
   */
  basePath: string;
  siteName: string;
  /** Plain-text description for meta tags and RSS/Atom feeds */
  siteDescription: string;
  /** HTML-rendered description for homepage display */
  siteDescriptionHtml?: string;
  isAuthenticated: boolean;
  collections: Collection[];
  siteAvatarUrl?: string;
  showHeaderAvatar?: boolean;
  siteFooterHtml?: string;
}

/**
 * Collect the collections and smart collections already placed in navigation.
 *
 * The directory offers both kinds the same "Add to Navigation" action, so it
 * needs one list to check against; TypeID prefixes (`col_`, `smc_`) keep the
 * two apart without a second field.
 *
 * @param links - Navigation items as rendered for this request
 * @returns TypeIDs of every collection and smart collection in navigation
 * @example
 * const placed = collectNavigationCollectionIds(navData.links);
 * // ["col_01abc", "smc_01xyz"]
 */
export function collectNavigationCollectionIds(links: NavItemView[]): string[] {
  return links.flatMap((item) => {
    if (item.type === "collection" && item.collectionId) {
      return [item.collectionId];
    }
    if (item.type === "smart_collection" && item.smartCollectionId) {
      return [item.smartCollectionId];
    }
    return [];
  });
}

/**
 * Fetch navigation data for public pages.
 *
 * Returns NavItemView[] with pre-computed isActive/isExternal state.
 * Also checks authentication status and loads collections for authenticated users.
 *
 * @param c - Hono context
 * @returns Navigation data for SiteLayout
 *
 * @example
 * ```typescript
 * const navData = await getNavigationData(c);
 * return renderPublicPage(c, {
 *   title: "My Page",
 *   navData,
 *   content: <MyContent />,
 * });
 * ```
 */
export async function getNavigationData(
  c: Context,
  options?: {
    preloadedItems?: NavItem[];
    includeCollections?: boolean;
    /**
     * Content language whose view the page's chrome should live in. Post
     * pages pass their post's language here: their URLs carry no language
     * prefix, so `viewLang` is never set on them, yet a Japanese post's
     * logo and nav should lead to `/ja`, not to the primary view.
     */
    languageScope?: string | null;
  },
): Promise<NavigationData> {
  const appConfig = c.var.appConfig;
  const langBase =
    options?.languageScope !== undefined
      ? languageScopeBasePath(c, options.languageScope)
      : viewBasePath(c);
  // An empty prefix means the primary language's view, whose nav items already
  // point where they should — so the whole primary-language site, multilingual
  // or not, never pays for the translation lookup.
  const scopeLanguage = langBase
    ? (options?.languageScope ?? c.var.viewLang ?? null)
    : null;

  // Callers that already fetched nav items can pass them in to avoid a
  // redundant DB round-trip.
  const savedItems =
    options?.preloadedItems ??
    (await c.var.services.navItems.list({ language: scopeLanguage }));
  const currentPath = c.var.publicPath;
  // Keep the saved RSS item untouched so its placement and custom label come
  // back when feeds are re-enabled. Only the rendered projection is filtered.
  const items = appConfig.rssFeedsEnabled
    ? savedItems
    : savedItems.filter(
        (item: NavItem) => item.type !== "system" || item.systemKey !== "rss",
      );

  const siteName = appConfig.siteName;
  const siteFooter = appConfig.siteFooter;

  // Only include description if explicitly set (DB or env), not the default
  const rawDescription = appConfig.siteDescriptionExplicit
    ? appConfig.siteDescription
    : "";
  // Plain text for meta tags / RSS; HTML for homepage display
  const siteDescription = rawDescription ? toPlainText(rawDescription) : "";
  const siteDescriptionHtml = rawDescription
    ? renderMarkdown(rawDescription, {
        namespace: `${c.var.currentSite.id}-description`,
      })
    : undefined;

  // Avatar URL and display flag come from appConfig
  const siteAvatarUrl = appConfig.siteAvatarUrl || undefined;
  const showHeaderAvatar = appConfig.showHeaderAvatar;

  // Render footer markdown
  const siteFooterHtml = siteFooter
    ? renderMarkdown(siteFooter, {
        namespace: `${c.var.currentSite.id}-footer`,
      })
    : undefined;

  // Auth state is populated once per request by `attachSession` middleware.
  const isAuthenticated = c.var.isAuthenticated;
  let collections: Collection[] = [];

  // Compute freshness for collection nav items
  const collectionNavIds: string[] = [];
  for (const item of items) {
    if (item.type === "collection" && item.collectionId) {
      collectionNavIds.push(item.collectionId);
    }
  }
  const collectionFreshness =
    collectionNavIds.length > 0
      ? await c.var.services.navItems.getCollectionFreshness(collectionNavIds)
      : undefined;

  const basePath = `${appConfig.sitePathPrefix}${langBase}`;

  const links = toNavItemViews(
    items,
    currentPath,
    isAuthenticated,
    appConfig.sitePathPrefix,
    collectionFreshness,
    appConfig.siteOrigin,
    basePath,
  );

  // Only load collections when authenticated (for compose dialog)
  if (isAuthenticated && options?.includeCollections !== false) {
    collections = await c.var.services.collections.listByRecentActivity();
  }

  return {
    links,
    currentPath,
    sitePathPrefix: appConfig.sitePathPrefix,
    basePath,
    siteName,
    siteDescription,
    siteDescriptionHtml,
    isAuthenticated,
    collections,
    siteAvatarUrl,
    showHeaderAvatar: showHeaderAvatar && !!siteAvatarUrl,
    siteFooterHtml,
  };
}
