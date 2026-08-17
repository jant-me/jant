/**
 * Account settings sub-menu — lists security, data, and destructive actions
 */

import { msg } from "@lingui/core/macro";
import { coalesceDisplayText } from "../../../lib/display-text.js";
import { useLingui } from "../../../i18n/context.js";
import { getJantDocsUrl } from "../../../lib/jant-docs.js";
import { extractDomain, toPublicPath } from "../../../lib/url.js";
import { CORE_VERSION } from "../../../lib/version.js";
import {
  SettingsDirectoryItemContent,
  SettingsDirectoryLink,
  SettingsDirectorySection,
} from "./SettingsDirectory.js";

const BACKUPS_DOCS_URL = getJantDocsUrl("backups");
const GITHUB_COMMIT_BASE = "https://github.com/jant-me/jant/tree";

const ICONS = {
  monitor: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>`,
  lock: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  user: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  download: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`,
  book: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M3 18V5a2 2 0 0 1 2-2h6v18H5a2 2 0 0 1-2-2Z"/><path d="M21 18V5a2 2 0 0 0-2-2h-7v18h7a2 2 0 0 0 2-2Z"/></svg>`,
  trash: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
};

export function AccountMenuContent({
  sitePathPrefix = "",
  demoMode = false,
  hostedControlPlaneAccountUrl,
  hostedControlPlaneProviderLabel,
}: {
  sitePathPrefix?: string;
  demoMode?: boolean;
  hostedControlPlaneAccountUrl?: string | null;
  hostedControlPlaneProviderLabel?: string | null;
}) {
  const { i18n } = useLingui();
  const isHosted = Boolean(hostedControlPlaneAccountUrl);
  const accountDomain = hostedControlPlaneAccountUrl
    ? extractDomain(hostedControlPlaneAccountUrl)
    : undefined;
  const providerLabel =
    coalesceDisplayText(hostedControlPlaneProviderLabel, accountDomain) ??
    i18n._(
      msg({
        message: "Hosted account",
        comment:
          "@context: Generic hosted auth provider label when no explicit provider name is configured",
      }),
    );
  const hostedIntroText = isHosted
    ? i18n._(
        msg({
          message:
            "Manage this site's active sessions here. Password and hosted access are managed through {providerLabel}.",
          comment:
            "@context: Intro text on the hosted account settings menu page below the title",
        }),
        {
          providerLabel,
        },
      )
    : i18n._(
        msg({
          message:
            "Manage sign-in security, site exports, and irreversible actions.",
          comment:
            "@context: Intro text on the account settings menu page below the title",
        }),
      );
  const hostedAlertText =
    isHosted && hostedControlPlaneAccountUrl
      ? i18n._(
          msg({
            message:
              "This hosted site signs in through {providerLabel}. Manage password and hosted access there.",
            comment:
              "@context: Notice shown on hosted account settings explaining that password and hosted account controls live in the connected hosted auth provider",
          }),
          {
            providerLabel,
          },
        )
      : null;
  const hostedManageDescription =
    isHosted && hostedControlPlaneAccountUrl
      ? i18n._(
          msg({
            message: "Manage password and hosted access in {providerLabel}",
            comment:
              "@context: Settings item description for hosted account management in the connected provider",
          }),
          {
            providerLabel,
          },
        )
      : null;

  return (
    <div class="settings-root">
      <header class="page-intro">
        <h1 class="page-intro-title page-intro-title-compact">
          {i18n._(
            msg({
              message: "Account & Data",
              comment: "@context: Page title for the account settings menu",
            }),
          )}
        </h1>
        <p class="page-intro-description">{hostedIntroText}</p>
      </header>

      {isHosted && hostedControlPlaneAccountUrl && (
        <div class="alert" role="alert">
          <section>
            <p>{hostedAlertText}</p>
          </section>
        </div>
      )}

      {demoMode && (
        <div class="alert" role="alert">
          <section>
            <p>
              {i18n._(
                msg({
                  message:
                    "Demo mode hides sessions, password changes, and account deletion. Export still works.",
                  comment:
                    "@context: Notice shown on the account page when demo restrictions are enabled",
                }),
              )}
            </p>
          </section>
        </div>
      )}

      {!demoMode && (
        <SettingsDirectorySection
          title={i18n._(
            msg({
              message: "Security",
              comment:
                "@context: Settings group label for account security settings",
            }),
          )}
        >
          <SettingsDirectoryLink
            href={toPublicPath("/settings/account/sessions", sitePathPrefix)}
            icon={ICONS.monitor}
            tone="subtle"
            name={i18n._(
              msg({
                message: "Sessions",
                comment: "@context: Settings item — session management",
              }),
            )}
            description={i18n._(
              msg({
                message: "See where you're signed in and revoke old sessions",
                comment: "@context: Settings item description for sessions",
              }),
            )}
          />
          {isHosted && hostedControlPlaneAccountUrl ? (
            <SettingsDirectoryLink
              href={hostedControlPlaneAccountUrl}
              icon={ICONS.user}
              tone="subtle"
              name={i18n._(
                msg({
                  message: "Manage Account",
                  comment:
                    "@context: Settings item label for opening the hosted account management page",
                }),
              )}
              description={hostedManageDescription ?? ""}
            />
          ) : (
            <SettingsDirectoryLink
              href={toPublicPath("/settings/account/password", sitePathPrefix)}
              icon={ICONS.lock}
              tone="subtle"
              name={i18n._(
                msg({
                  message: "Password",
                  comment: "@context: Settings item — password settings",
                }),
              )}
              description={i18n._(
                msg({
                  message: "Update the password you use to sign in",
                  comment:
                    "@context: Settings item description for password change",
                }),
              )}
            />
          )}
        </SettingsDirectorySection>
      )}

      <SettingsDirectorySection
        title={i18n._(
          msg({
            message: "Data",
            comment: "@context: Settings group label for data export/import",
          }),
        )}
      >
        <form
          method="post"
          action={toPublicPath("/api/export/hugo", sitePathPrefix)}
          class="settings-export-form"
        >
          <button
            type="submit"
            class="settings-directory-item"
            data-tone="subtle"
          >
            <SettingsDirectoryItemContent
              icon={ICONS.download}
              name={i18n._(
                msg({
                  message: "Export Site",
                  comment:
                    "@context: Settings item — export the site as a Hugo archive",
                }),
              )}
              description={i18n._(
                msg({
                  message:
                    "Download a Hugo-compatible archive — host it statically or move to another Jant.",
                  comment:
                    "@context: Settings item description for static site export",
                }),
              )}
            />
          </button>
        </form>
        <SettingsDirectoryLink
          href={BACKUPS_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          icon={ICONS.book}
          tone="subtle"
          name={i18n._(
            msg({
              message: "Backup & Restore Guide",
              comment:
                "@context: Link to backup and restore documentation from account settings",
            }),
          )}
          description={i18n._(
            msg({
              message:
                "When to use site export, database backups, and recovery drills.",
              comment:
                "@context: Description for backup and restore documentation link in account settings",
            }),
          )}
        />
      </SettingsDirectorySection>

      {!demoMode && !isHosted && (
        <SettingsDirectorySection
          title={i18n._(
            msg({
              message: "Danger Zone",
              comment:
                "@context: Settings group label for destructive account actions",
            }),
          )}
          tone="danger"
        >
          <SettingsDirectoryLink
            href={toPublicPath(
              "/settings/account/delete-account",
              sitePathPrefix,
            )}
            icon={ICONS.trash}
            tone="danger"
            name={i18n._(
              msg({
                message: "Delete Account",
                comment:
                  "@context: Settings item — delete account and all data",
              }),
            )}
            description={i18n._(
              msg({
                message: "Permanently delete all data and reset the blog",
                comment:
                  "@context: Settings item description for account deletion",
              }),
            )}
          />
        </SettingsDirectorySection>
      )}

      <p class="settings-root-version">
        {(() => {
          const idx = CORE_VERSION.indexOf("-");
          if (idx === -1) return `Build ${CORE_VERSION}`;
          const semver = CORE_VERSION.slice(0, idx);
          const buildId = CORE_VERSION.slice(idx + 1);
          return (
            <>
              {"Build "}
              {semver}
              {" · "}
              <a
                href={`${GITHUB_COMMIT_BASE}/${buildId}`}
                target="_blank"
                rel="noopener noreferrer"
                class="settings-root-version-link"
              >
                {buildId}
              </a>
            </>
          );
        })()}
      </p>
    </div>
  );
}
