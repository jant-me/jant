/**
 * Settings Routes
 *
 * Unified settings hub — root page with iOS-style grouped list,
 * plus sub-pages for General, Avatar, Navigation, Color Theme,
 * Font Theme, Custom CSS, Account (Sessions + Password), and API Tokens.
 */

import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { msg } from "@lingui/core/macro";
import { z } from "zod";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { sse, dsRedirect, dsToast } from "../../lib/sse.js";
import { getI18n, isLocale, resolveCatalogLocale } from "../../i18n/index.js";
import { renderPublicPage } from "../../lib/render.js";
import { getNavigationData } from "../../lib/navigation.js";
import { buildPageTitle } from "../../lib/page-title.js";
import { AdminBreadcrumb } from "../../ui/shared/AdminBreadcrumb.js";
import { getTimeZoneOptions } from "../../lib/timezones.js";
import { getOrBuildEntry } from "../../i18n/supported-locales.js";
import {
  DomainError,
  LanguageInUseError,
  ValidationError,
} from "../../lib/errors.js";
import { SETTINGS_KEYS } from "../../lib/constants.js";
import { getAvailableThemes } from "../../lib/theme.js";
import { THEME_MODES, type ThemeMode } from "../../types/config.js";
import { BUILTIN_FONT_THEMES } from "../../ui/font-themes.js";
import { SettingsRootContent } from "../../ui/dash/settings/SettingsRootContent.js";
import { GeneralContent } from "../../ui/dash/settings/GeneralContent.js";
import { LanguageContent } from "../../ui/dash/settings/LanguageContent.js";
import { AvatarContent } from "../../ui/dash/settings/AvatarContent.js";
import { AccountMenuContent } from "../../ui/dash/settings/AccountMenuContent.js";
import { AccountContent } from "../../ui/dash/settings/AccountContent.js";
import {
  SessionsContent,
  type SessionInfo,
} from "../../ui/dash/settings/SessionsContent.js";
import { NavigationContent } from "../../ui/dash/appearance/NavigationContent.js";
import { ColorThemeContent } from "../../ui/dash/appearance/ColorThemeContent.js";
import { FontThemeContent } from "../../ui/dash/appearance/FontThemeContent.js";
import { AdvancedContent } from "../../ui/dash/appearance/AdvancedContent.js";
import { CodeInjectionContent } from "../../ui/dash/appearance/CodeInjectionContent.js";
import { ApiTokensContent } from "../../ui/dash/settings/ApiTokensContent.js";
import { ConfigEditorContent } from "../../ui/dash/settings/ConfigEditorContent.js";
import { DeleteAccountContent } from "../../ui/dash/settings/DeleteAccountContent.js";
import {
  GitHubSyncContent,
  type GitHubSyncStatus,
} from "../../ui/dash/settings/GitHubSyncContent.js";
import {
  readTelegramSettingsView,
  renderTelegramContentHtml,
  getTelegramStatusStreamUrl,
} from "../../lib/telegram-settings-status.js";
import { TelegramContent } from "../../ui/dash/settings/TelegramContent.js";
import { toAbsoluteSiteUrl, toPublicPath } from "../../lib/url.js";
import {
  ContentLanguageSchema,
  parseValidated,
  UpdateSiteSettingsSchema,
} from "../../lib/schemas.js";
import {
  getHostedControlPlaneAccountPasswordUrl,
  getHostedControlPlaneAccountUrl,
  getHostedControlPlaneProviderLabel,
  getHostedControlPlaneSiteDeleteUrl,
  getHostedControlPlaneSiteSettingsUrl,
} from "../../lib/hosted-signin.js";
import { syncHostedControlPlaneSiteAvatar } from "../../lib/hosted-control-plane-sync.js";
import {
  getGitHubAppConfig,
  getHostedControlPlaneSsoSecret,
  getTelegramBotPool,
} from "../../lib/env.js";
import {
  buildInstallUrl,
  getInstallation,
  listInstallationReposPage,
  searchInstallationRepos,
} from "../../lib/github-app.js";
import {
  isSyncPending,
  markSyncPending,
  runBackgroundSync,
  triggerGitHubSyncInline,
} from "../../lib/github-sync-trigger.js";
import { buildSyncSiteConfig } from "../../lib/github-sync-site-config.js";
import { buildConfigEditorFields } from "../../lib/api-settings.js";
import {
  readGitHubSyncStatus,
  renderStatusCardHtml,
  getSyncStatusStreamUrl,
} from "../../lib/github-sync-status.js";
import {
  generateInstallNonce,
  signInstallState,
  verifyInstallState,
} from "../../lib/github-app-state.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const settingsRoutes = new Hono<Env>();

const UpdateTimeSettingsSchema = z.object({
  timeZone: z.string(),
});

// Both fields are optional: the language page saves one control at a time, and
// an absent field means "leave it alone" rather than "clear it".
const UpdateLanguageSettingsSchema = z.object({
  contentLanguage: ContentLanguageSchema.optional(),
  dashboardLanguage: z.string().optional(),
});

const LanguageTagSchema = z.object({
  language: ContentLanguageSchema,
});

const EnableMultilingualSchema = z.object({
  primary: ContentLanguageSchema,
  additional: z.array(ContentLanguageSchema),
});

const UpdateFeedSettingsSchema = z.object({
  mainRssFeed: z.enum(["featured", "latest"]),
});

const UpdateHomeSettingsSchema = z.object({
  showJantBrandingOnHome: z.boolean(),
});

const UpdateSearchSettingsSchema = z.object({
  allowIndexing: z.boolean(),
});

function publicPath(c: Context<Env>, path: string): string {
  return toPublicPath(path, c.var.appConfig.sitePathPrefix);
}

function aboutEditPath(c: Context<Env>): string {
  return `${publicPath(c, "/about")}?edit=1`;
}

/**
 * Breadcrumb labels for admin settings pages.
 *
 * These duplicate labels defined in the corresponding UI components (e.g.
 * `SettingsRootContent`, `AccountMenuContent`) on purpose: Lingui hashes are
 * computed from `message` alone, so identical text produces the same catalog
 * entry and shares the translation. Keep the text in sync with the UI source
 * of truth.
 */
function breadcrumbLabel(
  c: Context<Env>,
  key:
    | "settings"
    | "general"
    | "language"
    | "avatar"
    | "navigation"
    | "colorTheme"
    | "fontTheme"
    | "customCss"
    | "codeInjection"
    | "config"
    | "account"
    | "sessions"
    | "password"
    | "deleteAccount"
    | "apiTokens"
    | "githubSync"
    | "telegram",
): string {
  const i18n = getI18n(c);
  switch (key) {
    case "settings":
      return i18n._(
        msg({ message: "Settings", comment: "@context: Breadcrumb label" }),
      );
    case "general":
      return i18n._(
        msg({ message: "General", comment: "@context: Breadcrumb label" }),
      );
    case "language":
      return i18n._(
        msg({ message: "Language", comment: "@context: Breadcrumb label" }),
      );
    case "avatar":
      return i18n._(
        msg({ message: "Avatar", comment: "@context: Breadcrumb label" }),
      );
    case "navigation":
      return i18n._(
        msg({ message: "Navigation", comment: "@context: Breadcrumb label" }),
      );
    case "colorTheme":
      return i18n._(
        msg({ message: "Color Theme", comment: "@context: Breadcrumb label" }),
      );
    case "fontTheme":
      return i18n._(
        msg({ message: "Font Theme", comment: "@context: Breadcrumb label" }),
      );
    case "customCss":
      return i18n._(
        msg({ message: "Custom CSS", comment: "@context: Breadcrumb label" }),
      );
    case "codeInjection":
      return i18n._(
        msg({
          message: "Code Injection",
          comment: "@context: Breadcrumb label",
        }),
      );
    case "config":
      return i18n._(
        msg({
          message: "Config Editor",
          comment: "@context: Breadcrumb label",
        }),
      );
    case "account":
      return i18n._(
        msg({
          message: "Account & Data",
          comment: "@context: Breadcrumb label",
        }),
      );
    case "sessions":
      return i18n._(
        msg({ message: "Sessions", comment: "@context: Breadcrumb label" }),
      );
    case "password":
      return i18n._(
        msg({ message: "Password", comment: "@context: Breadcrumb label" }),
      );
    case "deleteAccount":
      return i18n._(
        msg({
          message: "Delete Account",
          comment: "@context: Breadcrumb label",
        }),
      );
    case "apiTokens":
      return i18n._(
        msg({ message: "API Tokens", comment: "@context: Breadcrumb label" }),
      );
    case "githubSync":
      return i18n._(
        msg({ message: "GitHub Sync", comment: "@context: Breadcrumb label" }),
      );
    case "telegram":
      return i18n._(
        msg({ message: "Telegram", comment: "@context: Breadcrumb label" }),
      );
  }
}

type DemoRestriction = "sessions" | "password" | "accountDeletion";

function getDemoRestrictionMessage(
  c: Context<Env>,
  restriction: DemoRestriction,
): string {
  const i18n = getI18n(c);

  switch (restriction) {
    case "sessions":
      return i18n._(
        msg({
          message:
            "Session management is off in demo mode. Use the shared demo session instead.",
          comment:
            "@context: Error shown when session management is blocked in demo mode",
        }),
      );
    case "password":
      return i18n._(
        msg({
          message:
            "Password changes are off in demo mode. Sign in with the shared demo credentials.",
          comment:
            "@context: Error shown when password changes are blocked in demo mode",
        }),
      );
    case "accountDeletion":
      return i18n._(
        msg({
          message:
            "Account deletion is off in demo mode. The shared demo resets separately.",
          comment:
            "@context: Error shown when account deletion is blocked in demo mode",
        }),
      );
  }
}

function demoRestrictionResponse(c: Context<Env>, message: string): Response {
  const wantsJson = c.req.header("accept")?.includes("application/json");
  if (wantsJson) {
    return c.json({ error: message, code: "FORBIDDEN" }, 403);
  }
  return dsToast(message, "error");
}

// ===========================================================================
// Settings root — iOS-style grouped list
// ===========================================================================

