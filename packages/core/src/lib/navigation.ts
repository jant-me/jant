/**
 * Navigation Helper
 *
 * Provides shared data fetching for public page navigation.
 */

import type { Context } from "hono";
import type { Collection, NavItem, NavItemView } from "../types.js";
import { toNavItemViews } from "./view.js";
import { render as renderMarkdown, toPlainText } from "./markdown.js";

/**
 * Navigation data needed by public page rendering
 */
export interface NavigationData {
  links: NavItemView[];
  currentPath: string;
  sitePathPrefix: string;
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
  options?: { preloadedItems?: NavItem[]; includeCollections?: boolean },
): Promise<NavigationData> {
  // Callers that already fetched nav items can pass them in to avoid a
  // redundant DB round-trip.
  const items =
    options?.preloadedItems ?? (await c.var.services.navItems.list());
  const currentPath = c.var.publicPath;
  const appConfig = c.var.appConfig;

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

  const links = toNavItemViews(
    items,
    currentPath,
    isAuthenticated,
    appConfig.sitePathPrefix,
    collectionFreshness,
    appConfig.siteOrigin,
  );

  // Only load collections when authenticated (for compose dialog)
  if (isAuthenticated && options?.includeCollections !== false) {
    collections = await c.var.services.collections.listByRecentActivity();
  }

  return {
    links,
    currentPath,
    sitePathPrefix: appConfig.sitePathPrefix,
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
