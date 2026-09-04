/**
 * Site Layout
 *
 * Vertical header: site name on top, custom nav links below.
 * Content area with browse filter tabs and compose prompt/dialog for authenticated users.
 */

import { msg } from "@lingui/core/macro";
import type { FC, PropsWithChildren } from "hono/jsx";
import { useLingui } from "../../i18n/context.js";
import type {
  LanguageSwitcherOption,
  NavItemView,
  SiteLayoutProps,
} from "../../types.js";
import { toPublicPath } from "../../lib/url.js";
import { ComposeDialog } from "../compose/ComposeDialog.js";
import { ComposePrompt } from "../compose/ComposePrompt.js";
import {
  getNavItemDisplayLabel,
  NAV_MORE_LABEL,
} from "../shared/navigation-labels.js";
import { HomePageBranding } from "../shared/HomePageBranding.js";

const ExternalLinkIcon = () => (
  <svg
    class="site-header-link-external"
    xmlns="http://www.w3.org/2000/svg"
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M7 7h10v10" />
    <path d="M7 17 17 7" />
  </svg>
);

function SearchIcon({ class: className = "" }: { class?: string }) {
  return (
    <svg
      class={className}
      xmlns="http://www.w3.org/2000/svg"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function ComposeFeatherIcon({ class: className = "" }: { class?: string }) {
  return (
    <svg
      class={className}
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
      <line x1="16" y1="8" x2="2" y2="22" />
      <line x1="17.5" y1="15" x2="9" y2="15" />
    </svg>
  );
}

function HeaderLink({
  link,
  label,
  className = "",
}: {
  link: NavItemView;
  label: string;
  className?: string;
}) {
  const classes = [
    "site-header-link",
    className,
    link.isActive ? "site-header-link-active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <a
      href={link.url}
      class={classes}
      {...(link.isExternal
        ? { target: "_blank", rel: "noopener noreferrer" }
        : {})}
      {...(link.freshAt ? { "data-fresh-at": link.freshAt } : {})}
    >
      {label}
      {link.isExternal && <ExternalLinkIcon />}
    </a>
  );
}

export interface SiteHeaderProps {
  siteName: string;
  links: NavItemView[];
  currentPath: string;
  sitePathPrefix?: string;
  /**
   * Public base for language-scoped links — the logo, search, and home
   * detection. Equals `sitePathPrefix` outside a language view, and carries
   * the language prefix inside one (`/blog/ja`), so a page in the Japanese
   * view leads home to `/ja` rather than to the primary language.
   */
  basePath?: string;
  siteAvatarThumbUrl?: string;
  showHeaderAvatar?: boolean;
  /** Languages this site publishes in. Empty on a single-language site. */
  languageSwitcher?: LanguageSwitcherOption[];
}

function linkCollapseTier(idx: number): string {
  if (idx < 2) return "";
  if (idx === 2) return "site-header-link-collapse-sm";
  if (idx === 3) return "site-header-link-collapse-md";
  return "site-header-link-collapse-lg";
}

function moreLinkRevealTier(idx: number): string {
  if (idx === 2) return "site-header-more-link-show-sm";
  if (idx === 3) return "site-header-more-link-show-md";
  return "site-header-more-link-show-lg";
}

function getResponsiveOverflowTier(
  headerLinkCount: number,
): "sm" | "md" | "lg" | null {
  if (headerLinkCount >= 5) return "lg";
  if (headerLinkCount === 4) return "md";
  if (headerLinkCount === 3) return "sm";
  return null;
}

export const SiteHeader: FC<SiteHeaderProps> = ({
  siteName,
  links,
  currentPath,
  sitePathPrefix = "",
  basePath = sitePathPrefix,
  siteAvatarThumbUrl,
  showHeaderAvatar,
  languageSwitcher = [],
}) => {
  const { i18n } = useLingui();
  const homeHref = basePath || "/";
  const linksWithLabels = links.map((link) => ({
    ...link,
    displayLabel: getNavItemDisplayLabel(link, i18n, sitePathPrefix),
  }));

  const searchLabel = i18n._(
    msg({
      message: "Search",
      context: "nav",
      comment: "@context: Search icon link in browse nav",
    }),
  );
  const searchHref = toPublicPath("/search", basePath);

  const menuLabel = i18n._(
    msg({
      message: "Menu",
      comment: "@context: Hamburger menu button label",
    }),
  );
  const closeMenuLabel = i18n._(
    msg({
      message: "Close menu",
      comment: "@context: Close drawer button label",
    }),
  );
  const moreLabel = i18n._(NAV_MORE_LABEL);

  // The switcher is a "take me to this language's site" control, so it names
  // each language in that language — a reader looking for their own language
  // should not have to read the current one to find it.
  const languageLabel = i18n._(
    msg({
      message: "Language",
      comment: "@context: Accessible label for the site language switcher",
    }),
  );
  // Which language the reader is in, and whether that is worth saying out
  // loud: the root is the site's default, everything else is a variant of it.
  const currentLanguage = languageSwitcher.find((option) => option.isCurrent);
  const offPrimaryLanguage = Boolean(
    currentLanguage && !currentLanguage.isPrimary,
  );
  // The visible name is written in its own language, so the accessible name
  // has to carry it too — a control read out as "Language" alone would lose
  // the one thing it says.
  const currentLanguageLabel = i18n._(
    msg({
      message: "Language: {language}",
      comment:
        "@context: Accessible label for the site language switcher when it names the language on screen",
    }),
    { language: currentLanguage?.label ?? "" },
  );
  // Split custom links by placement.
  const headerLinks = linksWithLabels.filter(
    (l) => l.placement === "header" || !l.placement,
  );
  const moreLinks = linksWithLabels.filter((l) => l.placement === "more");
  const responsiveOverflowTier = getResponsiveOverflowTier(headerLinks.length);
  const hasResponsiveOverflow = responsiveOverflowTier !== null;
  const hasSupplementalMoreLinks = moreLinks.length > 0;
  const showMoreMenu = hasResponsiveOverflow || hasSupplementalMoreLinks;

  // Decide the widest breakpoint at which the "More" button must appear
  // when there are no supplemental links.
  const responsiveTierClass =
    responsiveOverflowTier && !hasSupplementalMoreLinks
      ? `site-header-more-tier-${responsiveOverflowTier}`
      : "";
  const moreMenuClass = [
    "site-header-more",
    hasResponsiveOverflow && !hasSupplementalMoreLinks
      ? "site-header-more-responsive-only"
      : "",
    responsiveTierClass,
  ]
    .filter(Boolean)
    .join(" ");
  const isHomePage =
    currentPath === homeHref ||
    currentPath === toPublicPath("/featured", basePath) ||
    currentPath === toPublicPath("/latest", basePath);

  return (
    <>
      <header class="site-header" data-site-header-fragment="header">
        <div class="site-header-inner">
          <div
            class={`site-header-top site-header-top-bordered${isHomePage ? " site-header-top-home" : ""}`}
          >
            <a href={homeHref} class="site-logo">
              {showHeaderAvatar && siteAvatarThumbUrl && (
                <img src={siteAvatarThumbUrl} class="site-logo-avatar" alt="" />
              )}
              {siteName}
            </a>
            <nav class="site-header-nav" aria-label="Primary">
              {headerLinks.map((link, idx) => (
                <HeaderLink
                  key={link.id}
                  link={link}
                  label={link.displayLabel}
                  className={[
                    idx < 2
                      ? "site-header-link-primary"
                      : "site-header-link-overflow",
                    linkCollapseTier(idx),
                  ]
                    .filter(Boolean)
                    .join(" ")}
                />
              ))}
              {showMoreMenu && (
                <div class={moreMenuClass}>
                  <button
                    type="button"
                    class="site-header-more-btn"
                    id="site-nav-more-trigger"
                    aria-haspopup="menu"
                    aria-expanded="false"
                  >
                    {moreLabel}
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                  <div
                    id="site-nav-more-popover"
                    class="site-header-more-popover"
                    data-popover
                    data-align="start"
                    aria-hidden="true"
                  >
                    {headerLinks.slice(2).map((link, i) => {
                      const idx = i + 2;
                      const classes = [
                        "site-header-more-link",
                        "site-header-more-link-responsive",
                        moreLinkRevealTier(idx),
                        link.isActive ? "site-header-more-link-active" : "",
                      ]
                        .filter(Boolean)
                        .join(" ");
                      return (
                        <a
                          key={link.id}
                          href={link.url}
                          class={classes}
                          {...(link.isExternal
                            ? {
                                target: "_blank",
                                rel: "noopener noreferrer",
                              }
                            : {})}
                          {...(link.freshAt
                            ? { "data-fresh-at": link.freshAt }
                            : {})}
                        >
                          {link.displayLabel}
                          {link.isExternal && <ExternalLinkIcon />}
                        </a>
                      );
                    })}
                    {responsiveOverflowTier && hasSupplementalMoreLinks && (
                      <div
                        class={`site-header-more-divider site-header-more-divider-responsive site-header-more-divider-show-${responsiveOverflowTier}`}
                      />
                    )}
                    {moreLinks.map((link) => (
                      <a
                        key={link.id}
                        href={link.url}
                        class={`site-header-more-link site-header-more-link-supplemental ${link.isActive ? "site-header-more-link-active" : ""}`}
                        {...(link.isExternal
                          ? {
                              target: "_blank",
                              rel: "noopener noreferrer",
                            }
                          : {})}
                        {...(link.freshAt
                          ? { "data-fresh-at": link.freshAt }
                          : {})}
                      >
                        {link.displayLabel}
                        {link.isExternal && <ExternalLinkIcon />}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </nav>

            <div class="site-header-search-slot">
              <form
                class="site-header-search-form"
                action={searchHref}
                method="get"
              >
                <SearchIcon class="site-header-search-icon" />
                <input
                  type="search"
                  name="q"
                  class="site-header-search-input"
                  placeholder={searchLabel}
                  aria-label={searchLabel}
                  enterkeyhint="search"
                />
              </form>
              <a
                href={searchHref}
                class="site-header-search-link"
                aria-label={searchLabel}
                title={searchLabel}
              >
                <SearchIcon class="site-header-search-link-icon" />
              </a>
            </div>

            <div class="site-header-right">
              {languageSwitcher.length > 1 && (
                <div
                  class={`site-header-lang${
                    offPrimaryLanguage ? " site-header-lang-named" : ""
                  }`}
                >
                  <button
                    type="button"
                    class="site-header-more-btn site-header-lang-btn"
                    id="site-nav-lang-trigger"
                    aria-haspopup="menu"
                    aria-expanded="false"
                    aria-label={
                      offPrimaryLanguage ? currentLanguageLabel : languageLabel
                    }
                  >
                    {/* A globe, never a flag: flags name countries rather
                        than languages. The primary language is the site as
                        it comes, so the globe stands alone there; every
                        other view is a variant of it, and a reader who
                        landed on one — from a search result, a shared link,
                        a post written in another language — is told which,
                        without opening anything. */}
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                      class="site-header-lang-globe"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                      <path d="M2 12h20" />
                    </svg>
                    {offPrimaryLanguage && (
                      <span
                        class="site-header-lang-name"
                        lang={currentLanguage?.lang}
                      >
                        {currentLanguage?.label}
                      </span>
                    )}
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                  <div
                    id="site-nav-lang-popover"
                    class="site-header-more-popover site-header-lang-popover"
                    data-popover
                    data-align="end"
                    aria-hidden="true"
                  >
                    {languageSwitcher.map((option) => (
                      <a
                        key={option.lang}
                        href={option.href}
                        hreflang={option.lang}
                        lang={option.lang}
                        class={`site-header-more-link ${option.isCurrent ? "site-header-more-link-active" : ""}`}
                        {...(option.isCurrent
                          ? { "aria-current": "true" }
                          : {})}
                      >
                        {option.label}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              <button
                type="button"
                class="site-header-hamburger"
                aria-controls="site-nav-drawer"
                aria-expanded="false"
                aria-label={menuLabel}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <line x1="4" x2="20" y1="12" y2="12" />
                  <line x1="4" x2="20" y1="6" y2="6" />
                  <line x1="4" x2="20" y1="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      <div
        class="site-nav-drawer-backdrop"
        data-site-header-fragment="drawer-backdrop"
        aria-hidden="true"
      />
      <div
        id="site-nav-drawer"
        class="site-nav-drawer"
        data-site-header-fragment="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={menuLabel}
        aria-hidden="true"
        inert
      >
        <div class="site-nav-drawer-header">
          <a href={homeHref} class="site-nav-drawer-brand">
            {showHeaderAvatar && siteAvatarThumbUrl && (
              <img
                src={siteAvatarThumbUrl}
                class="site-nav-drawer-brand-avatar"
                alt=""
              />
            )}
            {siteName}
          </a>
          <button
            type="button"
            class="site-nav-drawer-close"
            aria-label={closeMenuLabel}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <nav class="site-nav-drawer-nav" aria-label="Primary">
          {headerLinks.map((link) => (
            <a
              key={link.id}
              href={link.url}
              class={`site-nav-drawer-link ${link.isActive ? "site-nav-drawer-link-active" : ""}`}
              {...(link.isExternal
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
              {...(link.freshAt ? { "data-fresh-at": link.freshAt } : {})}
            >
              {link.displayLabel}
              {link.isExternal && <ExternalLinkIcon />}
            </a>
          ))}
          {moreLinks.length > 0 && (
            <>
              <div class="site-nav-drawer-divider" />
              <span class="site-nav-drawer-section-label">{moreLabel}</span>
              {moreLinks.map((link) => (
                <a
                  key={link.id}
                  href={link.url}
                  class={`site-nav-drawer-link site-nav-drawer-link-secondary ${link.isActive ? "site-nav-drawer-link-active" : ""}`}
                  {...(link.isExternal
                    ? { target: "_blank", rel: "noopener noreferrer" }
                    : {})}
                  {...(link.freshAt ? { "data-fresh-at": link.freshAt } : {})}
                >
                  {link.displayLabel}
                  {link.isExternal && <ExternalLinkIcon />}
                </a>
              ))}
            </>
          )}
          {languageSwitcher.length > 1 && (
            <>
              <div class="site-nav-drawer-divider" />
              <span class="site-nav-drawer-section-label">{languageLabel}</span>
              {languageSwitcher.map((option) => (
                <a
                  key={option.lang}
                  href={option.href}
                  hreflang={option.lang}
                  lang={option.lang}
                  class={`site-nav-drawer-link site-nav-drawer-link-secondary ${option.isCurrent ? "site-nav-drawer-link-active" : ""}`}
                  {...(option.isCurrent ? { "aria-current": "true" } : {})}
                >
                  {option.label}
                </a>
              ))}
            </>
          )}
        </nav>
      </div>
    </>
  );
};

export const SiteLayout: FC<PropsWithChildren<SiteLayoutProps>> = ({
  siteName,
  links,
  currentPath,
  sitePathPrefix = "",
  basePath = sitePathPrefix,
  isAuthenticated,
  collections,
  siteAvatarThumbUrl,
  showHeaderAvatar,
  siteDescriptionHtml,
  siteFooterHtml,
  showHomeBranding = false,
  sidebar,
  uploadMaxFileSize,
  showComposeDialog = true,
  showHeader = true,
  composeOpenShortcutDiscovered = false,
  slashCommandDiscovered = false,
  composeCollectionId,
  languageSwitcher,
  composeLanguages,
  composeContextLanguage,
  children,
}) => {
  const { i18n } = useLingui();
  const newPostLabel = i18n._(
    msg({
      message: "New post",
      comment:
        "@context: Mobile floating action button label to open the compose dialog",
    }),
  );

  const isHomePage =
    currentPath === (basePath || "/") ||
    currentPath === toPublicPath("/featured", basePath) ||
    currentPath === toPublicPath("/latest", basePath);
  const showMobileComposeFab = Boolean(
    (isHomePage || composeCollectionId) && isAuthenticated && showComposeDialog,
  );
  const contentClass = [
    "site-content",
    isHomePage ? "site-content-home" : "",
    showMobileComposeFab ? "site-content-mobile-compose-enabled" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div class="site-page">
      {showHeader && (
        <SiteHeader
          siteName={siteName}
          links={links}
          currentPath={currentPath}
          sitePathPrefix={sitePathPrefix}
          basePath={basePath}
          siteAvatarThumbUrl={siteAvatarThumbUrl}
          showHeaderAvatar={showHeaderAvatar}
          languageSwitcher={languageSwitcher}
        />
      )}

      <main class="site-main">
        {sidebar ? (
          <div class="site-container site-container-sidebar">
            <aside class="sidebar-nav">{sidebar}</aside>
            <div class={contentClass}>{children}</div>
          </div>
        ) : (
          <div class="site-container">
            <div class={contentClass}>
              {isHomePage && (
                <div class="site-home-header">
                  {siteDescriptionHtml && (
                    <div
                      class="site-description prose"
                      dangerouslySetInnerHTML={{
                        __html: siteDescriptionHtml,
                      }}
                    />
                  )}
                  {isAuthenticated ? (
                    <ComposePrompt
                      composeOpenShortcutDiscovered={
                        composeOpenShortcutDiscovered
                      }
                    />
                  ) : (
                    siteDescriptionHtml && (
                      <hr class="site-description-divider" aria-hidden="true" />
                    )
                  )}
                </div>
              )}
              {children}
            </div>
          </div>
        )}
      </main>

      {showMobileComposeFab && (
        <button
          type="button"
          class="site-mobile-compose-fab"
          aria-label={newPostLabel}
          data-compose-open
          {...(composeCollectionId
            ? { "data-compose-collection-id": composeCollectionId }
            : {})}
        >
          <ComposeFeatherIcon class="site-mobile-compose-fab-icon" />
        </button>
      )}

      {isHomePage && siteFooterHtml && (
        <footer class="site-footer" data-footer>
          <div class="site-container">
            <div
              class="prose"
              dangerouslySetInnerHTML={{ __html: siteFooterHtml }}
            />
          </div>
        </footer>
      )}
      {showHomeBranding && <HomePageBranding />}

      <jant-media-lightbox />
      <jant-text-preview />
      {isAuthenticated && (
        <jant-post-menu
          languages={JSON.stringify(composeLanguages ?? []).replace(
            /</g,
            "\\u003c",
          )}
        />
      )}
      {isAuthenticated && showComposeDialog && (
        <ComposeDialog
          collections={collections}
          uploadMaxFileSize={uploadMaxFileSize}
          slashCommandDiscovered={slashCommandDiscovered}
          languages={composeLanguages}
          contextLanguage={composeContextLanguage}
        />
      )}
    </div>
  );
};
