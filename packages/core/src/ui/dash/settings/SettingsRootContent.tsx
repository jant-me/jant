/**
 * Settings root page — spacious card directory linking to sub-pages
 */

import { msg } from "@lingui/core/macro";
import { coalesceDisplayText } from "../../../lib/display-text.js";
import { useLingui } from "../../../i18n/context.js";
import { extractDomain, toPublicPath } from "../../../lib/url.js";
import type { SiteNotice } from "../../../types.js";
import {
  SettingsDirectoryLink,
  SettingsDirectorySection,
} from "./SettingsDirectory.js";

// Pick the best string from a control-plane notice locale map for the active
// dashboard locale: exact tag → same base language (e.g. zh-Hant → zh-Hans,
// en → en-US) → English → first available. Core does not author these strings;
// it only selects one, so the control plane stays free to ship its own locales.
function pickNoticeText(map: Record<string, string>, locale: string): string {
  if (map[locale]) {
    return map[locale];
  }
  const base = locale.split("-")[0];
  for (const [key, value] of Object.entries(map)) {
    if (key === base || key.split("-")[0] === base) {
      return value;
    }
  }
  return map["en-US"] ?? map.en ?? Object.values(map)[0] ?? "";
}

// Lucide icon SVG paths (16x16, stroke-based)
const ICONS = {
  settings: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
  image: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
  menu: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>`,
  palette: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>`,
  type: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/></svg>`,
  code: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  terminal: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>`,
  arrowRightLeft: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/></svg>`,
  lock: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  key: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/></svg>`,
  shield: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>`,
  gitBranch: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>`,
  send: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></svg>`,
  cloud: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`,
};

