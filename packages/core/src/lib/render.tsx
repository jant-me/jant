/**
 * Public Page Rendering Helper
 *
 * Provides a single entry point for rendering public pages with the
 * correct layout stack: BaseLayout > SiteLayout > content.
 */

import type { Context } from "hono";
import type { Child } from "hono/jsx";
import type { SiteLayoutProps } from "../types.js";
import { SETTINGS_KEYS } from "./constants.js";
import {
  BaseLayout,
  type PageFeedLink,
  type ToastProps,
} from "../ui/layouts/BaseLayout.js";
import { SiteLayout } from "../ui/layouts/SiteLayout.js";
import type { NavigationData } from "./navigation.js";
import {
  buildComposeLanguages,
  buildLanguageSwitcher,
  getViewLang,
  type LanguageAlternate,
  type LanguageSwitcherOption,
} from "./view-language.js";

export interface RenderPublicPageOptions {
  /** Page title for <title> tag */
  title: string;
  /** Page description for meta tag */
  description?: string;
  /** Optional explicit favicon asset href */
  faviconHref?: string;
  /** Optional explicit apple-touch-icon href */
  appleTouchHref?: string;
  /** Optional explicit social image href */
  socialImageUrl?: string;
  /** Alt text describing an explicit `socialImageUrl`. */
  socialImageAlt?: string;
  /** Pixel width of an explicit `socialImageUrl`, when known. */
  socialImageWidth?: number;
  /** Pixel height of an explicit `socialImageUrl`, when known. */
  socialImageHeight?: number;
  /** Open Graph object type. Defaults to "website" in BaseLayout. */
  ogType?: "website" | "article";
  /** ISO 8601 publish time, rendered as `article:published_time` for articles. */
  articlePublishedTime?: string;
  /** ISO 8601 modified time, rendered as `article:modified_time` for articles. */
  articleModifiedTime?: string;
  /** JSON-LD structured data object (or array) for this page. */
  jsonLd?: unknown;
  /**
   * Absolute canonical URL for this page. Forwarded to `BaseLayout` and
   * rendered as `<link rel="canonical">`. Only set when the page has a
   * different canonical location (e.g. thread reply pages point back to the
   * thread root).
   */
  canonicalHref?: string;
  /**
   * `hreflang` alternates for this page. List surfaces pass
   * `buildSurfaceAlternates(c)`; a post passes its translations. Pages that
   * exist once for the whole site pass nothing.
   */
  alternateLanguages?: LanguageAlternate[];
  /**
   * The feed this page publishes, for `<link rel="alternate">` autodiscovery.
   * Set on pages with a feed of their own — a collection, the archive — so a
   * reader's extension finds that feed rather than only the site-wide ones.
   */
  pageFeed?: PageFeedLink;
  /**
   * Language switcher entries. Defaults to the current surface in each of the
   * site's languages; a post overrides it with its translations.
   */
  languageSwitcher?: LanguageSwitcherOption[];
  /** Navigation data (from getNavigationData) */
  navData: NavigationData;
  /** Page content JSX to render inside SiteLayout */
  content: Child;
  /** Optional status chrome rendered outside the public site layout. */
  pageChrome?: Child;
  /** Optional sidebar content for sidebar layout */
  sidebar?: Child;
  /** Optional toast notification */
  toast?: ToastProps;
  /** Whether to render the shared compose dialog shell */
  showComposeDialog?: boolean;
  /**
   * Override the site-wide crawler setting for this page. `true` means
   * `noindex, nofollow`; `"follow"` keeps the URL unindexed while leaving its
   * links crawlable. See `BaseLayoutProps["noindex"]`.
   */
  noindex?: boolean | "follow";
  /** Whether to render the site header */
  showHeader?: boolean;
  /** Whether to render the home branding credit after the site footer */
  showHomeBranding?: boolean;
  /** When set, the mobile compose FAB pre-selects this collection. */
  composeCollectionId?: string;
  /**
   * Content language of the page the composer opens from, for its default.
   * List surfaces leave this unset and get the view language; a post page
   * passes its post's language, since its URL carries no view prefix.
   */
  composeContextLanguage?: string | null;
}

