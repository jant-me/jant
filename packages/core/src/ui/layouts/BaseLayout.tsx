/**
 * Base HTML Layout
 *
 * Provides the HTML shell with meta tags, styles, and scripts.
 * If Context is provided, automatically wraps children with I18nProvider.
 *
 * In dev mode (Vite), serves assets via Vite's dev server.
 * In production, serves pre-built assets with content-hashed filenames.
 */

import type { FC, PropsWithChildren } from "hono/jsx";
import type { Context } from "hono";
import { raw } from "hono/utils/html";
import { escapeHtml } from "../../lib/html.js";
import { msg } from "@lingui/core/macro";
import {
  getPreconnectHints,
  getPublicAssetBasePath,
  toAssetPath,
  toPublicAssetPath,
} from "../../lib/asset-path.js";
import { getJantIconHref } from "../../lib/jant-branding.js";
import { getPublicUrlForProvider } from "../../lib/image.js";
import { getThemeBrowserColors, resolveBuiltinTheme } from "../../lib/theme.js";
import { toAbsoluteAssetUrl, toPublicPath } from "../../lib/url.js";
import type { LanguageAlternate } from "../../lib/view-language.js";
import { toLanguagePrefix } from "../../i18n/locales.js";
import {
  CLIENT_AUTH_JS_FILE,
  CLIENT_AUTHOR_CSS_FILE,
  CLIENT_COMPOSE_PRELOAD,
  CLIENT_CJK_CSS_FILE,
  CLIENT_CJK_JP_CSS_FILE,
  CLIENT_CJK_KR_CSS_FILE,
  CLIENT_CJK_TC_CSS_FILE,
  CLIENT_CSS_FILE,
  CLIENT_JS_FILE,
  CORE_VERSION,
} from "../../lib/version.js";
import { IS_VITE_DEV } from "../../lib/build-env.js";
import { I18nProvider } from "../../i18n/index.js";
import {
  getCjkFontCssVariables,
  resolveCjkFontProfile,
} from "../font-themes.js";
import { resetIconCollector } from "../shared/icon-collector.js";
import { Icon } from "../shared/Icon.js";
import { IconSprite } from "../shared/IconSprite.js";

export interface ToastProps {
  message: string;
  type?: "success" | "error";
}

/** One `<link rel="alternate" type="application/atom+xml">` autodiscovery target. */
export interface PageFeedLink {
  /** Public path (or absolute URL) of the feed. */
  href: string;
  /**
   * Label feed readers show for this feed, e.g. a collection's title. Omitted
   * when blank, so the reader falls back to the feed document's own title.
   */
  title?: string;
}

export interface BaseLayoutProps {
  title: string;
  description?: string;
  lang?: string;
  c?: Context;
  toast?: ToastProps;
  faviconHref?: string;
  appleTouchHref?: string;
  faviconUrl?: string;
  faviconVersion?: string;
  socialImageUrl?: string;
  /**
   * Alt text describing an explicitly provided `socialImageUrl`. Ignored when
   * the social image falls back to the site avatar or the Jant default.
   */
  socialImageAlt?: string;
  /** Pixel width of an explicitly provided `socialImageUrl`, when known. */
  socialImageWidth?: number;
  /** Pixel height of an explicitly provided `socialImageUrl`, when known. */
  socialImageHeight?: number;
  /**
   * JSON-LD structured data object (or array of objects) rendered as a
   * `<script type="application/ld+json">`. Skipped when the page is noindex.
   */
  jsonLd?: unknown;
  /** Open Graph object type. Defaults to "website". */
  ogType?: "website" | "article";
  /** ISO 8601 publish time, rendered as `article:published_time` for articles. */
  articlePublishedTime?: string;
  /** ISO 8601 modified time, rendered as `article:modified_time` for articles. */
  articleModifiedTime?: string;
  /**
   * Absolute canonical URL for the current page. Rendered as
   * `<link rel="canonical">` when set. Use on pages whose primary content is
   * also reachable via another URL (e.g. reply posts, which render the full
   * thread at both the reply URL and the thread-root URL).
   */
  canonicalHref?: string;
  /**
   * Absolute URLs of this page in the site's other languages, rendered as
   * `<link rel="alternate" hreflang>`. Set on pages that exist once per
   * language (list surfaces) or that have translations (posts).
   */
  alternateLanguages?: LanguageAlternate[];
  /**
   * The feed this page itself publishes — a collection's feed on a collection
   * page, the filtered archive feed on `/archive`. Rendered ahead of the
   * site-wide feed links, since a reader subscribing from a page means the
   * page they are on.
   */
  pageFeed?: PageFeedLink;
  /**
   * Crawler policy for this page, overriding the site-wide setting.
   *
   * `true` is the blunt form for utility pages that should leave no trace:
   * `noindex, nofollow`. `"follow"` keeps the URL out of the index while
   * letting a crawler walk its links — for a page that is one URL out of a
   * combinatorial family (a filtered archive) but whose links lead to the
   * real pages.
   *
   * A site-wide noindex always wins: a page may be stricter than the site
   * setting, never looser.
   */
  noindex?: boolean | "follow";
  isAuthenticated?: boolean;
  clientBundle?: "public" | "full";
}