settingsRoutes.get("/", async (c) => {
  const navData = await getNavigationData(c);
  const hostedControlPlaneSiteSettingsUrl =
    getHostedControlPlaneSiteSettingsUrl(c.env, c.var.currentSite.id);
  const hostedControlPlaneProviderLabel = getHostedControlPlaneProviderLabel(
    c.env,
  );

  return renderPublicPage(c, {
    title: buildPageTitle("Settings", navData.siteName),
    navData,
    content: (
      <div class="py-6">
        <SettingsRootContent
          sitePathPrefix={c.var.appConfig.sitePathPrefix}
          demoMode={c.var.appConfig.demoMode}
          hostedControlPlaneSiteSettingsUrl={hostedControlPlaneSiteSettingsUrl}
          hostedControlPlaneProviderLabel={hostedControlPlaneProviderLabel}
        />
      </div>
    ),
  });
});

// ===========================================================================
// General settings
// ===========================================================================

settingsRoutes.get("/general", async (c) => {
  const { allSettings, appConfig } = c.var;

  const dbSiteName = allSettings["SITE_NAME"] ?? "";
  const dbSiteDescription = allSettings["SITE_DESCRIPTION"] ?? "";

  const saved = c.req.query("saved") !== undefined;
  const [navData, aboutPage] = await Promise.all([
    getNavigationData(c),
    c.var.services.aboutPage.getStatus(),
  ]);
  const siteUrlForDisplay =
    appConfig.siteUrl || new URL(publicPath(c, "/"), c.req.url).toString();

  return renderPublicPage(c, {
    title: buildPageTitle("General", navData.siteName),
    navData,
    toast: saved ? { message: "Settings updated." } : undefined,
    content: (
      <>
        <AdminBreadcrumb
          parent={breadcrumbLabel(c, "settings")}
          parentHref={publicPath(c, "/settings")}
          current={breadcrumbLabel(c, "general")}
        />
        <GeneralContent
          siteName={dbSiteName || ""}
          siteDescription={dbSiteDescription || ""}
          siteNameFallback={appConfig.fallbacks.siteName}
          siteDescriptionFallback={appConfig.fallbacks.siteDescription}
          mainRssFeed={appConfig.mainRssFeed}
          mainFeedUrl={toAbsoluteSiteUrl(
            "/feed",
            siteUrlForDisplay,
            appConfig.sitePathPrefix,
          )}
          latestFeedUrl={toAbsoluteSiteUrl(
            "/latest/feed",
            siteUrlForDisplay,
            appConfig.sitePathPrefix,
          )}
          featuredFeedUrl={toAbsoluteSiteUrl(
            "/featured/feed",
            siteUrlForDisplay,
            appConfig.sitePathPrefix,
          )}
          archiveFeedUrl={toAbsoluteSiteUrl(
            "/archive/feed",
            siteUrlForDisplay,
            appConfig.sitePathPrefix,
          )}
          timeZone={appConfig.timeZone}
          siteFooter={appConfig.siteFooter}
          showJantBrandingOnHome={appConfig.showJantBrandingOnHome}
          noindex={appConfig.noindex}
          demoMode={appConfig.demoMode}
          timezones={getTimeZoneOptions(appConfig.timeZone)}
          aboutPage={aboutPage}
          aboutEditUrl={aboutEditPath(c)}
          aboutCreateUrl={publicPath(c, "/settings/general/about-page")}
        />
      </>
    ),
  });
});

settingsRoutes.post("/general", async (c) => {
  const i18n = getI18n(c);
  const body = parseValidated(UpdateSiteSettingsSchema, await c.req.json());
  const toast = i18n._(
    msg({
      message: "Site settings updated.",
      comment: "@context: Toast after saving site settings",
    }),
  );

  try {
    const { siteNameChanged } =
      await c.var.services.siteProfile.updateSiteSettings(
        body,
        {
          oldSiteName: c.var.allSettings["SITE_NAME"] ?? "",
          fallbackSiteName: c.var.appConfig.fallbacks.siteName,
        },
        {
          // better-auth requires user.name to stay aligned with the active
          // site display name for the current operator.
          updateCurrentUserName: async (nextDisplayName) => {
            await c.var.auth.api.updateUser({
              body: { name: nextDisplayName },
              headers: c.req.raw.headers,
            });
          },
        },
      );

    // ── JSON response mode (used by Lit settings bridge) ──────────────
    const wantsJson = c.req.header("accept")?.includes("application/json");
    if (wantsJson) {
      if (siteNameChanged) {
        return c.json({
          status: "redirect" as const,
          url: publicPath(c, "/settings/general?saved"),
        });
      }

      return c.json({
        status: "ok" as const,
        toast,
      });
    }

    if (siteNameChanged) {
      return dsRedirect(publicPath(c, "/settings/general?saved"));
    }

    return dsToast(toast);
  } catch (error) {
    if (error instanceof ValidationError) {
      const wantsJson = c.req.header("accept")?.includes("application/json");
      if (wantsJson) {
        return c.json({ error: error.message, code: error.code }, 400);
      }

      return dsToast(error.message, "error");
    }

    throw error;
  }
});

// Time zone only. Language moved to its own page, so this no longer sends —
// and must not clear — the language fields.
settingsRoutes.post("/general/time", async (c) => {
  const i18n = getI18n(c);
  const body = parseValidated(UpdateTimeSettingsSchema, await c.req.json());
  const toast = i18n._(
    msg({
      message: "Time zone updated.",
      comment: "@context: Toast after saving the time zone",
    }),
  );
  await c.var.services.settings.updateLocaleSettings(body, {
    oldLanguage: c.var.appConfig.siteLanguage,
  });

  const wantsJson = c.req.header("accept")?.includes("application/json");
  if (wantsJson) {
    return c.json({ status: "ok" as const, toast });
  }

  return dsToast(toast);
});

// ===========================================================================
// Language
//
// Every language setting lives on one page, and every write goes through the
// language service — the multilingual keys are DB-only precisely so this is the
// only door.
// ===========================================================================

settingsRoutes.get("/language", async (c) => {
  const { appConfig } = c.var;
  const navData = await getNavigationData(c);
  const [state, preview] = await Promise.all([
    c.var.services.language.getState(),
    c.var.services.language.getEnablePreview(),
  ]);

  return renderPublicPage(c, {
    title: buildPageTitle("Language", navData.siteName),
    navData,
    content: (
      <>
        <AdminBreadcrumb
          parent={breadcrumbLabel(c, "settings")}
          parentHref={publicPath(c, "/settings")}
          current={breadcrumbLabel(c, "language")}
        />
        <LanguageContent
          contentLanguage={state.primary}
          dashboardLanguage={
            isLocale(appConfig.dashboardLanguage)
              ? appConfig.dashboardLanguage
              : resolveCatalogLocale(state.primary)
          }
          multilingualEnabled={state.enabled}
          additionalLanguages={state.additional}
          unmarkedPostCount={preview.pendingCount}
          sitePathPrefix={appConfig.sitePathPrefix}
        />
      </>
    ),
  });
});

/**
 * Run a language mutation and report it as JSON.
 *
 * Every language endpoint has the same shape — do the thing, or explain in one
 * sentence why it could not be done — so they share one wrapper rather than
 * repeating the try/catch.
 */
async function respondToLanguageAction(
  c: Context<Env>,
  toast: string,
  action: () => Promise<void>,
): Promise<Response> {
  try {
    await action();
    return c.json({ status: "ok" as const, toast });
  } catch (error) {
    // The one refusal an author will actually meet — removing or dropping a
    // language that posts still use — gets a localized sentence naming the
    // language; the settings page pairs it with a link to those posts.
    if (error instanceof LanguageInUseError) {
      const i18n = getI18n(c);
      return c.json(
        {
          error: i18n._(
            msg({
              message:
                "{count, plural, one {# post is} other {# posts are}} still written in {language}. Change their language, or keep the language.",
              comment:
                "@context: Error when a content language that posts still use would be dropped",
            }),
            {
              count: error.postCount,
              language: getOrBuildEntry(error.language).native,
            },
          ),
          code: error.code,
          language: error.language,
        },
        400,
      );
    }
    if (error instanceof DomainError) {
      return c.json({ error: error.message, code: error.code }, 400);
    }
    throw error;
  }
}

settingsRoutes.post("/language", async (c) => {
  const i18n = getI18n(c);
  const body = parseValidated(UpdateLanguageSettingsSchema, await c.req.json());

  return respondToLanguageAction(
    c,
    i18n._(
      msg({
        message: "Language updated.",
        comment: "@context: Toast after saving a language setting",
      }),
    ),
    async () => {
      await c.var.services.settings.updateLocaleSettings(
        {
          siteLanguage: body.contentLanguage,
          dashboardLanguage: body.dashboardLanguage,
        },
        {
          oldLanguage: c.var.appConfig.siteLanguage,
          oldDashboardLanguage: c.var.appConfig.dashboardLanguage,
        },
      );
    },
  );
});

settingsRoutes.post("/language/enable", async (c) => {
  const i18n = getI18n(c);
  const body = parseValidated(EnableMultilingualSchema, await c.req.json());

  try {
    const { markedCount } = await c.var.services.language.enable(body);
    return c.json({
      status: "ok" as const,
      toast:
        markedCount > 0
          ? i18n._(
              msg({
                message:
                  "Multilingual content is on. {count, plural, one {# post was marked} other {# posts were marked}} as {language}.",
                comment:
                  "@context: Toast after turning multilingual content on with existing posts",
              }),
              // The language's own name, not its tag — the author picked
              // "繁體中文" in the dialog, not "zh-Hant".
              {
                count: markedCount,
                language: getOrBuildEntry(body.primary).native,
              },
            )
          : i18n._(
              msg({
                message: "Multilingual content is on.",
                comment:
                  "@context: Toast after turning multilingual content on with no existing posts",
              }),
            ),
    });
  } catch (error) {
    if (error instanceof LanguageInUseError) {
      // Worded for the dialog it lands in: the fix is putting the language
      // back on the list right there, and the response carries the tag so
      // the dialog can offer that as one click.
      return c.json(
        {
          error: i18n._(
            msg({
              message:
                "{count, plural, one {# post is} other {# posts are}} written in {language}, which is not on this list. Add it back, or change their language first.",
              comment:
                "@context: Refusal in the multilingual dialog when the list drops a language that posts still use",
            }),
            {
              count: error.postCount,
              language: getOrBuildEntry(error.language).native,
            },
          ),
          code: error.code,
          language: error.language,
        },
        400,
      );
    }
    if (error instanceof DomainError) {
      return c.json({ error: error.message, code: error.code }, 400);
    }
    throw error;
  }
});

settingsRoutes.post("/language/disable", async (c) => {
  const i18n = getI18n(c);
  return respondToLanguageAction(
    c,
    i18n._(
      msg({
        message: "Multilingual content is off. Your languages are still saved.",
        comment: "@context: Toast after turning multilingual content off",
      }),
    ),
    () => c.var.services.language.disable(),
  );
});

