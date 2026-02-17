/**
 * Navigation Helper
 *
 * Provides shared data fetching for public page navigation.
 */

import type { Context } from "hono";
import { getSiteName, getHomeDefaultView, getSiteFooter } from "./config.js";
import type { Collection, NavItemView } from "../types.js";
import { toNavItemViews } from "./view.js";
import { getMediaUrl, getPublicUrlForProvider } from "./image.js";
import { render as renderMarkdown } from "./markdown.js";

/**
 * Navigation data needed by SiteLayout
 */
export interface NavigationData {
  links: NavItemView[];
  currentPath: string;
  siteName: string;
  siteDescription: string;
  isAuthenticated: boolean;
  collections: Collection[];
  homeDefaultView: string;
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
export async function getNavigationData(c: Context): Promise<NavigationData> {
  const items = await c.var.services.navItems.list();
  const currentPath = new URL(c.req.url).pathname;
  const [siteName, homeDefaultView, siteFooter] = await Promise.all([
    getSiteName(c),
    getHomeDefaultView(c),
    getSiteFooter(c),
  ]);

  // Only include description if explicitly set (DB or env), not the default
  const dbDescription = await c.var.services.settings.get("SITE_DESCRIPTION");
  const envDescription = c.env.SITE_DESCRIPTION;
  const siteDescription =
    dbDescription || (typeof envDescription === "string" ? envDescription : "");

  // Resolve avatar URL from storage key
  const avatarKey = await c.var.services.settings.get("SITE_AVATAR");
  const showHeaderAvatar =
    (await c.var.services.settings.get("SHOW_HEADER_AVATAR")) === "true";
  let siteAvatarUrl: string | undefined;
  if (avatarKey) {
    const publicUrl = getPublicUrlForProvider(
      c.env.STORAGE_DRIVER || "r2",
      c.env.R2_PUBLIC_URL,
      c.env.S3_PUBLIC_URL,
    );
    siteAvatarUrl = getMediaUrl(avatarKey, publicUrl);
  }

  // Render footer markdown
  const siteFooterHtml = siteFooter ? renderMarkdown(siteFooter) : undefined;

  const links = toNavItemViews(items, currentPath);

  // Check auth status for compose button
  let isAuthenticated = false;
  let collections: Collection[] = [];
  if (c.var.auth) {
    try {
      const session = await c.var.auth.api.getSession({
        headers: c.req.raw.headers,
      });
      isAuthenticated = !!session?.user;
    } catch {
      // Not authenticated
    }
  }

  // Only load collections when authenticated (for compose dialog)
  if (isAuthenticated) {
    collections = await c.var.services.collections.list();
  }

  return {
    links,
    currentPath,
    siteName,
    siteDescription,
    isAuthenticated,
    collections,
    homeDefaultView,
    siteAvatarUrl,
    showHeaderAvatar: showHeaderAvatar && !!siteAvatarUrl,
    siteFooterHtml,
  };
}