export const BaseLayout: FC<PropsWithChildren<BaseLayoutProps>> = ({
  title,
  description,
  lang,
  c,
  toast,
  faviconHref,
  appleTouchHref,
  faviconUrl,
  faviconVersion,
  socialImageUrl,
  socialImageAlt,
  socialImageWidth,
  socialImageHeight,
  jsonLd,
  ogType,
  articlePublishedTime,
  articleModifiedTime,
  canonicalHref,
  alternateLanguages,
  pageFeed,
  noindex,
  isAuthenticated = false,
  clientBundle,
  children,
}) => {
  // Start a fresh icon collection scope for this request. <Icon> usages in
  // children register names here; <IconSprite> at the end of <body> reads
  // the collected set and emits the <symbol> definitions once.
  resetIconCollector();

  // Read lang from Hono context if available, otherwise use prop or default
  const resolvedLang = lang ?? (c ? c.get("lang") : "en");

  // Read favicon/noindex from appConfig when not provided as prop
  const appConfig = c ? c.get("appConfig") : undefined;
  // Use `||` instead of `??` so empty strings (the unset state for
  // `appConfig.siteAvatarUrl`) fall through to the Jant default; otherwise
  // sites without a custom avatar render no og:image / twitter:image at all.
  const resolvedSocialImagePath =
    socialImageUrl ||
    faviconUrl ||
    appConfig?.siteAvatarUrl ||
    getJantIconHref("socialImage", appConfig?.sitePathPrefix || "");
  const resolvedFaviconVersion =
    faviconVersion ?? (appConfig?.faviconVersion || undefined);
  // A site-wide noindex is the strictest statement available, so it wins
  // outright — a per-page policy can only narrow further, never relax.
  const resolvedNoindex = appConfig?.noindex ? true : (noindex ?? false);
  const sitePathPrefix = appConfig?.sitePathPrefix || "";
  // Where "here" is for links the client builds. The server has `toViewPath`
  // for this; without the same base in the DOM, a client-rendered link to a
  // per-language surface silently drops the reader into the primary view.
  const viewLang = c?.get("viewLang");
  const viewBasePath = viewLang
    ? `${sitePathPrefix}/${toLanguagePrefix(viewLang)}`
    : sitePathPrefix;
  const assetBasePath = IS_VITE_DEV
    ? "/"
    : appConfig?.assetBasePath || getPublicAssetBasePath(sitePathPrefix);
  // Public base URL for the active media provider, exposed so the client can
  // tell which pasted images are already ours and skip rehosting them. Empty
  // means media is served same-origin (the client's same-origin check covers it).
  const mediaBase =
    getPublicUrlForProvider(
      appConfig?.storageDriver ?? "",
      appConfig?.r2PublicUrl,
      appConfig?.s3PublicUrl,
      appConfig?.localPublicUrl,
    ) ?? "";
  // Empty unless assets or media live on their own host; the two collapse to
  // one set of hints when they share a host.
  const preconnectHints = getPreconnectHints({
    assetBasePath,
    mediaBaseUrl: mediaBase,
    siteUrl: appConfig?.siteUrl,
  });
  const currentUrl = c ? c.get("publicRequestUrl") : undefined;
  const rawPath = c?.req?.path ?? "/";
  const manifestStartPath = sitePathPrefix
    ? rawPath.replace(
        new RegExp(`^${sitePathPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
        "",
      ) || "/"
    : rawPath;
  const siteName = appConfig?.siteName;
  const i18n = c ? c.get("i18n") : undefined;
  const assetPath = (path: string) =>
    IS_VITE_DEV ? path : toAssetPath(path, assetBasePath);

  // Automatically wrap with I18nProvider if Context is provided
  const content = c ? <I18nProvider c={c}>{children}</I18nProvider> : children;

  // Read theme style from Hono context if available
  const themeStyle = c ? c.get("themeStyle") : undefined;

  // Read custom CSS from appConfig
  const customCSS = appConfig?.customCSS || undefined;
  // Code-injection escape hatches: admin-only settings, rendered raw on every
  // page so analytics scripts, chat widgets, etc. can be installed site-wide.
  // These are deliberate exceptions to the "everything goes through escapeHtml"
  // rule — see CLAUDE.md / Code Injection settings page.
  const customHeadHtml = appConfig?.customHeadHtml || undefined;
  const customBodyEndHtml = appConfig?.customBodyEndHtml || undefined;
  const themeMode = appConfig?.themeMode ?? "auto";
  const activeTheme = resolveBuiltinTheme(appConfig?.themeId);
  const browserThemeColors = getThemeBrowserColors(activeTheme);
  const resolvedClientBundle =
    clientBundle ?? (isAuthenticated ? "full" : "public");
  // Derived from the language of *this page*, not the site's: on a post page
  // that is the post's own language, on a language-filtered list it is the view
  // language, and otherwise it falls back to the site language. Simplified,
  // Traditional, Japanese and Korean render the same code points with different
  // glyphs, so a page in one must not inherit another's font stack.
  const cjkFontProfile = resolveCjkFontProfile(resolvedLang);
  const cjkFontDeclarations = Object.entries(
    getCjkFontCssVariables(resolvedLang),
  )
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
  // `:root:root` matches the specificity `buildThemeStyle` uses, so ordering
  // alone decides the winner.
  const cjkFontStyle = cjkFontDeclarations
    ? `:root:root {\n${cjkFontDeclarations}\n}`
    : "";
  const cjkStylesheetPath =
    cjkFontProfile === "zh-Hans"
      ? IS_VITE_DEV
        ? assetPath("/src/style-cjk.css")
        : toPublicAssetPath(CLIENT_CJK_CSS_FILE, assetBasePath)
      : cjkFontProfile === "zh-Hant"
        ? IS_VITE_DEV
          ? assetPath("/src/style-cjk-tc.css")
          : toPublicAssetPath(CLIENT_CJK_TC_CSS_FILE, assetBasePath)
        : cjkFontProfile === "ja"
          ? IS_VITE_DEV
            ? assetPath("/src/style-cjk-jp.css")
            : toPublicAssetPath(CLIENT_CJK_JP_CSS_FILE, assetBasePath)
          : cjkFontProfile === "ko"
            ? IS_VITE_DEV
              ? assetPath("/src/style-cjk-kr.css")
              : toPublicAssetPath(CLIENT_CJK_KR_CSS_FILE, assetBasePath)
            : null;
  // The composer, the editor chrome, the settings pages and the draft preview
  // bar are the bulk of the hand-written component CSS, and none of it renders
  // for a signed-out visitor. Linking it only here keeps it off the critical
  // path of every public page.
  const authorStylesheetPath =
    resolvedClientBundle === "full"
      ? IS_VITE_DEV
        ? assetPath("/src/style-author.css")
        : toPublicAssetPath(CLIENT_AUTHOR_CSS_FILE, assetBasePath)
      : null;
  const clientScriptPath = IS_VITE_DEV
    ? resolvedClientBundle === "full"
      ? assetPath("/src/client-auth.ts")
      : assetPath("/src/client.ts")
    : // Content-hashed filenames embedded from the Vite client manifest; the
      // hash changes whenever the bundle content changes, so the import path in
      // client-auth.js always references the correct (not stale-cached) client.js.
      toPublicAssetPath(
        resolvedClientBundle === "full" ? CLIENT_AUTH_JS_FILE : CLIENT_JS_FILE,
        assetBasePath,
      );
  // The composer loads on first use; fetching its files now means the first
  // open costs no round trip. Dev serves modules straight from source, so
  // there is nothing to preload there.
  const composePreloadPaths =
    !IS_VITE_DEV && resolvedClientBundle === "full"
      ? CLIENT_COMPOSE_PRELOAD.map((file) =>
          toPublicAssetPath(file, assetBasePath),
        )
      : [];
  const faviconAssetVersion = resolvedFaviconVersion || CORE_VERSION;
  const resolvedFaviconHref =
    faviconHref ??
    (faviconAssetVersion
      ? toPublicPath(`/favicon.ico?v=${faviconAssetVersion}`, sitePathPrefix)
      : toPublicPath("/favicon.ico", sitePathPrefix));
  const resolvedAppleTouchHref =
    appleTouchHref ??
    (faviconAssetVersion
      ? toPublicPath(
          `/apple-touch-icon.png?v=${faviconAssetVersion}`,
          sitePathPrefix,
        )
      : toPublicPath("/apple-touch-icon.png", sitePathPrefix));
  const socialImageHref = resolvedSocialImagePath
    ? toAbsoluteAssetUrl(
        resolvedSocialImagePath,
        appConfig?.siteUrl || "",
        sitePathPrefix,
      )
    : "";
  // Dimensions / alt only describe an explicitly provided social image. The
  // fallbacks (site avatar, Jant default) are square branding marks, so they
  // keep the small `summary` card and a generic site-name alt.
  const hasExplicitSocialImage = Boolean(socialImageUrl);
  const socialImageAltText = hasExplicitSocialImage
    ? socialImageAlt
    : siteName || undefined;
  const socialImageWidthValue = hasExplicitSocialImage
    ? socialImageWidth
    : undefined;
  const socialImageHeightValue = hasExplicitSocialImage
    ? socialImageHeight
    : undefined;
  // `summary_large_image` only looks good for genuine landscape content; a
  // portrait or square image gets center-cropped into a thin banner.
  const useLargeTwitterCard =
    hasExplicitSocialImage &&
    socialImageWidthValue !== undefined &&
    socialImageHeightValue !== undefined &&
    socialImageWidthValue > socialImageHeightValue &&
    socialImageWidthValue >= 300;
  const feedsEnabled = appConfig?.rssFeedsEnabled === true;
  const mainFeedHref = feedsEnabled
    ? toPublicPath("/feed", sitePathPrefix)
    : null;
  const latestFeedHref = feedsEnabled
    ? toPublicPath("/latest/feed", sitePathPrefix)
    : null;
  const featuredFeedHref = feedsEnabled
    ? toPublicPath("/featured/feed", sitePathPrefix)
    : null;
  const mainFeedTitle =
    i18n?._(
      msg({
        message: "Main feed",
        comment: "@context: Feed autodiscovery title for the site's main feed",
      }),
    ) ?? "Main feed";
  const latestFeedTitle =
    i18n?._(
      msg({
        message: "Latest posts",
        comment:
          "@context: Feed autodiscovery title for the latest public posts feed",
      }),
    ) ?? "Latest posts";
  const featuredFeedTitle =
    i18n?._(
      msg({
        message: "Featured posts",
        comment:
          "@context: Feed autodiscovery title for the featured posts feed",
      }),
    ) ?? "Featured posts";
  const alternateFeed =
    appConfig?.mainRssFeed === "latest"
      ? { href: featuredFeedHref, title: featuredFeedTitle }
      : { href: latestFeedHref, title: latestFeedTitle };
  const pageFeedHref = feedsEnabled ? pageFeed?.href.trim() || null : null;
  const pageFeedTitle = pageFeed?.title?.trim() || undefined;

  return (
    <>
      {raw("<!DOCTYPE html>")}
      <html
        lang={resolvedLang}
        data-theme={appConfig?.themeId}
        data-theme-mode={themeMode}
        data-site-path-prefix={sitePathPrefix}
        data-view-base-path={viewBasePath}
        data-view-lang={viewLang ?? undefined}
        data-asset-base-path={assetBasePath}
        data-media-base={mediaBase}
      >
        <head>
          <meta charset="UTF-8" />
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          />
          {preconnectHints.map((hint) => (
            <link
              rel="preconnect"
              href={hint.href}
              {...(hint.crossorigin ? { crossorigin: "anonymous" } : {})}
            />
          ))}
          {themeMode === "dark" ? (
            <meta name="theme-color" content={browserThemeColors.dark} />
          ) : themeMode === "light" ? (
            <meta name="theme-color" content={browserThemeColors.light} />
          ) : (
            <>
              <meta name="theme-color" content={browserThemeColors.light} />
              <meta
                name="theme-color"
                content={browserThemeColors.light}
                media="(prefers-color-scheme: light)"
              />
              <meta
                name="theme-color"
                content={browserThemeColors.dark}
                media="(prefers-color-scheme: dark)"
              />
            </>
          )}
          <title>{title}</title>
          {description && <meta name="description" content={description} />}
          <meta property="og:title" content={title} />
          <meta property="og:type" content={ogType ?? "website"} />
          {ogType === "article" && articlePublishedTime && (
            <meta
              property="article:published_time"
              content={articlePublishedTime}
            />
          )}
          {ogType === "article" && articleModifiedTime && (
            <meta
              property="article:modified_time"
              content={articleModifiedTime}
            />
          )}
          {description && (
            <meta property="og:description" content={description} />
          )}
          {socialImageHref && (
            <meta property="og:image" content={socialImageHref} />
          )}
          {socialImageHref && socialImageWidthValue !== undefined && (
            <meta
              property="og:image:width"
              content={String(socialImageWidthValue)}
            />
          )}
          {socialImageHref && socialImageHeightValue !== undefined && (
            <meta
              property="og:image:height"
              content={String(socialImageHeightValue)}
            />
          )}
          {socialImageHref && socialImageAltText && (
            <meta property="og:image:alt" content={socialImageAltText} />
          )}
          {siteName && <meta property="og:site_name" content={siteName} />}
          {currentUrl && <meta property="og:url" content={currentUrl} />}
          <meta
            name="twitter:card"
            content={useLargeTwitterCard ? "summary_large_image" : "summary"}
          />
          <meta name="twitter:title" content={title} />
          {description && (
            <meta name="twitter:description" content={description} />
          )}
          {socialImageHref && (
            <meta name="twitter:image" content={socialImageHref} />
          )}
          {socialImageHref && socialImageAltText && (
            <meta name="twitter:image:alt" content={socialImageAltText} />
          )}
          {resolvedNoindex && (
            <meta
              name="robots"
              content={
                resolvedNoindex === "follow"
                  ? "noindex, follow"
                  : "noindex, nofollow"
              }
            />
          )}
          {!resolvedNoindex && jsonLd != null && (
            <script
              type="application/ld+json"
              // JSON.stringify output with `<` / `>` escaped to \u-sequences
              // so a value containing `</script>` cannot break out of the tag.
              // JSON parsers decode the escapes transparently.
              dangerouslySetInnerHTML={{
                __html: JSON.stringify(jsonLd)
                  .replace(/</g, "\\u003c")
                  .replace(/>/g, "\\u003e"),
              }}
            />
          )}
          {canonicalHref && <link rel="canonical" href={canonicalHref} />}
          {/* Emitted as raw HTML on purpose: hono/jsx deduplicates `<link>`
              elements by `href` alone, which silently drops the self-referential
              alternate (it shares the canonical link's URL) and any `x-default`
              (it shares the primary language's). Both are required for an
              hreflang set to be honoured. Values are escaped here. */}
          {alternateLanguages && alternateLanguages.length > 0
            ? raw(
                alternateLanguages
                  .map(
                    (alternate) =>
                      `<link rel="alternate" hreflang="${escapeHtml(alternate.hreflang)}" href="${escapeHtml(alternate.href)}"/>`,
                  )
                  .join(""),
              )
            : null}
          <link rel="icon" href={resolvedFaviconHref} sizes="16x16 32x32" />
          <link rel="apple-touch-icon" href={resolvedAppleTouchHref} />
          <link
            rel="manifest"
            href={toPublicPath(
              manifestStartPath && manifestStartPath !== "/"
                ? `/manifest.webmanifest?start=${encodeURIComponent(manifestStartPath)}&name=${encodeURIComponent(title)}`
                : "/manifest.webmanifest",
              sitePathPrefix,
            )}
          />
          {pageFeedHref && (
            <link
              rel="alternate"
              type="application/atom+xml"
              title={pageFeedTitle}
              href={pageFeedHref}
            />
          )}
          {mainFeedHref && (
            <link
              rel="alternate"
              type="application/atom+xml"
              title={mainFeedTitle}
              href={mainFeedHref}
            />
          )}
          {alternateFeed.href && (
            <link
              rel="alternate"
              type="application/atom+xml"
              title={alternateFeed.title}
              href={alternateFeed.href}
            />
          )}
          {IS_VITE_DEV && (
            <script type="module" src={assetPath("/@vite/client")} />
          )}
          <link
            rel="stylesheet"
            href={
              IS_VITE_DEV
                ? assetPath("/src/style.css")
                : toPublicAssetPath(CLIENT_CSS_FILE, assetBasePath)
            }
          />
          {cjkStylesheetPath && (
            <link rel="stylesheet" href={cjkStylesheetPath} />
          )}
          {authorStylesheetPath && (
            <link rel="stylesheet" href={authorStylesheetPath} />
          )}
          {/* Critical inline style: prevent mobile nav jitter by applying
              responsive header layout before external CSS/JS loads */}
          <style
            dangerouslySetInnerHTML={{
              __html: `.site-header-search-link,.site-header-hamburger,.site-header-more-responsive-only,.site-header-more-link-responsive,.site-header-more-divider-responsive{display:none!important}@media(max-width:1200px){.site-header-search-form{display:none!important}.site-header-search-link{display:inline-flex!important}}@media(max-width:960px){.site-header-link-collapse-lg{display:none!important}.site-header-more-responsive-only.site-header-more-tier-lg{display:inline-flex!important}.site-header-more-link-show-lg{display:flex!important}.site-header-more-divider-show-lg{display:block!important}}@media(max-width:780px){.site-header-link-collapse-md{display:none!important}.site-header-more-responsive-only.site-header-more-tier-md{display:inline-flex!important}.site-header-more-link-show-md{display:flex!important}.site-header-more-divider-show-md{display:block!important}}@media(max-width:580px){.site-header-link-collapse-sm{display:none!important}.site-header-more-responsive-only.site-header-more-tier-sm{display:inline-flex!important}.site-header-more-link-show-sm{display:flex!important}.site-header-more-divider-show-sm{display:block!important}}@media(max-width:480px){.site-header-nav,.site-header-more{display:none!important}.site-header-search-slot{display:flex!important}.site-header-hamburger{display:flex!important}.site-header-right{margin-left:.35rem}}`,
            }}
          />
          {/* Emitted before the theme style so a font theme that names its own
              CJK stack still wins. */}
          {cjkFontStyle && (
            <style dangerouslySetInnerHTML={{ __html: cjkFontStyle }} />
          )}
          {themeStyle && (
            <style dangerouslySetInnerHTML={{ __html: themeStyle }} />
          )}
          {customCSS && (
            <style dangerouslySetInnerHTML={{ __html: customCSS }} />
          )}
          {customHeadHtml && raw(customHeadHtml)}
          <script type="module" src={clientScriptPath} />
          {composePreloadPaths.map((href) => (
            <link rel="modulepreload" href={href} />
          ))}
        </head>
        <body
          class="bg-background text-foreground antialiased"
          {...(isAuthenticated ? { "data-authenticated": true } : {})}
        >
          {content}
          <div
            id="toast-container"
            class="toast-container"
            popover="manual"
            aria-live="polite"
            aria-relevant="additions text"
          >
            {toast && (
              <div
                class={`toast ${toast.type === "error" ? "toast-error" : "toast-success"}`}
                data-init="el.closest('[popover]').showPopover(); history.replaceState({}, '', location.pathname); setTimeout(() => { el.classList.add('toast-out'); el.addEventListener('animationend', () => el.remove()) }, 3000)"
              >
                {toast.type === "error" ? (
                  <Icon name="toast-error" />
                ) : (
                  <Icon name="toast-success" />
                )}
                <span>{toast.message}</span>
                <button
                  class="toast-close"
                  data-on:click="el.closest('.toast').classList.add('toast-out'); el.closest('.toast').addEventListener('animationend', () => el.closest('.toast').remove())"
                >
                  <Icon name="toast-close" />
                </button>
              </div>
            )}
          </div>
          {customBodyEndHtml && raw(customBodyEndHtml)}
          {/* Icon sprite: must come after all <Icon> usages so the
              request-scoped collector has seen every name. */}
          <IconSprite />
        </body>
      </html>
    </>
  );
};