settingsRoutes.post("/language/primary", async (c) => {
  const i18n = getI18n(c);
  const body = parseValidated(LanguageTagSchema, await c.req.json());
  return respondToLanguageAction(
    c,
    i18n._(
      msg({
        message: "Primary language changed.",
        comment: "@context: Toast after changing the primary language",
      }),
    ),
    () => c.var.services.language.setPrimary(body.language),
  );
});

settingsRoutes.post("/language/add", async (c) => {
  const i18n = getI18n(c);
  const body = parseValidated(LanguageTagSchema, await c.req.json());
  return respondToLanguageAction(
    c,
    i18n._(
      msg({
        message: "Language added.",
        comment: "@context: Toast after adding a content language",
      }),
    ),
    () => c.var.services.language.addLanguage(body.language),
  );
});

settingsRoutes.post("/language/remove", async (c) => {
  const i18n = getI18n(c);
  const body = parseValidated(LanguageTagSchema, await c.req.json());
  return respondToLanguageAction(
    c,
    i18n._(
      msg({
        message: "Language removed.",
        comment: "@context: Toast after removing a content language",
      }),
    ),
    () => c.var.services.language.removeLanguage(body.language),
  );
});

settingsRoutes.post("/general/feeds", async (c) => {
  const i18n = getI18n(c);
  const body = parseValidated(UpdateFeedSettingsSchema, await c.req.json());
  await c.var.services.settings.updateFeedSettings(body);

  const toast = i18n._(
    msg({
      message: "Feed settings updated.",
      comment: "@context: Toast after saving feed settings",
    }),
  );
  const wantsJson = c.req.header("accept")?.includes("application/json");
  if (wantsJson) {
    return c.json({ status: "ok" as const, toast });
  }

  return dsToast(toast);
});

settingsRoutes.post("/general/home", async (c) => {
  const i18n = getI18n(c);
  const body = parseValidated(UpdateHomeSettingsSchema, await c.req.json());
  await c.var.services.settings.updateHomeBranding(body.showJantBrandingOnHome);

  const toast = i18n._(
    msg({
      message: "Home settings updated.",
      comment: "@context: Toast after auto-saving home settings",
    }),
  );
  const wantsJson = c.req.header("accept")?.includes("application/json");
  if (wantsJson) {
    return c.json({ status: "ok" as const, toast });
  }

  return dsToast(toast);
});

settingsRoutes.post("/general/search", async (c) => {
  const i18n = getI18n(c);
  const body = parseValidated(UpdateSearchSettingsSchema, await c.req.json());
  await c.var.services.settings.updateSearchSettings(body.allowIndexing, {
    demoMode: c.var.appConfig.demoMode,
  });

  // ── JSON response mode (used by Lit settings bridge) ──────────────
  const wantsJson = c.req.header("accept")?.includes("application/json");
  if (wantsJson) {
    return c.json({
      status: "ok" as const,
      toast: i18n._(
        msg({
          message: "Search settings updated.",
          comment: "@context: Toast after saving search settings",
        }),
      ),
    });
  }

  return dsToast(
    i18n._(
      msg({
        message: "Search settings updated.",
        comment: "@context: Toast after saving search settings",
      }),
    ),
  );
});

settingsRoutes.post("/general/about-page", async (c) => {
  try {
    await c.var.services.aboutPage.ensurePage();
    await triggerGitHubSyncInline(c);
  } catch (error) {
    if (error instanceof ValidationError) {
      const wantsJson = c.req.header("accept")?.includes("application/json");
      if (wantsJson) {
        return c.json({ error: error.message, code: error.code }, 400);
      }
      return c.text(error.message, 400);
    }
    throw error;
  }

  const wantsJson = c.req.header("accept")?.includes("application/json");
  if (wantsJson) {
    return c.json({
      status: "redirect" as const,
      url: aboutEditPath(c),
    });
  }

  return c.redirect(aboutEditPath(c));
});

// ===========================================================================
// Avatar
// ===========================================================================

settingsRoutes.get("/avatar", async (c) => {
  const saved = c.req.query("saved") !== undefined;
  const navData = await getNavigationData(c);

  return renderPublicPage(c, {
    title: buildPageTitle("Avatar", navData.siteName),
    navData,
    toast: saved ? { message: "Avatar updated." } : undefined,
    content: (
      <>
        <AdminBreadcrumb
          parent={breadcrumbLabel(c, "settings")}
          parentHref={publicPath(c, "/settings")}
          current={breadcrumbLabel(c, "avatar")}
        />
        <AvatarContent
          siteAvatarUrl={c.var.appConfig.siteAvatarUrl}
          showHeaderAvatar={c.var.appConfig.showHeaderAvatar}
        />
      </>
    ),
  });
});

settingsRoutes.post("/avatar", async (c) => {
  const i18n = getI18n(c);
  const storage = c.var.storage;
  const wantsJson = c.req.header("accept")?.includes("application/json");
  if (!storage) {
    const message = i18n._(
      msg({
        message: "File storage isn't set up. Check your server config.",
        comment: "@context: Error toast when file storage is not set up",
      }),
    );

    if (wantsJson) {
      return c.json({ error: message }, 500);
    }

    return dsToast(message, "error");
  }

  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    const message = i18n._(
      msg({
        message: "No file selected. Choose a file to upload.",
        comment: "@context: Error toast when no file was selected for upload",
      }),
    );

    if (wantsJson) {
      return c.json({ error: message }, 400);
    }

    return dsToast(message, "error");
  }

  const faviconFile = formData.get("favicon") as File | null;
  const appleTouchFile = formData.get("appleTouch") as File | null;

  try {
    await c.var.services.settings.uploadAvatar(
      {
        file,
        faviconIco: faviconFile ? await faviconFile.arrayBuffer() : undefined,
        appleTouchIcon: appleTouchFile
          ? await appleTouchFile.arrayBuffer()
          : undefined,
      },
      {
        media: c.var.services.media,
        storage,
        storageProvider: c.var.appConfig.storageDriver,
        maxFileSizeMB: c.var.appConfig.uploadMaxFileSize,
      },
    );
    try {
      await syncHostedControlPlaneSiteAvatar({
        appConfig: c.var.appConfig,
        env: c.env,
        settings: c.var.services.settings,
        siteId: c.var.currentSite.id,
      });
    } catch (error) {
      // eslint-disable-next-line no-console -- Error logging is intentional
      console.error(
        "[Jant] Failed to sync hosted control plane avatar metadata:",
        error,
      );
    }

    if (wantsJson) {
      return c.json({
        status: "redirect" as const,
        url: publicPath(c, "/settings/avatar?saved"),
      });
    }

    return dsRedirect(publicPath(c, "/settings/avatar?saved"));
  } catch (e) {
    if (e instanceof ValidationError) {
      if (wantsJson) {
        return c.json({ error: e.message, code: e.code }, 400);
      }

      return dsToast(e.message, "error");
    }

    const message = i18n._(
      msg({
        message: "Upload didn't go through. Try again in a moment.",
        comment: "@context: Error toast when avatar upload fails",
      }),
    );

    if (wantsJson) {
      return c.json({ error: message }, 500);
    }

    return dsToast(message, "error");
  }
});

settingsRoutes.post("/avatar/remove", async (c) => {
  await c.var.services.settings.removeAvatar({
    storage: c.var.storage,
    media: c.var.services.media,
    storageProvider: c.var.appConfig.storageDriver,
  });
  try {
    await syncHostedControlPlaneSiteAvatar({
      appConfig: c.var.appConfig,
      env: c.env,
      settings: c.var.services.settings,
      siteId: c.var.currentSite.id,
    });
  } catch (error) {
    // eslint-disable-next-line no-console -- Error logging is intentional
    console.error(
      "[Jant] Failed to sync hosted control plane avatar metadata:",
      error,
    );
  }

  // ── JSON response mode (used by Lit settings bridge) ──────────────
  const wantsJson = c.req.header("accept")?.includes("application/json");
  if (wantsJson) {
    return c.json({
      status: "redirect" as const,
      url: publicPath(c, "/settings/avatar?saved"),
    });
  }

  return dsRedirect(publicPath(c, "/settings/avatar?saved"));
});

settingsRoutes.post("/avatar/display", async (c) => {
  const i18n = getI18n(c);
  const body = await c.req.json<{ showHeaderAvatar: string }>();
  const { settings } = c.var.services;

  if (body.showHeaderAvatar === "true") {
    await settings.set("SHOW_HEADER_AVATAR", "true");
  } else {
    await settings.remove("SHOW_HEADER_AVATAR");
  }

  // ── JSON response mode (used by Lit settings bridge) ──────────────
  const wantsJson = c.req.header("accept")?.includes("application/json");
  if (wantsJson) {
    return c.json({
      status: "ok" as const,
      toast: i18n._(
        msg({
          message: "Avatar display updated.",
          comment: "@context: Toast after saving avatar display preference",
        }),
      ),
    });
  }

  return sse(c, async (stream) => {
    await stream.toast(
      i18n._(
        msg({
          message: "Avatar display updated.",
          comment: "@context: Toast after saving avatar display preference",
        }),
      ),
    );
    await stream.patchSignals({
      _orig_showHeaderAvatar: body.showHeaderAvatar,
      _avatarDisplayDirty: false,
    });
  });
});

// ===========================================================================
// Navigation (moved from appearance routes)
// ===========================================================================

settingsRoutes.get("/navigation", async (c) => {
  const [navItems, directoryData, suggestedLinks] = await Promise.all([
    c.var.services.navItems.list(),
    c.var.services.collections.listDirectoryData(),
    c.var.services.navItems.listSuggestedLinks({
      siteOrigin: c.var.appConfig.siteOrigin,
      sitePathPrefix: c.var.appConfig.sitePathPrefix,
    }),
  ]);
  const navData = await getNavigationData(c);

  return renderPublicPage(c, {
    title: buildPageTitle("Navigation", navData.siteName),
    navData,
    content: (
      <>
        <AdminBreadcrumb
          parent={breadcrumbLabel(c, "settings")}
          parentHref={publicPath(c, "/settings")}
          current={breadcrumbLabel(c, "navigation")}
        />
        <NavigationContent
          navItems={navItems}
          directoryData={directoryData}
          suggestedLinks={suggestedLinks}
          mainRssFeed={c.var.appConfig.mainRssFeed}
          rssFeedsEnabled={c.var.appConfig.rssFeedsEnabled}
          siteName={navData.siteName}
          sitePathPrefix={c.var.appConfig.sitePathPrefix}
        />
      </>
    ),
  });
});