export function SettingsRootContent({
  sitePathPrefix = "",
  demoMode = false,
  hostedControlPlaneSiteSettingsUrl,
  hostedControlPlaneProviderLabel,
  notice = null,
}: {
  sitePathPrefix?: string;
  demoMode?: boolean;
  hostedControlPlaneSiteSettingsUrl?: string | null;
  hostedControlPlaneProviderLabel?: string | null;
  notice?: SiteNotice | null;
}) {
  const { i18n } = useLingui();
  const noticeMessage = notice
    ? pickNoticeText(notice.message, i18n.locale)
    : "";
  const noticeAction =
    notice?.actionUrl && notice.actionLabel
      ? {
          href: notice.actionUrl,
          label: pickNoticeText(notice.actionLabel, i18n.locale),
        }
      : null;
  const accountDescription = demoMode
    ? i18n._(
        msg({
          message: "Demo limits",
          comment:
            "@context: Settings item description for account settings on the settings home page when demo restrictions are enabled",
        }),
      )
    : i18n._(
        msg({
          message: "Sessions and password",
          comment:
            "@context: Settings item description for account settings on the settings home page",
        }),
      );
  const hostingProviderLabel = hostedControlPlaneSiteSettingsUrl
    ? (coalesceDisplayText(
        hostedControlPlaneProviderLabel,
        extractDomain(hostedControlPlaneSiteSettingsUrl),
      ) ??
      i18n._(
        msg({
          message: "Hosted account",
          comment:
            "@context: Generic hosted auth provider label when no explicit provider name is configured",
        }),
      ))
    : null;

  return (
    <div class="settings-root">
      {notice && noticeMessage ? (
        <div
          role="note"
          class={`alert${notice.severity === "urgent" ? " alert-destructive" : ""} mb-6`}
          style="display:flex;gap:.75rem;align-items:center;justify-content:space-between"
        >
          <span>{noticeMessage}</span>
          {noticeAction ? (
            <a href={noticeAction.href} class="btn-sm-outline shrink-0">
              {noticeAction.label}
            </a>
          ) : null}
        </div>
      ) : null}
      <header class="page-intro">
        <h1 class="page-intro-title">
          {i18n._(
            msg({
              message: "Settings",
              comment: "@context: Page title for the settings home page",
            }),
          )}
        </h1>
        <p class="page-intro-description">
          {i18n._(
            msg({
              message: "Tune how your site looks, reads, and runs.",
              comment:
                "@context: Intro text on the settings home page below the title",
            }),
          )}
        </p>
      </header>

      <SettingsDirectorySection
        title={i18n._(
          msg({
            message: "Site",
            comment: "@context: Settings group label for site settings",
          }),
        )}
      >
        <SettingsDirectoryLink
          href={toPublicPath("/settings/general", sitePathPrefix)}
          icon={ICONS.settings}
          tone="subtle"
          name={i18n._(
            msg({
              message: "General",
              comment: "@context: Settings item — general settings",
            }),
          )}
          description={i18n._(
            msg({
              message: "Name, metadata, language, and search defaults",
              comment: "@context: Settings item description for general",
            }),
          )}
        />
        <SettingsDirectoryLink
          href={toPublicPath("/settings/custom-urls", sitePathPrefix)}
          icon={ICONS.arrowRightLeft}
          tone="subtle"
          name={i18n._(
            msg({
              message: "Custom URLs",
              comment: "@context: Settings item — custom URL settings",
            }),
          )}
          description={i18n._(
            msg({
              message: "Redirects, vanity paths, and URL control",
              comment: "@context: Settings item description for custom URLs",
            }),
          )}
        />
      </SettingsDirectorySection>

      <SettingsDirectorySection
        title={i18n._(
          msg({
            message: "Appearance",
            comment: "@context: Settings group label for design settings",
          }),
        )}
      >
        <SettingsDirectoryLink
          href={toPublicPath("/settings/avatar", sitePathPrefix)}
          icon={ICONS.image}
          name={i18n._(
            msg({
              message: "Avatar",
              comment: "@context: Settings item — avatar settings",
            }),
          )}
          description={i18n._(
            msg({
              message: "Favicon and the profile mark in your header",
              comment: "@context: Settings item description for avatar",
            }),
          )}
        />
        <SettingsDirectoryLink
          href={toPublicPath("/settings/navigation", sitePathPrefix)}
          icon={ICONS.menu}
          name={i18n._(
            msg({
              message: "Navigation",
              comment: "@context: Settings item — navigation settings",
            }),
          )}
          description={i18n._(
            msg({
              message: "Header links, home feed, and overflow menu",
              comment: "@context: Settings item description for navigation",
            }),
          )}
        />
        <SettingsDirectoryLink
          href={toPublicPath("/settings/color-theme", sitePathPrefix)}
          icon={ICONS.palette}
          name={i18n._(
            msg({
              message: "Color Theme",
              comment: "@context: Settings item — color theme settings",
            }),
          )}
          description={i18n._(
            msg({
              message: "Palette, surface tone, and overall mood",
              comment: "@context: Settings item description for color theme",
            }),
          )}
        />
        <SettingsDirectoryLink
          href={toPublicPath("/settings/font-theme", sitePathPrefix)}
          icon={ICONS.type}
          tone="subtle"
          name={i18n._(
            msg({
              message: "Font Theme",
              comment: "@context: Settings item — font theme settings",
            }),
          )}
          description={i18n._(
            msg({
              message: "Typography choices and reading texture",
              comment: "@context: Settings item description for font theme",
            }),
          )}
        />
        <SettingsDirectoryLink
          href={toPublicPath("/settings/custom-css", sitePathPrefix)}
          icon={ICONS.code}
          tone="subtle"
          name={i18n._(
            msg({
              message: "Custom CSS",
              comment: "@context: Settings item — custom CSS settings",
            }),
          )}
          description={i18n._(
            msg({
              message: "Fine-grained styling overrides",
              comment: "@context: Settings item description for custom CSS",
            }),
          )}
        />
      </SettingsDirectorySection>

      <SettingsDirectorySection
        title={i18n._(
          msg({
            message: "Integrations",
            comment:
              "@context: Settings group label for third-party integrations",
          }),
        )}
      >
        <SettingsDirectoryLink
          href={toPublicPath("/settings/github-sync", sitePathPrefix)}
          icon={ICONS.gitBranch}
          tone="subtle"
          name={i18n._(
            msg({
              message: "GitHub Sync",
              comment: "@context: Settings item — GitHub sync settings",
            }),
          )}
          description={i18n._(
            msg({
              message: "Back up and sync content with a GitHub repository",
              comment: "@context: Settings item description for GitHub sync",
            }),
          )}
        />
        <SettingsDirectoryLink
          href={toPublicPath("/settings/telegram", sitePathPrefix)}
          icon={ICONS.send}
          tone="subtle"
          name={i18n._(
            msg({
              message: "Telegram",
              comment:
                "@context: Settings item — Telegram integration settings",
            }),
          )}
          description={i18n._(
            msg({
              message: "Post notes by messaging a Telegram bot",
              comment:
                "@context: Settings item description for Telegram integration",
            }),
          )}
        />
      </SettingsDirectorySection>

      <SettingsDirectorySection
        title={i18n._(
          msg({
            message: "Advanced",
            comment: "@context: Settings group label for advanced settings",
          }),
        )}
      >
        <SettingsDirectoryLink
          href={toPublicPath("/settings/code-injection", sitePathPrefix)}
          icon={ICONS.terminal}
          tone="subtle"
          name={i18n._(
            msg({
              message: "Code Injection",
              comment: "@context: Settings item — code injection settings",
            }),
          )}
          description={i18n._(
            msg({
              message: "Site-wide HTML for analytics and widgets",
              comment: "@context: Settings item description for code injection",
            }),
          )}
        />
        <SettingsDirectoryLink
          href={toPublicPath("/settings/api-tokens", sitePathPrefix)}
          icon={ICONS.key}
          tone="subtle"
          name={i18n._(
            msg({
              message: "API Tokens",
              comment: "@context: Settings item — API token settings",
            }),
          )}
          description={i18n._(
            msg({
              message: "Bearer tokens for scripts and automation",
              comment: "@context: Settings item description for API tokens",
            }),
          )}
        />
      </SettingsDirectorySection>

      <SettingsDirectorySection
        title={i18n._(
          msg({
            message: "Account",
            comment: "@context: Settings group label for account settings",
          }),
        )}
      >
        <SettingsDirectoryLink
          href={toPublicPath("/settings/account", sitePathPrefix)}
          icon={ICONS.shield}
          tone="subtle"
          name={i18n._(
            msg({
              message: "Account",
              comment: "@context: Settings item — account settings",
            }),
          )}
          description={accountDescription}
        />
        {hostedControlPlaneSiteSettingsUrl && hostingProviderLabel ? (
          <SettingsDirectoryLink
            href={hostedControlPlaneSiteSettingsUrl}
            target="_blank"
            rel="noopener noreferrer"
            icon={ICONS.cloud}
            tone="subtle"
            name={i18n._(
              msg({
                message: "Manage Hosting",
                comment:
                  "@context: Settings item label for opening this site's hosted management page (domains, plan, billing) in the connected control plane",
              }),
            )}
            description={i18n._(
              msg({
                message: "Domains, plan, and billing in {providerLabel}",
                comment:
                  "@context: Settings item description for the hosted site management external link",
              }),
              {
                providerLabel: hostingProviderLabel,
              },
            )}
          />
        ) : null}
      </SettingsDirectorySection>

      <div class="settings-root-signout">
        <button
          type="button"
          data-on:click__prevent={`@post('${toPublicPath("/signout", sitePathPrefix)}')`}
          class="settings-root-signout-btn"
        >
          {i18n._(
            msg({
              message: "Sign Out",
              comment: "@context: Settings link — sign out action",
            }),
          )}
        </button>
      </div>
    </div>
  );
}
