/**
 * Site Layout
 *
 * Vertical header: site name on top, custom nav links below, description under nav.
 * Content area with browse filter tabs and compose prompt/dialog for authenticated users.
 */

import type { FC, PropsWithChildren } from "hono/jsx";
import { useLingui } from "@lingui/react/macro";
import type { NavItemView, SiteLayoutProps } from "../../types.js";
import { ComposeDialog } from "../compose/ComposeDialog.js";
import { ComposePrompt } from "../compose/ComposePrompt.js";

function HeaderLink({ link }: { link: NavItemView }) {
  return (
    <a
      href={link.url}
      class={`site-header-link ${link.isActive ? "site-header-link-active" : ""}`}
      {...(link.isExternal
        ? { target: "_blank", rel: "noopener noreferrer" }
        : {})}
    >
      {link.label}
    </a>
  );
}

export const SiteLayout: FC<PropsWithChildren<SiteLayoutProps>> = ({
  siteName,
  siteDescription,
  links,
  currentPath,
  isAuthenticated,
  collections,
  homeDefaultView,
  siteAvatarUrl,
  showHeaderAvatar,
  siteFooterHtml,
  sidebar,
  children,
}) => {
  const { t } = useLingui();

  const latestHref = homeDefaultView === "featured" ? "/latest" : "/";
  const featuredHref = homeDefaultView === "featured" ? "/" : "/featured";

  const latestLink = {
    href: latestHref,
    label: t({
      message: "Latest",
      comment: "@context: Browse filter for latest posts",
    }),
  };
  const featuredLink = {
    href: featuredHref,
    label: t({
      message: "Featured",
      comment: "@context: Browse filter for featured posts",
    }),
  };

  // Default view tab comes first
  const browseLinks =
    homeDefaultView === "featured"
      ? [featuredLink, latestLink]
      : [latestLink, featuredLink];

  const searchLabel = t({
    message: "Search",
    comment: "@context: Search icon link in browse nav",
  });

  const isHomePage =
    currentPath === "/" ||
    currentPath === "/featured" ||
    currentPath === "/latest";

  const maxVisibleLinks = 4;
  const primaryLinks = links.slice(0, maxVisibleLinks);
  const overflowLinks = links.slice(maxVisibleLinks);

  return (
    <div class="site-page">
      <header class={`site-header ${sidebar ? "site-header-sidebar" : ""}`}>
        <div class="site-header-bar">
          <a href="/" class="site-logo">
            {showHeaderAvatar && siteAvatarUrl && (
              <img src={siteAvatarUrl} class="site-logo-avatar" alt="" />
            )}
            {siteName}
          </a>
          <div class="site-header-right">
            {primaryLinks.length > 0 && (
              <nav class="site-header-nav">
                {primaryLinks.map((link) => (
                  <HeaderLink key={link.id} link={link} />
                ))}
              </nav>
            )}
            {overflowLinks.length > 0 && (
              <div class="site-header-more">
                <button
                  class="site-header-more-btn"
                  aria-label={t({
                    message: "More",
                    comment: "@context: Button to show overflow nav links",
                  })}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <circle cx="12" cy="12" r="1" />
                    <circle cx="19" cy="12" r="1" />
                    <circle cx="5" cy="12" r="1" />
                  </svg>
                </button>
                <div class="site-header-more-menu">
                  {overflowLinks.map((link) => (
                    <HeaderLink key={link.id} link={link} />
                  ))}
                </div>
              </div>
            )}
            <a
              href="/search"
              class={`site-header-search ${currentPath === "/search" ? "site-header-search-active" : ""}`}
              aria-label={searchLabel}
              title={searchLabel}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
            </a>
          </div>
        </div>
      </header>

      <main class="site-main">
        {sidebar ? (
          <div class="container-sidebar">
            <div class="sidebar-layout">
              <aside class="sidebar-nav">{sidebar}</aside>
              <div class="sidebar-main">
                <div class="site-content">{children}</div>
              </div>
            </div>
          </div>
        ) : (
          <div class="site-container">
            <div class="site-content">
              {isHomePage && (
                <nav class="site-browse-nav">
                  {browseLinks.map((link) => (
                    <a
                      key={link.href}
                      href={link.href}
                      class={`site-browse-link ${currentPath === link.href ? "site-browse-link-active" : ""}`}
                    >
                      {link.label}
                    </a>
                  ))}
                </nav>
              )}
              {isHomePage && isAuthenticated && <ComposePrompt />}
              {children}
            </div>
          </div>
        )}
      </main>

      {siteFooterHtml && (
        <footer
          class={`site-footer ${sidebar ? "site-footer-sidebar" : ""}`}
          data-footer
        >
          <div class="site-container">
            <div
              class="prose"
              dangerouslySetInnerHTML={{ __html: siteFooterHtml }}
            />
          </div>
        </footer>
      )}

      {isAuthenticated && <ComposeDialog collections={collections} />}
    </div>
  );
};