// ===========================================================================
// Color Theme (moved from appearance routes)
// ===========================================================================

settingsRoutes.get("/color-theme", async (c) => {
  const currentThemeId = c.var.appConfig.themeId;
  const currentThemeMode = c.var.appConfig.themeMode;
  const themes = getAvailableThemes();
  const saved = c.req.query("saved") !== undefined;
  const navData = await getNavigationData(c);

  return renderPublicPage(c, {
    title: buildPageTitle("Color Theme", navData.siteName),
    navData,
    toast: saved ? { message: "Theme updated." } : undefined,
    content: (
      <>
        <AdminBreadcrumb
          parent={breadcrumbLabel(c, "settings")}
          parentHref={publicPath(c, "/settings")}
          current={breadcrumbLabel(c, "colorTheme")}
        />
        <ColorThemeContent
          themes={themes}
          currentThemeId={currentThemeId}
          currentThemeMode={currentThemeMode}
          sitePathPrefix={c.var.appConfig.sitePathPrefix}
        />
      </>
    ),
  });
});

settingsRoutes.post("/color-theme", async (c) => {
  const i18n = getI18n(c);
  const body = await c.req.json<{ theme: string; themeMode?: string }>();
  const { settings } = c.var.services;
  const themes = getAvailableThemes();

  const validTheme = themes.find((t) => t.id === body.theme);
  if (!validTheme) {
    return dsToast(
      i18n._(
        msg({
          message: "That theme isn't available. Pick another one.",
          comment: "@context: Error toast when selected theme is not valid",
        }),
      ),
      "error",
    );
  }

  await settings.set(SETTINGS_KEYS.THEME, validTheme.id);

  const themeMode: ThemeMode = THEME_MODES.includes(body.themeMode as ThemeMode)
    ? (body.themeMode as ThemeMode)
    : "auto";

  if (themeMode === "auto") {
    await settings.remove(SETTINGS_KEYS.THEME_MODE);
  } else {
    await settings.set(SETTINGS_KEYS.THEME_MODE, themeMode);
  }

  return dsRedirect(publicPath(c, "/settings/color-theme?saved"));
});

// ===========================================================================
// Font Theme (moved from appearance routes)
// ===========================================================================

settingsRoutes.get("/font-theme", async (c) => {
  const currentFontThemeId = c.var.appConfig.fontThemeId;
  const saved = c.req.query("saved") !== undefined;
  const navData = await getNavigationData(c);

  return renderPublicPage(c, {
    title: buildPageTitle("Font Theme", navData.siteName),
    navData,
    toast: saved ? { message: "Font theme updated." } : undefined,
    content: (
      <>
        <AdminBreadcrumb
          parent={breadcrumbLabel(c, "settings")}
          parentHref={publicPath(c, "/settings")}
          current={breadcrumbLabel(c, "fontTheme")}
        />
        <FontThemeContent
          fontThemes={BUILTIN_FONT_THEMES}
          currentFontThemeId={currentFontThemeId}
          sitePathPrefix={c.var.appConfig.sitePathPrefix}
        />
      </>
    ),
  });
});

settingsRoutes.post("/font-theme", async (c) => {
  const i18n = getI18n(c);
  const body = await c.req.json<{ fontTheme: string }>();
  const { settings } = c.var.services;

  const validFont = BUILTIN_FONT_THEMES.find((f) => f.id === body.fontTheme);
  if (!validFont) {
    return dsToast(
      i18n._(
        msg({
          message: "That font theme isn't available. Pick another one.",
          comment:
            "@context: Error toast when selected font theme is not valid",
        }),
      ),
      "error",
    );
  }

  await settings.set("FONT_THEME", validFont.id);

  return dsRedirect(publicPath(c, "/settings/font-theme?saved"));
});

// ===========================================================================
// Custom CSS (moved from appearance routes)
// ===========================================================================

settingsRoutes.get("/custom-css", async (c) => {
  const customCSS = c.var.allSettings[SETTINGS_KEYS.CUSTOM_CSS] ?? "";
  const navData = await getNavigationData(c);

  return renderPublicPage(c, {
    title: buildPageTitle("Custom CSS", navData.siteName),
    navData,
    content: (
      <>
        <AdminBreadcrumb
          parent={breadcrumbLabel(c, "settings")}
          parentHref={publicPath(c, "/settings")}
          current={breadcrumbLabel(c, "customCss")}
        />
        <AdvancedContent
          customCSS={customCSS}
          sitePathPrefix={c.var.appConfig.sitePathPrefix}
        />
      </>
    ),
  });
});

settingsRoutes.post("/custom-css", async (c) => {
  const i18n = getI18n(c);
  const body = await c.req.json<{ customCSS: string }>();
  const { settings } = c.var.services;

  const css = body.customCSS?.trim() ?? "";

  if (css) {
    await settings.set(SETTINGS_KEYS.CUSTOM_CSS, css);
  } else {
    await settings.remove(SETTINGS_KEYS.CUSTOM_CSS);
  }

  return dsToast(
    i18n._(
      msg({
        message: "Custom CSS updated.",
        comment: "@context: Toast after saving custom CSS",
      }),
    ),
  );
});

// ===========================================================================
// Code Injection — site-wide HTML in <head> and at end of <body>.
// ===========================================================================

settingsRoutes.get("/code-injection", async (c) => {
  const customHeadHtml =
    c.var.allSettings[SETTINGS_KEYS.CUSTOM_HEAD_HTML] ?? "";
  const customBodyEndHtml =
    c.var.allSettings[SETTINGS_KEYS.CUSTOM_BODY_END_HTML] ?? "";
  const navData = await getNavigationData(c);

  return renderPublicPage(c, {
    title: buildPageTitle("Code Injection", navData.siteName),
    navData,
    content: (
      <>
        <AdminBreadcrumb
          parent={breadcrumbLabel(c, "settings")}
          parentHref={publicPath(c, "/settings")}
          current={breadcrumbLabel(c, "codeInjection")}
        />
        <CodeInjectionContent
          customHeadHtml={customHeadHtml}
          customBodyEndHtml={customBodyEndHtml}
          sitePathPrefix={c.var.appConfig.sitePathPrefix}
        />
      </>
    ),
  });
});

settingsRoutes.post("/code-injection", async (c) => {
  const i18n = getI18n(c);
  const body = await c.req.json<{
    customHeadHtml?: string;
    customBodyEndHtml?: string;
  }>();
  const { settings } = c.var.services;

  const headHtml = body.customHeadHtml?.trim() ?? "";
  const bodyEndHtml = body.customBodyEndHtml?.trim() ?? "";

  if (headHtml) {
    await settings.set(SETTINGS_KEYS.CUSTOM_HEAD_HTML, headHtml);
  } else {
    await settings.remove(SETTINGS_KEYS.CUSTOM_HEAD_HTML);
  }

  if (bodyEndHtml) {
    await settings.set(SETTINGS_KEYS.CUSTOM_BODY_END_HTML, bodyEndHtml);
  } else {
    await settings.remove(SETTINGS_KEYS.CUSTOM_BODY_END_HTML);
  }

  return dsToast(
    i18n._(
      msg({
        message: "Code injection updated.",
        comment: "@context: Toast after saving Code Injection settings",
      }),
    ),
  );
});

// ===========================================================================
// Config Editor — explicitly approved runtime settings only.
// ===========================================================================

settingsRoutes.get("/config", async (c) => {
  const navData = await getNavigationData(c);
  const fields = buildConfigEditorFields(
    c.var.allSettings,
    c.env,
    c.var.appConfig.demoMode,
  );

  return renderPublicPage(c, {
    title: buildPageTitle("Config Editor", navData.siteName),
    navData,
    content: (
      <>
        <AdminBreadcrumb
          parent={breadcrumbLabel(c, "settings")}
          parentHref={publicPath(c, "/settings")}
          current={breadcrumbLabel(c, "config")}
        />
        <ConfigEditorContent
          fields={fields}
          endpoint={publicPath(c, "/api/settings")}
          sitePathPrefix={c.var.appConfig.sitePathPrefix}
        />
      </>
    ),
  });
});

// ===========================================================================
// Account sub-menu
// ===========================================================================

settingsRoutes.get("/account", async (c) => {
  const navData = await getNavigationData(c);
  const hostedControlPlaneAccountUrl = getHostedControlPlaneAccountUrl(c.env);
  const hostedControlPlaneProviderLabel = getHostedControlPlaneProviderLabel(
    c.env,
  );

  return renderPublicPage(c, {
    title: buildPageTitle("Account", navData.siteName),
    navData,
    content: (
      <>
        <AdminBreadcrumb
          parent={breadcrumbLabel(c, "settings")}
          parentHref={publicPath(c, "/settings")}
          current={breadcrumbLabel(c, "account")}
        />
        <AccountMenuContent
          sitePathPrefix={c.var.appConfig.sitePathPrefix}
          demoMode={c.var.appConfig.demoMode}
          hostedControlPlaneAccountUrl={hostedControlPlaneAccountUrl}
          hostedControlPlaneProviderLabel={hostedControlPlaneProviderLabel}
        />
      </>
    ),
  });
});

// ===========================================================================
// Sessions
// ===========================================================================

settingsRoutes.get("/account/sessions", async (c) => {
  if (c.var.appConfig.demoMode) {
    return c.redirect(publicPath(c, "/settings/account"));
  }

  const navData = await getNavigationData(c);

  // Session was pre-fetched by `attachSession`; this route is behind
  // `requireAuth`, so it's guaranteed to be present here.
  const currentToken = c.var.session?.session?.token ?? "";

  // List all active sessions
  const rawSessions = await c.var.auth.api.listSessions({
    headers: c.req.raw.headers,
  });

  const sessions: SessionInfo[] = (rawSessions ?? []).map(
    (s: {
      token: string;
      ipAddress?: string | null;
      userAgent?: string | null;
      createdAt: Date;
    }) => ({
      token: s.token,
      ipAddress: s.ipAddress ?? null,
      userAgent: s.userAgent ?? null,
      createdAt: Math.floor(new Date(s.createdAt).getTime() / 1000),
      isCurrent: s.token === currentToken,
    }),
  );

  // Sort: current session first, then by creation date descending
  sessions.sort((a, b) => {
    if (a.isCurrent) return -1;
    if (b.isCurrent) return 1;
    return b.createdAt - a.createdAt;
  });

  return renderPublicPage(c, {
    title: buildPageTitle("Sessions", navData.siteName),
    navData,
    content: (
      <>
        <AdminBreadcrumb
          parent={breadcrumbLabel(c, "account")}
          parentHref={publicPath(c, "/settings/account")}
          current={breadcrumbLabel(c, "sessions")}
        />
        <SessionsContent
          sessions={sessions}
          sitePathPrefix={c.var.appConfig.sitePathPrefix}
        />
      </>
    ),
  });
});

