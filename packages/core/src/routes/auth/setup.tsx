/**
 * Setup Routes
 *
 * Initial admin account creation during first-time setup.
 */

import { Hono } from "hono";
import type { FC } from "hono/jsx";
import { msg } from "@lingui/core/macro";
import { useLingui } from "../../i18n/context.js";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { BaseLayout } from "../../ui/layouts/BaseLayout.js";
import { dsRedirect, dsToast } from "../../lib/sse.js";
import { SetupSchema } from "../../lib/schemas.js";
import { buildPageTitle } from "../../lib/page-title.js";
import { mapIanaToTimezone } from "../../lib/timezones.js";
import { getI18n } from "../../i18n/index.js";
import {
  getSupportedLocaleEntries,
  resolveSupportedLocaleTag,
} from "../../i18n/supported-locales.js";
import { toPublicPath } from "../../lib/url.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

const SetupContent: FC<{
  sitePathPrefix?: string;
  contentLanguage: string;
}> = ({ sitePathPrefix = "", contentLanguage }) => {
  const { i18n } = useLingui();
  const localeOptions = getSupportedLocaleEntries();

  return (
    <div class="min-h-screen flex items-center justify-center">
      <div class="card max-w-md w-full">
        <header>
          <h2>
            {i18n._(
              msg({
                message: "Welcome to Jant",
                comment: "@context: Setup page welcome heading",
              }),
            )}
          </h2>
          <p>
            {i18n._(
              msg({
                message: "Create your admin account.",
                comment: "@context: Setup page description",
              }),
            )}
          </p>
        </header>
        <section>
          <form
            data-signals={`{siteName: '', email: '', password: '', timezone: '', language: '', contentLanguage: ${JSON.stringify(contentLanguage)}}`}
            data-init="$timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; $language = navigator.language || ''"
            data-on:submit__prevent={`@post('${toPublicPath("/setup", sitePathPrefix)}')`}
            data-indicator="_loading"
            class="flex flex-col gap-4"
          >
            <div class="field">
              <label class="label">
                {i18n._(
                  msg({
                    message: "Site Name",
                    comment: "@context: Setup form field - site name",
                  }),
                )}
              </label>
              <input
                type="text"
                data-bind="siteName"
                class="input"
                required
                placeholder="My Blog"
              />
            </div>
            {/* Asked outright rather than inferred from the browser. The
                inference is wrong exactly for the people it matters to — anyone
                whose browser language is not their writing language — and it
                silently mis-sets `<html lang>`, the feed language, and the CJK
                font stack. `data-init` above prefills it, so confirming costs a
                glance. */}
            <div class="field">
              <label class="label" for="setup-content-language">
                {i18n._(
                  msg({
                    message: "Content language",
                    comment:
                      "@context: Setup form field - site content language",
                  }),
                )}
              </label>
              <select
                id="setup-content-language"
                data-bind="contentLanguage"
                class="select"
              >
                {localeOptions.map((entry) => (
                  <option
                    key={entry.tag}
                    value={entry.tag}
                    selected={entry.tag === contentLanguage}
                  >
                    {entry.native === entry.english
                      ? entry.native
                      : `${entry.native} (${entry.english})`}
                  </option>
                ))}
              </select>
              <p class="text-sm text-muted-foreground mt-1">
                {i18n._(
                  msg({
                    message:
                      "The language your readers and search engines see.",
                    comment:
                      "@context: Setup form help text under the content language field",
                  }),
                )}
              </p>
            </div>
            <div class="field">
              <label class="label">
                {i18n._(
                  msg({
                    message: "Email",
                    comment: "@context: Setup/signin form field - email",
                  }),
                )}
              </label>
              <input
                type="email"
                data-bind="email"
                class="input"
                required
                placeholder="you@example.com"
              />
            </div>
            <div class="field">
              <label class="label">
                {i18n._(
                  msg({
                    message: "Password",
                    comment: "@context: Setup/signin form field - password",
                  }),
                )}
              </label>
              <input
                type="password"
                data-bind="password"
                class="input"
                required
                minLength={8}
              />
            </div>
            <button type="submit" class="btn" data-attr:disabled="$_loading">
              <svg
                data-show="$_loading"
                style="display:none"
                class="animate-spin size-4"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                role="status"
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              {i18n._(
                msg({
                  message: "Complete Setup",
                  comment: "@context: Setup form submit button",
                }),
              )}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
};

export const setupRoutes = new Hono<Env>();

setupRoutes.get("/setup", async (c) => {
  const isComplete = await c.var.services.settings.isOnboardingComplete();
  if (isComplete)
    return c.redirect(toPublicPath("/", c.var.appConfig.sitePathPrefix));

  return c.html(
    <BaseLayout title={buildPageTitle("Setup", c.var.appConfig.siteName)} c={c}>
      <SetupContent
        sitePathPrefix={c.var.appConfig.sitePathPrefix}
        contentLanguage={resolveSupportedLocaleTag(
          c.req.header("Accept-Language"),
        )}
      />
    </BaseLayout>,
  );
});

setupRoutes.post("/setup", async (c) => {
  const i18n = getI18n(c);
  const isComplete = await c.var.services.settings.isOnboardingComplete();
  if (isComplete)
    return c.redirect(toPublicPath("/", c.var.appConfig.sitePathPrefix));

  const body = await c.req.json<Record<string, string>>();
  const parsed = SetupSchema.safeParse(body);
  const browserTimezone = body.timezone;
  const browserLanguage = body.language;

  if (!parsed.success) {
    const errorMsg =
      parsed.error.issues[0]?.message ??
      i18n._(
        msg({
          message:
            "Something doesn't look right. Check the form and try again.",
          comment: "@context: Fallback validation error for setup form",
        }),
      );
    return dsToast(errorMsg, "error");
  }

  const { siteName, email, password, contentLanguage } = parsed.data;

  if (!c.var.auth) {
    return dsToast(
      i18n._(
        msg({
          message: "Auth secret is missing. Check your environment variables.",
          comment:
            "@context: Error toast when authentication secret is missing from server config",
        }),
      ),
      "error",
    );
  }

  try {
    const signUpResponse = await c.var.auth.api.signUpEmail({
      body: { name: siteName.trim(), email, password },
    });

    if (!signUpResponse || "error" in signUpResponse) {
      return dsToast(
        i18n._(
          msg({
            message:
              "Couldn't create your account. Check the details and try again.",
            comment: "@context: Error toast when account creation fails",
          }),
        ),
        "error",
      );
    }

    const ownerUserId = signUpResponse.user?.id;
    if (!ownerUserId) {
      return dsToast(
        i18n._(
          msg({
            message:
              "Couldn't create your account. Check the details and try again.",
            comment: "@context: Error toast when account creation fails",
          }),
        ),
        "error",
      );
    }

    const timeZone = mapIanaToTimezone(browserTimezone ?? "");

    await c.var.services.bootstrap.completeInitialSetup({
      ownerUserId,
      siteName,
      timeZone,
      siteLanguage:
        contentLanguage ?? resolveSupportedLocaleTag(browserLanguage),
      browserLanguage,
    });

    return dsRedirect(
      toPublicPath("/signin?setup", c.var.appConfig.sitePathPrefix),
    );
  } catch (err) {
    // eslint-disable-next-line no-console -- Error logging is intentional
    console.error("Setup error:", err);
    return dsToast(
      i18n._(
        msg({
          message:
            "Couldn't create your account. Check the details and try again.",
          comment: "@context: Error toast when account creation fails",
        }),
      ),
      "error",
    );
  }
});