/**
 * Render a public page with the standard layout stack.
 *
 * @param c - Hono context
 * @param options - Page rendering options
 * @returns Hono HTML response
 *
 * @example
 * ```typescript
 * const navData = await getNavigationData(c);
 * return renderPublicPage(c, {
 *   title: "My Page",
 *   navData,
 *   content: <MyPageComponent />,
 * });
 * ```
 */
export function renderPublicPage(c: Context, options: RenderPublicPageOptions) {
  const {
    title,
    description,
    faviconHref,
    appleTouchHref,
    socialImageUrl,
    socialImageAlt,
    socialImageWidth,
    socialImageHeight,
    ogType,
    articlePublishedTime,
    articleModifiedTime,
    jsonLd,
    canonicalHref,
    alternateLanguages,
    pageFeed,
    languageSwitcher,
    navData,
    content,
    pageChrome,
    sidebar,
    toast,
    showComposeDialog,
    noindex,
    showHeader,
    showHomeBranding,
    composeCollectionId,
    composeContextLanguage,
  } = options;

  // Use siteDescription as meta description fallback when not explicitly provided
  const metaDescription = description || navData.siteDescription || undefined;

  // Read favicon, version, and noindex from appConfig
  const appConfig = c.get("appConfig");
  const allSettings = c.get("allSettings") as Record<string, string>;

  const layoutProps: SiteLayoutProps = {
    siteName: navData.siteName,
    links: navData.links,
    currentPath: navData.currentPath,
    sitePathPrefix: navData.sitePathPrefix,
    basePath: navData.basePath,
    isAuthenticated: navData.isAuthenticated,
    collections: navData.collections,
    siteAvatarThumbUrl: navData.siteAvatarThumbUrl,
    showHeaderAvatar: navData.showHeaderAvatar,
    siteDescriptionHtml: navData.siteDescriptionHtml,
    siteFooterHtml: navData.siteFooterHtml,
    showHomeBranding,
    sidebar,
    uploadMaxFileSize: appConfig.uploadMaxFileSize,
    showComposeDialog,
    showHeader,
    composeOpenShortcutDiscovered: Boolean(
      allSettings[SETTINGS_KEYS.DISCOVERY_COMPOSE_OPEN_SHORTCUT_AT],
    ),
    slashCommandDiscovered: Boolean(
      allSettings[SETTINGS_KEYS.DISCOVERY_SLASH_COMMAND_AT],
    ),
    composeCollectionId,
    languageSwitcher: languageSwitcher ?? buildLanguageSwitcher(c),
    composeLanguages: buildComposeLanguages(c),
    composeContextLanguage: composeContextLanguage ?? getViewLang(c),
  };
  const faviconUrl = appConfig.siteAvatarUrl || undefined;
  const faviconVersion = appConfig.faviconVersion || undefined;
  // `noindex` is passed straight through: BaseLayout reads the site-wide
  // setting from this same context and is the single place the two resolve.
  return c.html(
    <BaseLayout
      title={title}
      description={metaDescription}
      c={c}
      faviconHref={faviconHref}
      appleTouchHref={appleTouchHref}
      socialImageUrl={socialImageUrl}
      socialImageAlt={socialImageAlt}
      socialImageWidth={socialImageWidth}
      socialImageHeight={socialImageHeight}
      ogType={ogType}
      articlePublishedTime={articlePublishedTime}
      articleModifiedTime={articleModifiedTime}
      jsonLd={jsonLd}
      canonicalHref={canonicalHref}
      alternateLanguages={alternateLanguages}
      pageFeed={pageFeed}
      faviconUrl={faviconUrl}
      faviconVersion={faviconVersion}
      noindex={noindex}
      isAuthenticated={navData.isAuthenticated}
      toast={toast}
    >
      {pageChrome}
      <SiteLayout {...layoutProps}>{content}</SiteLayout>
    </BaseLayout>,
  );
}