settingsRoutes.post("/account/sessions/:token/revoke", async (c) => {
  if (c.var.appConfig.demoMode) {
    return demoRestrictionResponse(c, getDemoRestrictionMessage(c, "sessions"));
  }

  const token = c.req.param("token");

  try {
    await c.var.auth.api.revokeSession({
      body: { token },
      headers: c.req.raw.headers,
    });
  } catch {
    // Session may already be expired/revoked — still redirect
  }

  return dsRedirect(publicPath(c, "/settings/account/sessions"));
});

// ===========================================================================
// Password
// ===========================================================================

settingsRoutes.get("/account/password", async (c) => {
  const hostedControlPlaneAccountPasswordUrl =
    getHostedControlPlaneAccountPasswordUrl(c.env);
  if (hostedControlPlaneAccountPasswordUrl) {
    return c.redirect(hostedControlPlaneAccountPasswordUrl);
  }

  if (c.var.appConfig.demoMode) {
    return c.redirect(publicPath(c, "/settings/account"));
  }

  const navData = await getNavigationData(c);

  return renderPublicPage(c, {
    title: buildPageTitle("Password", navData.siteName),
    navData,
    content: (
      <>
        <AdminBreadcrumb
          parent={breadcrumbLabel(c, "account")}
          parentHref={publicPath(c, "/settings/account")}
          current={breadcrumbLabel(c, "password")}
        />
        <AccountContent sitePathPrefix={c.var.appConfig.sitePathPrefix} />
      </>
    ),
  });
});

settingsRoutes.post("/account/password", async (c) => {
  const hostedControlPlaneAccountPasswordUrl =
    getHostedControlPlaneAccountPasswordUrl(c.env);
  if (hostedControlPlaneAccountPasswordUrl) {
    return dsRedirect(hostedControlPlaneAccountPasswordUrl);
  }

  if (c.var.appConfig.demoMode) {
    return demoRestrictionResponse(c, getDemoRestrictionMessage(c, "password"));
  }

  const i18n = getI18n(c);
  const body = await c.req.json<{
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  }>();

  if (body.newPassword !== body.confirmPassword) {
    return dsToast(
      i18n._(
        msg({
          message:
            "Passwords don't match. Make sure both fields are identical.",
          comment:
            "@context: Error toast when new password and confirmation differ",
        }),
      ),
      "error",
    );
  }

  try {
    await c.var.auth.api.changePassword({
      body: {
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
        revokeOtherSessions: false,
      },
      headers: c.req.raw.headers,
    });
  } catch {
    return dsToast(
      i18n._(
        msg({
          message: "Current password doesn't match. Try again.",
          comment:
            "@context: Error toast when current password verification fails",
        }),
      ),
      "error",
    );
  }

  return sse(c, async (stream) => {
    await stream.toast(
      i18n._(
        msg({
          message: "Password changed.",
          comment: "@context: Toast after changing account password",
        }),
      ),
    );
    await stream.patchSignals({
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    });
  });
});

// ===========================================================================
// Delete Account
// ===========================================================================

settingsRoutes.get("/account/delete-account", async (c) => {
  const hostedControlPlaneAccountUrl = getHostedControlPlaneAccountUrl(c.env);
  const hostedControlPlaneSiteDeleteUrl = getHostedControlPlaneSiteDeleteUrl(
    c.env,
    c.var.currentSite.id,
  );
  if (hostedControlPlaneSiteDeleteUrl) {
    return c.redirect(hostedControlPlaneSiteDeleteUrl);
  }
  if (hostedControlPlaneAccountUrl) {
    return c.redirect(hostedControlPlaneAccountUrl);
  }

  if (c.var.appConfig.demoMode) {
    return c.redirect(publicPath(c, "/settings/account"));
  }

  const navData = await getNavigationData(c);
  const csrfToken = await c.var.services.auth.generateDeleteCsrfToken();

  return renderPublicPage(c, {
    title: buildPageTitle("Delete Account", navData.siteName),
    navData,
    content: (
      <>
        <AdminBreadcrumb
          parent={breadcrumbLabel(c, "account")}
          parentHref={publicPath(c, "/settings/account")}
          current={breadcrumbLabel(c, "deleteAccount")}
        />
        <DeleteAccountContent
          siteName={navData.siteName}
          csrfToken={csrfToken}
          sitePathPrefix={c.var.appConfig.sitePathPrefix}
        />
      </>
    ),
  });
});

settingsRoutes.post("/account/delete-account", async (c) => {
  const hostedControlPlaneAccountUrl = getHostedControlPlaneAccountUrl(c.env);
  const hostedControlPlaneSiteDeleteUrl = getHostedControlPlaneSiteDeleteUrl(
    c.env,
    c.var.currentSite.id,
  );
  if (hostedControlPlaneSiteDeleteUrl) {
    return dsRedirect(hostedControlPlaneSiteDeleteUrl);
  }
  if (hostedControlPlaneAccountUrl) {
    return dsRedirect(hostedControlPlaneAccountUrl);
  }

  if (c.var.appConfig.demoMode) {
    return demoRestrictionResponse(
      c,
      getDemoRestrictionMessage(c, "accountDeletion"),
    );
  }

  const i18n = getI18n(c);
  const csrfToken = c.req.header("x-csrf-token");

  if (!csrfToken) {
    return dsToast(
      i18n._(
        msg({
          message: "Security token missing. Refresh the page and try again.",
          comment:
            "@context: Error toast when CSRF token is missing from delete request",
        }),
      ),
      "error",
    );
  }

  const isValid = await c.var.services.auth.validateDeleteCsrfToken(csrfToken);
  if (!isValid) {
    return dsToast(
      i18n._(
        msg({
          message: "Security token expired. Refresh the page and try again.",
          comment:
            "@context: Error toast when CSRF token is invalid or expired",
        }),
      ),
      "error",
    );
  }

  await c.var.services.auth.deleteAllData({
    storage: c.var.storage,
  });

  return dsRedirect(publicPath(c, "/setup"));
});

// ===========================================================================
// API Tokens
// ===========================================================================

settingsRoutes.get("/api-tokens", async (c) => {
  const tokens = await c.var.services.apiTokens.list();
  const navData = await getNavigationData(c);
  const siteUrl = c.var.appConfig.siteUrl;

  return renderPublicPage(c, {
    title: buildPageTitle("API Tokens", navData.siteName),
    navData,
    content: (
      <>
        <AdminBreadcrumb
          parent={breadcrumbLabel(c, "settings")}
          parentHref={publicPath(c, "/settings")}
          current={breadcrumbLabel(c, "apiTokens")}
        />
        <ApiTokensContent
          tokens={tokens}
          siteUrl={siteUrl}
          sitePathPrefix={c.var.appConfig.sitePathPrefix}
        />
      </>
    ),
  });
});

settingsRoutes.post("/api-tokens", async (c) => {
  const body = await c.req.json<{ tokenName: string }>();
  const name = body.tokenName?.trim();

  if (!name) {
    return dsToast("Token name is required.", "error");
  }

  const { plaintext } = await c.var.services.apiTokens.create(name);

  return sse(c, async (stream) => {
    await stream.patchSignals({
      _newPlaintext: plaintext,
      tokenName: "",
    });
  });
});

settingsRoutes.post("/api-tokens/:id/delete", async (c) => {
  const id = c.req.param("id");
  await c.var.services.apiTokens.delete(id);

  return dsRedirect(publicPath(c, "/settings/api-tokens"));
});

// ===========================================================================
// GitHub Sync
// ===========================================================================

settingsRoutes.post("/github-sync/connect", async (c) => {
  // When a GitHub App is configured on this deployment, PAT connect is
  // disabled — users must go through the App install flow so we don't end
  // up with a mix of auth modes per site (harder to audit, easier to leak
  // a long-lived token by accident). The UI hides the PAT form too.
  if (getGitHubAppConfig(c.env)) {
    return dsToast(
      "This deployment uses GitHub App authentication. Use Install GitHub App instead.",
      "error",
    );
  }

  const body = await c.req.json<{ token: string; repo: string }>();

  if (!body.token?.trim() || !body.repo?.trim()) {
    return dsToast("Token and repository are required.", "error");
  }

  const { parseRepoSlug, createGitHubClient } =
    await import("../../lib/github-api.js");
  const parsed = parseRepoSlug(body.repo);
  if (!parsed) {
    return dsToast("Invalid repository format. Use owner/repo.", "error");
  }

  // Validate token
  const client = createGitHubClient(body.token);
  try {
    await client.getRepo(parsed.owner, parsed.repo);
  } catch (err) {
    const detail = err instanceof Error ? err.message : JSON.stringify(err);
    process.stderr.write(
      `[Jant] GitHub Sync connect failed for ${body.repo}: ${detail}\n`,
    );
    return dsToast(`Could not access the repository: ${detail}`, "error");
  }

  // Check if this repo already has a Jant webhook
  try {
    const hooks = await client.listWebhooks(parsed.owner, parsed.repo);
    const existingJantHook = hooks.find((h) =>
      h.config.url?.includes("/api/github-sync/webhook"),
    );
    if (existingJantHook) {
      return dsToast(
        "This repository is already connected to a Jant site. Disconnect it first before connecting to a new site.",
        "error",
      );
    }
  } catch {
    // If listing webhooks fails (permissions), skip the check and continue
  }

  // Save config
  await c.var.services.settings.set("GITHUB_SYNC_TOKEN", body.token);
  await c.var.services.settings.set("GITHUB_SYNC_REPO", body.repo);
  await c.var.services.settings.set("GITHUB_SYNC_AUTH_MODE", "pat");
  await c.var.services.settings.set("GITHUB_SYNC_APP_INSTALLATION_ID", "");
  await c.var.services.settings.set("GITHUB_SYNC_ENABLED", "true");

  // Create webhook
  const { createGitHubSyncService } =
    await import("../../services/github-sync.js");
  const syncService = createGitHubSyncService(
    c.var.services,
    c.var.currentSite.id,
    await buildSyncSiteConfig(c),
    { storage: c.var.storage, githubApp: getGitHubAppConfig(c.env) },
  );
  const siteUrl = c.var.appConfig.siteUrl.replace(/\/+$/, "");
  try {
    await syncService.setupWebhook(`${siteUrl}/api/github-sync/webhook`);
  } catch {
    return dsToast(
      "Connected, but webhook creation failed. You may need to create it manually.",
      "error",
    );
  }

  // Kick off an initial background push so "Last sync" doesn't sit on
  // "Not synced yet" until the user's next edit. See the App flow's
  // equivalent block below for why we bypass the queue.
  await markSyncPending(c.var.services.settings);
  const initialSync = runBackgroundSync(c.var.services.settings, syncService);
  try {
    c.executionCtx?.waitUntil(initialSync);
  } catch {
    // executionCtx unavailable (tests / Node).
  }

  return dsRedirect(publicPath(c, "/settings/github-sync"));
});

settingsRoutes.post("/github-sync/push", async (c) => {
  const { createGitHubSyncService } =
    await import("../../services/github-sync.js");
  const syncService = createGitHubSyncService(
    c.var.services,
    c.var.currentSite.id,
    await buildSyncSiteConfig(c),
    { storage: c.var.storage, githubApp: getGitHubAppConfig(c.env) },
  );

  const config = await syncService.getConfig();
  if (!config) {
    return dsToast("GitHub Sync is not configured.", "error");
  }

  // Run the push in the background so the status card's live "Syncing…"
  // indicator drives the UX instead of a toast. We patch the status card
  // into its pending state immediately so Datastar re-evaluates `data-init`
  // on the new element and opens the SSE status stream, which then polls
  // until the push completes.
  await markSyncPending(c.var.services.settings);
  const push = runBackgroundSync(c.var.services.settings, syncService);
  try {
    c.executionCtx?.waitUntil(push);
  } catch {
    // executionCtx unavailable (tests / Node).
  }

  const status = await readGitHubSyncStatus(c); // pending=true after markSyncPending
  const streamUrl = getSyncStatusStreamUrl(c);
  const html = renderStatusCardHtml(c, status, streamUrl);
  return sse(c, async (stream) => {
    stream.patchElements(html, {
      mode: "outer",
      selector: "#github-sync-status",
    });
  });
});

settingsRoutes.post("/github-sync/disconnect", async (c) => {
  const { createGitHubSyncService } =
    await import("../../services/github-sync.js");
  const syncService = createGitHubSyncService(
    c.var.services,
    c.var.currentSite.id,
    await buildSyncSiteConfig(c),
    { githubApp: getGitHubAppConfig(c.env) },
  );
  await syncService.teardownWebhook();

  return dsRedirect(publicPath(c, "/settings/github-sync"));
});

// ---------------------------------------------------------------------------
// GitHub App install flow
// ---------------------------------------------------------------------------

/**
 * Redirect the user to GitHub to install the App on their account/org.
 *
 * Only available when GitHub App env vars are configured. Uses a signed
 * state cookie for CSRF protection.
 */
settingsRoutes.get("/github-sync/app/install", async (c) => {
  const app = getGitHubAppConfig(c.env);
  if (!app) {
    return c.text("GitHub App is not configured on this deployment.", 404);
  }

  // Reinstall-same-account predicate (§5): when this site already has at
  // least one authorized installation, skip the GitHub round-trip and
  // render the picker directly. The GitHub redirect is a dead end when
  // the App is already installed on the chosen account — GitHub shows
  // its Configure page and never comes back with installation_id.
  //
  // `?force=new` bypasses the predicate so the picker's "Install on
  // another account" action can still reach GitHub to add a fresh
  // install.
  const forceNew = c.req.query("force") === "new";
  if (!forceNew) {
    const existing =
      await c.var.services.githubAppInstallations.listInstallationsForSite(
        c.var.currentSite.id,
      );
    if (existing.length > 0) {
      const navData = await getNavigationData(c);
      const base = publicPath(c, "/settings/github-sync");
      const labels = buildRepoPickerLabels(c);
      const suggestedRepoName = buildSuggestedRepoName(c);
      return renderPublicPage(c, {
        title: buildPageTitle(
          "GitHub Sync — Pick Repository",
          navData.siteName,
        ),
        navData,
        content: (
          <>
            <AdminBreadcrumb
              parent={breadcrumbLabel(c, "settings")}
              parentHref={publicPath(c, "/settings")}
              current={breadcrumbLabel(c, "githubSync")}
            />
            <jant-repo-picker
              labels={labels}
              api-base={`${base}/app`}
              connect-url={`${base}/app/connect`}
              install-url={`${base}/app/install?force=new`}
              cancel-url={publicPath(c, "/settings")}
              create-repo-name-hint={suggestedRepoName}
            >
              <div class="flex flex-col gap-6 max-w-lg">
                <div>
                  <h2 class="text-lg font-medium mb-1">Pick a repository</h2>
                  <p class="text-sm text-muted-foreground">
                    Loading repositories…
                  </p>
                </div>
              </div>
            </jant-repo-picker>
          </>
        ),
      });
    }
  }

  // Build the state token. When running behind a hosted control plane we
  // sign host+nonce with the shared SSO secret so the control plane can
  // verify and route the callback back to the correct site host. In
  // self-hosted single-site mode the secret is absent and a plain nonce
  // suffices (the App's Callback URL points directly at this site).
  const nonce = generateInstallNonce();
  const ssoSecret = getHostedControlPlaneSsoSecret(c.env);
  const host = new URL(c.var.appConfig.siteUrl).host;
  const state = ssoSecret
    ? await signInstallState(host, nonce, ssoSecret)
    : nonce;

  // Cookie is pinned to this host; compared byte-for-byte on the callback
  // to defeat CSRF regardless of whether the state is signed.
  setCookie(c, "jant_gh_app_state", state, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 600,
  });

  return c.redirect(buildInstallUrl(app.slug, state));
});

/**
 * Landing page after the user installs the GitHub App.
 *
 * GitHub redirects here with `installation_id`, `setup_action`, and the
 * `state` we sent. We verify the state, list the installation's repos, and
 * render a repo picker that POSTs back to `/github-sync/app/connect`.
 */
settingsRoutes.get("/github-sync/app/callback", async (c) => {
  const app = getGitHubAppConfig(c.env);
  if (!app) {
    return c.text("GitHub App is not configured on this deployment.", 404);
  }

  const installationId = c.req.query("installation_id");
  const state = c.req.query("state");
  if (!installationId) {
    return c.text("Missing installation_id.", 400);
  }

  const expected = getCookie(c, "jant_gh_app_state");
  if (!state || !expected || expected !== state) {
    return c.text("Invalid or expired state.", 400);
  }

  // Defense in depth: when an SSO secret is present the state should also
  // HMAC-verify and its embedded host must match the host serving this
  // request. This blocks a rogue control plane from redirecting a victim
  // to the wrong site with a replayed token.
  const ssoSecret = getHostedControlPlaneSsoSecret(c.env);
  if (ssoSecret) {
    const payload = await verifyInstallState(state, ssoSecret);
    const currentHost = new URL(c.var.appConfig.siteUrl).host;
    if (!payload || payload.host !== currentHost) {
      return c.text("State signature invalid for this host.", 400);
    }
  }

  // One-shot: clear the cookie so it can't be replayed.
  setCookie(c, "jant_gh_app_state", "", {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 0,
  });

  // Fetch the account info for this installation and remember it. The
  // picker's owner dropdown reads the stored list, so subsequent visits
  // can switch between accounts without re-running the install flow.
  // Failures are non-fatal: this callback must still render the picker
  // so the user isn't locked out right after a successful install.
  try {
    const installation = await getInstallation(app, installationId);
    await c.var.services.githubAppInstallations.upsertInstallation(
      installationId,
      c.var.currentSite.id,
      installation.account,
    );
  } catch {
    // Swallow — the legacy inline picker still works with just the
    // installation_id from the URL, just without the owner list.
  }

  const navData = await getNavigationData(c);
  const base = publicPath(c, "/settings/github-sync");
  const labels = buildRepoPickerLabels(c);
  const suggestedRepoName = buildSuggestedRepoName(c);

  return renderPublicPage(c, {
    title: buildPageTitle("GitHub Sync — Pick Repository", navData.siteName),
    navData,
    content: (
      <>
        <AdminBreadcrumb
          parent={breadcrumbLabel(c, "settings")}
          parentHref={publicPath(c, "/settings")}
          current={breadcrumbLabel(c, "githubSync")}
        />
        <jant-repo-picker
          labels={labels}
          api-base={`${base}/app`}
          connect-url={`${base}/app/connect`}
          install-url={`${base}/app/install`}
          cancel-url={publicPath(c, "/settings")}
          create-repo-name-hint={suggestedRepoName}
        >
          {/* SSR fallback while the Lit component upgrades. */}
          <div class="flex flex-col gap-6 max-w-lg">
            <div>
              <h2 class="text-lg font-medium mb-1">Pick a repository</h2>
              <p class="text-sm text-muted-foreground">Loading repositories…</p>
            </div>
          </div>
        </jant-repo-picker>
      </>
    ),
  });
});

/**
 * Derive a default repository name to prefill on github.com/new.
 *
 * Uses the site's host — the first DNS label is a stable, URL-safe
 * identifier tied to this specific Jant instance. Fallback to
 * "jant-site-sync" when the host parse fails so we never hand GitHub an
 * empty `name=`. The `-jant-sync` suffix disambiguates the sync mirror
 * from a user's own `{slug}-jant` source repo.
 */
function buildSuggestedRepoName(c: Context<Env>): string {
  let firstLabel = "";
  try {
    firstLabel = new URL(c.var.appConfig.siteUrl).host.split(".")[0] ?? "";
  } catch {
    /* fall through */
  }
  const slug = firstLabel
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `${slug}-jant-sync` : "jant-site-sync";
}

function buildRepoPickerLabels(c: Context<Env>): string {
  const i18n = getI18n(c);
  return JSON.stringify({
    pageTitle: i18n._(
      msg({
        message: "Pick a repository",
        comment: "@context: GitHub sync picker — page heading",
      }),
    ),
    pageSubtitle: i18n._(
      msg({
        message:
          "Choose the GitHub account and repository to sync with this site.",
        comment: "@context: GitHub sync picker — page subtitle",
      }),
    ),
    ownerLabel: i18n._(
      msg({
        message: "Account",
        comment: "@context: GitHub sync picker — owner dropdown label",
      }),
    ),
    ownerPlaceholder: i18n._(
      msg({
        message: "Select an account",
        comment:
          "@context: GitHub sync picker — owner dropdown placeholder when nothing is selected",
      }),
    ),
    ownerEmpty: i18n._(
      msg({
        message: "No accounts authorized yet",
        comment:
          "@context: GitHub sync picker — shown when the owner list is empty",
      }),
    ),
    installAnother: i18n._(
      msg({
        message: "+ Install on another account",
        comment:
          "@context: GitHub sync picker — entry at the bottom of the owner dropdown that starts a new install flow",
      }),
    ),
    repositoryLabel: i18n._(
      msg({
        message: "Repository",
        comment: "@context: GitHub sync picker — repo dropdown label",
      }),
    ),
    repoPlaceholderNoOwner: i18n._(
      msg({
        message: "Pick an account first",
        comment:
          "@context: GitHub sync picker — repo dropdown placeholder before an owner is chosen",
      }),
    ),
    repoPlaceholder: i18n._(
      msg({
        message: "Select a repository",
        comment: "@context: GitHub sync picker — repo dropdown placeholder",
      }),
    ),
    repoSearchPlaceholder: i18n._(
      msg({
        message: "Search repositories",
        comment: "@context: GitHub sync picker — search input placeholder",
      }),
    ),
    repoEmpty: i18n._(
      msg({
        message: "No repositories match.",
        comment:
          "@context: GitHub sync picker — empty state when search returns nothing",
      }),
    ),
    repoLoading: i18n._(
      msg({
        message: "Loading…",
        comment: "@context: GitHub sync picker — loading state",
      }),
    ),
    repoShowingOf: i18n._(
      msg({
        message: "Showing {shown} of {total}",
        comment:
          "@context: GitHub sync picker — paginated repo count hint. Placeholders {shown} and {total} are integers.",
      }),
    ),
    repoSearchHint: i18n._(
      msg({
        message: "type to search all",
        comment:
          "@context: GitHub sync picker — hint telling the user typing will search the full list",
      }),
    ),
    refreshRepos: i18n._(
      msg({
        message: "Refresh repository list",
        comment:
          "@context: GitHub sync picker — tooltip for the refresh button next to the search input",
      }),
    ),
    createOnGitHub: i18n._(
      msg({
        message: "Create a new repository on GitHub",
        comment:
          "@context: GitHub sync picker — entry that opens github.com/new in a new tab",
      }),
    ),
    createOnGitHubHint: i18n._(
      msg({
        message: "We'll prefill the name {name}. The list refreshes on return.",
        comment:
          "@context: GitHub sync picker — hint under the create-on-github entry. Placeholder {name} is the suggested repo name.",
      }),
    ),
    classifyLoading: i18n._(
      msg({
        message: "Checking repository…",
        comment:
          "@context: GitHub sync picker — status text while classifying the picked repo",
      }),
    ),
    classificationEmpty: i18n._(
      msg({
        message: "Empty repository. Ready to connect.",
        comment:
          "@context: GitHub sync picker — shown when the selected repo has no commits",
      }),
    ),
    classificationOwned: i18n._(
      msg({
        message: "This repository is already backing up this site.",
        comment:
          "@context: GitHub sync picker — shown when the selected repo's marker matches this site",
      }),
    ),
    classificationOwnedByOther: i18n._(
      msg({
        message:
          "This repository is already backing up another Jant site ({host}). Pick a different repository.",
        comment:
          "@context: GitHub sync picker — blocking message when marker belongs to another site. Placeholder {host} is the other site's host.",
      }),
    ),
    classificationForeign: i18n._(
      msg({
        message: "This repository has existing content.",
        comment:
          "@context: GitHub sync picker — heading above the foreign-repo confirmation",
      }),
    ),
    confirmHeading: i18n._(
      msg({
        message: "This repository already has commits",
        comment:
          "@context: GitHub sync picker — confirmation card heading for foreign repos",
      }),
    ),
    confirmBody: i18n._(
      msg({
        message:
          "Connecting will sync your site onto {repo}'s default branch on top of its existing history. Existing files outside Jant's managed paths are kept. This can't be undone.",
        comment:
          "@context: GitHub sync picker — explanatory body for foreign-repo confirmation. Placeholder {repo} is the owner/repo slug.",
      }),
    ),
    confirmInputLabel: i18n._(
      msg({
        message: "Type {repo} to confirm",
        comment:
          "@context: GitHub sync picker — label above the typed-confirmation input",
      }),
    ),
    confirmInputPlaceholder: i18n._(
      msg({
        message: "owner/repo",
        comment:
          "@context: GitHub sync picker — placeholder text showing the expected input shape",
      }),
    ),
    cancel: i18n._(
      msg({
        message: "Cancel",
        comment: "@context: GitHub sync picker — cancel action",
      }),
    ),
    connect: i18n._(
      msg({
        message: "Connect",
        comment: "@context: GitHub sync picker — primary action button",
      }),
    ),
    connecting: i18n._(
      msg({
        message: "Connecting…",
        comment:
          "@context: GitHub sync picker — primary action button while a request is in flight",
      }),
    ),
    privateBadge: i18n._(
      msg({
        message: "Private",
        comment: "@context: GitHub sync picker — badge next to private repos",
      }),
    ),
    connectionFailed: i18n._(
      msg({
        message: "Couldn't connect. Check the error and try again.",
        comment:
          "@context: GitHub sync picker — generic failure message for Connect",
      }),
    ),
    retry: i18n._(
      msg({
        message: "Try again",
        comment: "@context: GitHub sync picker — retry button",
      }),
    ),
  }).replace(/</g, "\\u003c");
}

/**
 * Finalize the App connection: validate access, classify the target repo
 * to gate foreign/conflicting choices behind explicit user confirmation,
 * then persist the installation id and chosen repo and register the webhook.
 *
 * Accepts both classic form submits (redirects on success) and JSON
 * requests (returns JSON). Phase 3's picker component uses the JSON path.
 */
settingsRoutes.post("/github-sync/app/connect", async (c) => {
  const app = getGitHubAppConfig(c.env);
  if (!app) {
    return c.text("GitHub App is not configured on this deployment.", 404);
  }

  const wantsJson = c.req.header("content-type")?.includes("application/json");
  const body = wantsJson
    ? ((await c.req.json().catch(() => ({}))) as Record<string, unknown>)
    : await c.req.parseBody();

  const installationId = String(body.installationId ?? "").trim();
  const repo = String(body.repo ?? "").trim();
  const confirmForeign =
    body.confirmForeign === true || body.confirmForeign === "true";
  if (!installationId || !repo) {
    return wantsJson
      ? c.json({ error: "Missing installationId or repo." }, 400)
      : c.text("Missing installationId or repo.", 400);
  }

  const { parseRepoSlug, createGitHubClient } =
    await import("../../lib/github-api.js");
  const parsed = parseRepoSlug(repo);
  if (!parsed) {
    return wantsJson
      ? c.json({ error: "Invalid repository format." }, 400)
      : c.text("Invalid repository format.", 400);
  }

  // Classify the repo before we commit any state: empty and already-owned
  // targets proceed immediately; foreign or other-site targets require an
  // explicit `confirmForeign` flag from the caller (a typed confirmation
  // in the UI) to avoid silently pushing onto unrelated histories.
  const { classifyRepoForSync } = await import("../../services/github-sync.js");
  const ghClient = createGitHubClient(() =>
    getInstallationTokenFromApp(app, installationId),
  );
  let classification;
  try {
    classification = await classifyRepoForSync(
      ghClient,
      parsed.owner,
      parsed.repo,
      c.var.currentSite.id,
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return wantsJson
      ? c.json({ error: `Could not read repository: ${detail}` }, 500)
      : c.text(`Could not read repository: ${detail}`, 500);
  }

  if (classification.kind === "owned-by-other-site") {
    const msg = `This repository is already backing up another Jant site (${classification.marker.site_host}). Pick a different repository.`;
    return wantsJson
      ? c.json(
          {
            error: msg,
            classification: "owned-by-other-site",
            marker: classification.marker,
          },
          409,
        )
      : c.text(msg, 409);
  }

  if (classification.kind === "foreign" && !confirmForeign) {
    const msg = `${repo} already has commits but isn't managed by Jant. Re-submit with confirmation to push on top of its history.`;
    return wantsJson
      ? c.json(
          {
            error: msg,
            classification: "foreign",
            defaultBranch: classification.defaultBranch,
          },
          409,
        )
      : c.text(msg, 409);
  }

  // Persist config before creating webhook so the sync service can load it.
  await c.var.services.settings.set("GITHUB_SYNC_AUTH_MODE", "app");
  await c.var.services.settings.set(
    "GITHUB_SYNC_APP_INSTALLATION_ID",
    installationId,
  );
  await c.var.services.settings.set("GITHUB_SYNC_REPO", repo);
  await c.var.services.settings.set("GITHUB_SYNC_TOKEN", "");
  await c.var.services.settings.set("GITHUB_SYNC_ENABLED", "true");

  const { createGitHubSyncService } =
    await import("../../services/github-sync.js");
  const syncService = createGitHubSyncService(
    c.var.services,
    c.var.currentSite.id,
    await buildSyncSiteConfig(c),
    { storage: c.var.storage, githubApp: app },
  );
  const siteUrl = c.var.appConfig.siteUrl.replace(/\/+$/, "");
  try {
    await syncService.setupWebhook(`${siteUrl}/api/github-sync/webhook`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const msg = `Connected, but webhook creation failed: ${detail}. You may need to create it manually.`;
    return wantsJson ? c.json({ error: msg }, 500) : c.text(msg, 500);
  }

  // Kick off an initial push so the user's content lands in the repo
  // immediately. We can't use the queue path: CF Queue isn't wired up
  // for most self-hosted deployments, and the noop fallback would
  // silently drop the job. Instead, set PENDING and run the sync in
  // the background via waitUntil. The status page reads PENDING and
  // polls until it clears, so the user sees "Syncing…" right away.
  await markSyncPending(c.var.services.settings);
  const initialSync = runBackgroundSync(c.var.services.settings, syncService);
  try {
    c.executionCtx?.waitUntil(initialSync);
  } catch {
    // executionCtx unavailable (tests / Node) — let the promise resolve
    // on its own; response still returns immediately.
  }

  const redirect = publicPath(c, "/settings/github-sync");
  return wantsJson ? c.json({ ok: true, redirect }) : c.redirect(redirect);
});

// ---------------------------------------------------------------------------
// GitHub App picker JSON API (consumed by the jant-repo-picker component)
// ---------------------------------------------------------------------------

/**
 * Helper: load the GitHub App config or short-circuit with a 404 JSON error.
 */
type RequireAppResult =
  | { app: import("../../lib/env.js").GitHubAppEnvConfig; response: null }
  | { app: null; response: Response };

function requireGitHubApp(c: Context<Env>): RequireAppResult {
  const app = getGitHubAppConfig(c.env);
  if (!app) {
    return {
      app: null,
      response: c.json(
        { error: "GitHub App is not configured on this deployment." },
        404,
      ),
    };
  }
  return { app, response: null };
}

/**
 * Dynamic import shim for `getInstallationToken`. Used by `/connect` to
 * build a client for classification without adding the helper to the
 * top-level imports (the module already lazy-imports github-api).
 */
async function getInstallationTokenFromApp(
  app: import("../../lib/env.js").GitHubAppEnvConfig,
  installationId: string,
): Promise<string> {
  const { getInstallationToken } = await import("../../lib/github-app.js");
  return getInstallationToken(app, installationId);
}

/** List GitHub App installations authorized for this site. */
settingsRoutes.get("/github-sync/app/installations", async (c) => {
  const installations =
    await c.var.services.githubAppInstallations.listInstallationsForSite(
      c.var.currentSite.id,
    );
  return c.json({
    installations: installations.map((entry) => ({
      installationId: entry.installationId,
      account: entry.account,
      addedAt: entry.addedAt,
    })),
  });
});

/**
 * List (or search) repositories accessible via an installation.
 *
 * Query params:
 *   - installationId (required)
 *   - page (default 1) — only used when `q` is empty
 *   - q (optional) — when non-empty switches to GitHub search API
 *
 * 401 from GitHub indicates the installation was removed; we lazy-clean
 * the stored entry and return a 410 so the UI can refresh its list.
 */
settingsRoutes.get("/github-sync/app/repos", async (c) => {
  const { app, response } = requireGitHubApp(c);
  if (!app) return response;

  const installationId = c.req.query("installationId")?.trim();
  if (!installationId) {
    return c.json({ error: "Missing installationId." }, 400);
  }
  const q = c.req.query("q")?.trim() ?? "";
  const pageParam = Number(c.req.query("page") ?? "1");
  const page =
    Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;

  try {
    if (q) {
      const installations =
        await c.var.services.githubAppInstallations.listInstallationsForSite(
          c.var.currentSite.id,
        );
      const installation = installations.find(
        (i) => i.installationId === installationId,
      );
      if (!installation) {
        return c.json({ error: "Unknown installation." }, 404);
      }
      const result = await searchInstallationRepos(
        app,
        installationId,
        installation.account.login,
        q,
      );
      return c.json({
        repos: result.repos,
        totalCount: result.totalCount,
        hasMore: false, // search API doesn't page for us here
        nextPage: null,
        mode: "search",
      });
    }

    const result = await listInstallationReposPage(app, installationId, page);
    return c.json({
      repos: result.repos,
      totalCount: result.totalCount,
      hasMore: result.hasMore,
      nextPage: result.nextPage,
      mode: "list",
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // GitHub returns 401 when an installation was uninstalled on their
    // side. Clean up our cached entry so the UI stops showing a dead owner.
    if (/\b401\b/.test(detail) || /\b404\b/.test(detail)) {
      await c.var.services.githubAppInstallations.removeInstallation(
        installationId,
        c.var.currentSite.id,
      );
      return c.json(
        { error: "Installation is no longer accessible.", removed: true },
        410,
      );
    }
    return c.json({ error: detail }, 500);
  }
});

/**
 * Classify a repo: empty / owned / owned-by-other-site / foreign.
 *
 * The picker calls this when the user picks a repo so it can show an
 * appropriate confirmation UI before submitting `/connect`.
 */
settingsRoutes.post("/github-sync/app/classify", async (c) => {
  const { app, response } = requireGitHubApp(c);
  if (!app) return response;

  const body = (await c.req.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const installationId = String(body.installationId ?? "").trim();
  const repo = String(body.repo ?? "").trim();
  if (!installationId || !repo) {
    return c.json({ error: "Missing installationId or repo." }, 400);
  }

  const { parseRepoSlug, createGitHubClient } =
    await import("../../lib/github-api.js");
  const parsed = parseRepoSlug(repo);
  if (!parsed) {
    return c.json({ error: "Invalid repository format." }, 400);
  }

  const { classifyRepoForSync } = await import("../../services/github-sync.js");
  const client = createGitHubClient(() =>
    getInstallationTokenFromApp(app, installationId),
  );
  try {
    const classification = await classifyRepoForSync(
      client,
      parsed.owner,
      parsed.repo,
      c.var.currentSite.id,
    );
    return c.json({ classification });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return c.json({ error: detail }, 500);
  }
});

settingsRoutes.get("/github-sync", async (c) => {
  const [
    enabled,
    repo,
    lastPushSha,
    webhookId,
    lastPushAt,
    authMode,
    lastError,
  ] = await Promise.all([
    c.var.services.settings.get("GITHUB_SYNC_ENABLED"),
    c.var.services.settings.get("GITHUB_SYNC_REPO"),
    c.var.services.settings.get("GITHUB_SYNC_LAST_PUSH_SHA"),
    c.var.services.settings.get("GITHUB_SYNC_WEBHOOK_ID"),
    c.var.services.settings.get("GITHUB_SYNC_LAST_PUSH_AT"),
    c.var.services.settings.get("GITHUB_SYNC_AUTH_MODE"),
    c.var.services.settings.get("GITHUB_SYNC_LAST_ERROR"),
  ]);
  // Use isSyncPending (not raw flag) so a worker that died mid-push
  // doesn't leave the UI stuck on "Syncing…" forever.
  const pending = await isSyncPending(c.var.services.settings);

  const status: GitHubSyncStatus = {
    enabled: enabled === "true",
    repo: repo ?? null,
    lastPushSha: lastPushSha ?? null,
    webhookId: webhookId ?? null,
    lastPushAt: lastPushAt ? Number(lastPushAt) : null,
    authMode: authMode === "app" ? "app" : "pat",
    appConfigured: getGitHubAppConfig(c.env) !== null,
    pending,
    lastError: lastError || null,
  };

  const navData = await getNavigationData(c);

  return renderPublicPage(c, {
    title: buildPageTitle("GitHub Sync", navData.siteName),
    navData,
    content: (
      <>
        <AdminBreadcrumb
          parent={breadcrumbLabel(c, "settings")}
          parentHref={publicPath(c, "/settings")}
          current={breadcrumbLabel(c, "githubSync")}
        />
        <GitHubSyncContent
          status={status}
          sitePathPrefix={c.var.appConfig.sitePathPrefix}
        />
      </>
    ),
  });
});

// ===========================================================================
// Telegram
// ===========================================================================

settingsRoutes.get("/telegram", async (c) => {
  const view = await readTelegramSettingsView(c);
  const streamUrl = getTelegramStatusStreamUrl(c);
  const navData = await getNavigationData(c);
  return renderPublicPage(c, {
    title: buildPageTitle("Telegram", navData.siteName),
    navData,
    content: (
      <>
        <AdminBreadcrumb
          parent={breadcrumbLabel(c, "settings")}
          parentHref={publicPath(c, "/settings")}
          current={breadcrumbLabel(c, "telegram")}
        />
        <TelegramContent
          view={view}
          sitePathPrefix={c.var.appConfig.sitePathPrefix}
          streamUrl={streamUrl}
        />
      </>
    ),
  });
});

/**
 * Live status stream — swaps the connect view for the connected view the
 * moment a binding lands, so the user doesn't have to refresh after sending
 * the binding code to the bot. Same pattern as GitHub Sync's status stream:
 * subscribed via Datastar `data-init="@get(...)"`, each frame is a
 * `patchElements` with `mode: outer` on the stable `#telegram-status` id.
 *
 * The connected view ships without `data-init`, so the stream closes as
 * soon as we send the first "binding present" frame. A 5-minute cap bounds
 * an abandoned subscription.
 */
settingsRoutes.get("/telegram/status/stream", async (c) => {
  const streamUrl = getTelegramStatusStreamUrl(c);
  // 5 minutes is well above the time a user reasonably spends sending a
  // code to a bot; longer windows just close and the page can be reloaded.
  const MAX_DURATION_MS = 5 * 60 * 1000;
  // 1.5s keeps the UI snappy without hammering the binding table.
  const POLL_INTERVAL_MS = 1500;

  return sse(c, async (stream) => {
    const startedAt = Date.now();
    let lastHtml: string | null = null;

    while (true) {
      const view = await readTelegramSettingsView(c);
      const html = renderTelegramContentHtml(c, view, streamUrl);
      if (html !== lastHtml) {
        stream.patchElements(html, {
          mode: "outer",
          selector: "#telegram-status",
        });
        lastHtml = html;
      }

      // Binding landed: the patch above just shipped the connected view
      // (no `data-init`), so the client will close. A brief beat lets the
      // browser apply the patch before the server-side stream ends.
      if (view.binding) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        break;
      }

      if (Date.now() - startedAt >= MAX_DURATION_MS) break;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  });
});

settingsRoutes.post("/telegram/connect", async (c) => {
  // Token entry is for bring-your-own deployments only. When a managed pool
  // is configured the bot is platform-owned and users connect via a code.
  if (getTelegramBotPool(c.env).length > 0) {
    return dsToast(
      "This deployment uses a managed Telegram bot. Connect with the binding code instead.",
      "error",
    );
  }

  const body = await c.req.json<{ token?: string }>();
  const token = body.token?.trim();
  if (!token) {
    return dsToast("Paste your bot token to continue.", "error");
  }

  const siteUrl = c.var.appConfig.siteUrl.replace(/\/+$/, "");
  try {
    await c.var.services.telegram.connectUserBot(token, siteUrl);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return dsToast(`Could not set up the bot: ${detail}`, "error");
  }

  return dsRedirect(publicPath(c, "/settings/telegram"));
});

settingsRoutes.post("/telegram/remove-bot", async (c) => {
  await c.var.services.telegram.removeUserBot();
  return dsRedirect(publicPath(c, "/settings/telegram"));
});

settingsRoutes.post("/telegram/regenerate-code", async (c) => {
  await c.var.services.telegram.generateCode();
  return dsRedirect(publicPath(c, "/settings/telegram"));
});

settingsRoutes.post("/telegram/disconnect", async (c) => {
  await c.var.services.telegram.disconnect();
  return dsRedirect(publicPath(c, "/settings/telegram"));
});
