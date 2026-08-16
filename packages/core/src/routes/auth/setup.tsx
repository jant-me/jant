/**
 * Setup Routes
 *
 * First-run setup, for both ways a Jant site comes into existence.
 *
 * A self-hosted site starts empty: setup creates the admin account and the site
 * shell together. A hosted site is created by a control plane, which already
 * knows the name and the owner but can only guess at the one thing that shows
 * up in public HTML, feeds and font stacks — the language its author writes in.
 *
 * Both cases are the same page asking only for what is still unanswered, rather
 * than two flows that drift apart. It is deliberately one screen in either case:
 * with four fields at most, a wizard would add steps, chrome, and a half-created
 * account to recover from, in exchange for nothing.
 *
 * Asking little is not the same as saying nothing. A hosted author reaches this
 * page by following a link out of a control plane and lands on a domain they
 * have never seen serve anything, so the screen names the step and the site it
 * belongs to. That is the whole of it: one muted line above the question, no
 * mark and no status summary, because chrome is what made a one-field form look
 * like a gate in the first place.
 */

import { Hono } from "hono";
import type { FC, PropsWithChildren } from "hono/jsx";
import { msg } from "@lingui/core/macro";
import { useLingui } from "../../i18n/context.js";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { BaseLayout } from "../../ui/layouts/BaseLayout.js";
import { dsRedirect, dsToast } from "../../lib/sse.js";
import { SetupLanguageSchema, SetupSchema } from "../../lib/schemas.js";
import { buildPageTitle } from "../../lib/page-title.js";
import { mapIanaToTimezone } from "../../lib/timezones.js";
import { getI18n } from "../../i18n/index.js";
import type { I18n } from "../../i18n/i18n.js";
import {
  getSupportedLocaleEntries,
  resolveSupportedLocaleTag,
} from "../../i18n/supported-locales.js";
import { toPublicPath } from "../../lib/url.js";
import { ONBOARDING_STATUS } from "../../lib/constants.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

/**
 * The language field, as a plain `<select>` plus the picker that replaces it.
 *
 * The select is the form's real control and stays so; the picker takes over on
 * upgrade and writes back to it. Stylesheet rule `jant-locale-picker:not(:defined)`
 * keeps the picker out of the layout until then, so only one control is ever
 * visible.
 */
const LocaleField: FC<{
  id: string;
  labelId: string;
  contentLanguage: string;
  searchLabel: string;
  emptyLabel: string;
}> = ({ id, labelId, contentLanguage, searchLabel, emptyLabel }) => {
  const entries = getSupportedLocaleEntries();
  const locales = JSON.stringify(
    entries.map((entry) => ({
      tag: entry.tag,
      native: entry.native,
      english: entry.english,
      coverage: entry.coverage,
    })),
  ).replace(/</g, "\\u003c");
  const labels = JSON.stringify({
    search: searchLabel,
    empty: emptyLabel,
  }).replace(/</g, "\\u003c");

  return (
    <>
      {/* The real form field, and the whole control until the picker upgrades.
          Datastar binds to it, so the picker writing here is enough — it never
          needs to know a signal exists. */}
      <select id={id} data-bind="contentLanguage" class="select">
        {entries.map((entry) => (
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
      <jant-locale-picker
        for={id}
        labelledby={labelId}
        value={contentLanguage}
        locales={locales}
        labels={labels}
        full-width
      />
    </>
  );
};

/**
 * What this screen is called, in the tab title and above the card alike, so
 * the two never drift into naming the same page differently.
 */
function setupLabel(i18n: I18n): string {
  return i18n._(
    msg({
      message: "Setup",
      comment:
        "@context: Name of the first-run setup screen — shown above the setup card and as the browser tab title",
    }),
  );
}

/**
 * The frame both first-run screens share.
 *
 * One muted line carries everything this screen was missing: what step this is,
 * and which site it belongs to. A mark, an address, and a summary of what the
 * control plane already answered were all tried above it and all read as chrome
 * stacked around a form with one field in it.
 */
const SetupShell: FC<
  PropsWithChildren<{
    /** Site being set up. Blank while it has no name yet. */
    siteName?: string;
    heading: string;
    description: string;
  }>
> = ({ siteName, heading, description, children }) => {
  const { i18n } = useLingui();
  const name = siteName?.trim() ?? "";

  return (
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="card max-w-md w-full">
        <header>
          <p class="mb-2 text-sm text-muted-foreground">
            {setupLabel(i18n)}
            {name ? ` · ${name}` : null}
          </p>
          <h2>{heading}</h2>
          <p>{description}</p>
        </header>
        <section>{children}</section>
      </div>
    </div>
  );
};

export const SetupContent: FC<{
  sitePathPrefix?: string;
  contentLanguage: string;
  /**
   * `full` builds the site and its account from nothing; `language` runs on a
   * site a control plane already created, where that is all that is left.
   */
  mode: "full" | "language";
  /** Shown beside the step name in `language` mode, so the site is identified. */
  siteName?: string;
}> = ({ sitePathPrefix = "", contentLanguage, mode, siteName }) => {
  const { i18n } = useLingui();
  const action = `@post('${toPublicPath("/setup", sitePathPrefix)}')`;
  const searchLabel = i18n._(
    msg({
      message: "Search…",
      comment: "@context: Placeholder in the language picker search box",
    }),
  );
  const emptyLabel = i18n._(
    msg({
      message: "No matches.",
      comment: "@context: Empty state in the language picker",
    }),
  );
  const spinner = (
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
  );

  if (mode === "language") {
    return (
      <SetupShell
        siteName={siteName}
        heading={i18n._(
          msg({
            message: "What language do you write in?",
            comment:
              "@context: Setup heading on a hosted site, where the language is all that is left to ask",
          }),
        )}
        description={i18n._(
          msg({
            message:
              "It sets the language readers and search engines see. Change it any time in Settings.",
            comment:
              "@context: Setup page description under the write-language question",
          }),
        )}
      >
        <form
          data-signals={`{contentLanguage: ${JSON.stringify(contentLanguage)}, language: ''}`}
          data-init="$language = navigator.language || ''"
          data-on:submit__prevent={action}
          data-indicator="_loading"
          class="flex flex-col gap-4"
        >
          <div class="field">
            <span id="setup-language-label" class="sr-only">
              {i18n._(
                msg({
                  message: "Content language",
                  comment: "@context: Setup form field - site content language",
                }),
              )}
            </span>
            <LocaleField
              id="setup-content-language"
              labelId="setup-language-label"
              contentLanguage={contentLanguage}
              searchLabel={searchLabel}
              emptyLabel={emptyLabel}
            />
          </div>
          <button type="submit" class="btn" data-attr:disabled="$_loading">
            {spinner}
            {i18n._(
              msg({
                message: "Start writing",
                comment:
                  "@context: Setup submit button on a hosted site, after the language question",
              }),
            )}
          </button>
        </form>
      </SetupShell>
    );
  }

  return (
    <SetupShell
      heading={i18n._(
        msg({
          message: "Welcome to Jant",
          comment: "@context: Setup page welcome heading",
        }),
      )}
      description={i18n._(
        msg({
          message: "Set up your site and the account you write from.",
          comment: "@context: Setup page description",
        }),
      )}
    >
      <form
        data-signals={`{siteName: '', email: '', password: '', timezone: '', language: '', contentLanguage: ${JSON.stringify(contentLanguage)}}`}
        data-init="$timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; $language = navigator.language || ''"
        data-on:submit__prevent={action}
        data-indicator="_loading"
        class="flex flex-col gap-6"
      >
        {/* Two groups, not four loose fields: what the site is, then who
                writes it. The order matters — the site is why someone is here,
                and credentials read as the price of admission when they come
                second rather than first. */}
        <fieldset class="flex flex-col gap-4">
          <legend class="mb-3 text-sm font-medium text-muted-foreground">
            {i18n._(
              msg({
                message: "Site",
                comment: "@context: Setup form group - the site itself",
              }),
            )}
          </legend>
          <div class="field">
            <label class="label" for="setup-site-name">
              {i18n._(
                msg({
                  message: "Site Name",
                  comment: "@context: Setup form field - site name",
                }),
              )}
            </label>
            <input
              id="setup-site-name"
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
            <label class="label" id="setup-language-label">
              {i18n._(
                msg({
                  message: "Content language",
                  comment: "@context: Setup form field - site content language",
                }),
              )}
            </label>
            <LocaleField
              id="setup-content-language"
              labelId="setup-language-label"
              contentLanguage={contentLanguage}
              searchLabel={searchLabel}
              emptyLabel={emptyLabel}
            />
            <p class="text-sm text-muted-foreground mt-1">
              {i18n._(
                msg({
                  message: "The language your readers and search engines see.",
                  comment:
                    "@context: Setup form help text under the content language field",
                }),
              )}
            </p>
          </div>
        </fieldset>

        {/* The rule lives on a wrapper, not the fieldset: a legend sits
                inside its own fieldset's border box, so a border there would
                run straight through the word. */}
        <div class="border-t pt-6">
          <fieldset class="flex flex-col gap-4">
            <legend class="mb-3 text-sm font-medium text-muted-foreground">
              {i18n._(
                msg({
                  message: "Account",
                  comment:
                    "@context: Setup form group - the admin account being created",
                }),
              )}
            </legend>
            <div class="field">
              <label class="label" for="setup-email">
                {i18n._(
                  msg({
                    message: "Email",
                    comment: "@context: Setup/signin form field - email",
                  }),
                )}
              </label>
              <input
                id="setup-email"
                type="email"
                data-bind="email"
                class="input"
                required
                placeholder="you@example.com"
              />
            </div>
            <div class="field">
              <label class="label" for="setup-password">
                {i18n._(
                  msg({
                    message: "Password",
                    comment: "@context: Setup/signin form field - password",
                  }),
                )}
              </label>
              <input
                id="setup-password"
                type="password"
                data-bind="password"
                class="input"
                required
                minLength={8}
              />
            </div>
          </fieldset>
        </div>

        <button type="submit" class="btn" data-attr:disabled="$_loading">
          {spinner}
          {i18n._(
            msg({
              message: "Complete Setup",
              comment: "@context: Setup form submit button",
            }),
          )}
        </button>
      </form>
    </SetupShell>
  );
};

export const setupRoutes = new Hono<Env>();

setupRoutes.get("/setup", async (c) => {
  const status = await c.var.services.settings.getOnboardingStatus();
  const home = toPublicPath("/", c.var.appConfig.sitePathPrefix);
  if (status === ONBOARDING_STATUS.COMPLETED) return c.redirect(home);

  // On a provisioned site the remaining question belongs to its owner, and the
  // site is perfectly readable meanwhile — so a signed-out visitor is sent to
  // the site rather than shown a form they cannot submit.
  const isProvisioned = status === ONBOARDING_STATUS.PROVISIONED;
  if (isProvisioned && !c.var.isAuthenticated) return c.redirect(home);

  const i18n = getI18n(c);

  return c.html(
    <BaseLayout
      title={buildPageTitle(setupLabel(i18n), c.var.appConfig.siteName)}
      c={c}
    >
      <SetupContent
        sitePathPrefix={c.var.appConfig.sitePathPrefix}
        mode={isProvisioned ? "language" : "full"}
        contentLanguage={
          // On a provisioned site the control plane's guess is already stored,
          // so offering it back is offering the site's current language.
          isProvisioned
            ? c.var.appConfig.siteLanguage
            : resolveSupportedLocaleTag(c.req.header("Accept-Language"))
        }
        // Only the provisioned screen has a name worth showing: before setup
        // runs, `siteName` is still the built-in default.
        siteName={isProvisioned ? c.var.appConfig.siteName : undefined}
      />
    </BaseLayout>,
  );
});

setupRoutes.post("/setup", async (c) => {
  const i18n = getI18n(c);
  const status = await c.var.services.settings.getOnboardingStatus();
  if (status === ONBOARDING_STATUS.COMPLETED)
    return c.redirect(toPublicPath("/", c.var.appConfig.sitePathPrefix));

  const body = await c.req.json<Record<string, string>>();
  const browserLanguage = body.language;

  if (status === ONBOARDING_STATUS.PROVISIONED) {
    // The account already exists, so this is the owner answering a question
    // about their own site — never an anonymous request.
    if (!c.var.isAuthenticated) {
      return dsRedirect(
        toPublicPath("/signin?redirect=/setup", c.var.appConfig.sitePathPrefix),
      );
    }

    const parsed = SetupLanguageSchema.safeParse(body);
    if (!parsed.success) {
      return dsToast(
        parsed.error.issues[0]?.message ?? fallbackValidationMessage(i18n),
        "error",
      );
    }

    await c.var.services.settings.confirmFirstRunLanguage(
      {
        siteLanguage: parsed.data.contentLanguage,
        browserLanguage,
      },
      { oldLanguage: c.var.appConfig.siteLanguage },
    );

    return dsRedirect(toPublicPath("/", c.var.appConfig.sitePathPrefix));
  }

  const parsed = SetupSchema.safeParse(body);
  const browserTimezone = body.timezone;

  if (!parsed.success) {
    return dsToast(
      parsed.error.issues[0]?.message ?? fallbackValidationMessage(i18n),
      "error",
    );
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
      return dsToast(accountCreationFailedMessage(i18n), "error");
    }

    const ownerUserId = signUpResponse.user?.id;
    if (!ownerUserId) {
      return dsToast(accountCreationFailedMessage(i18n), "error");
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
    return dsToast(accountCreationFailedMessage(i18n), "error");
  }
});

function fallbackValidationMessage(i18n: ReturnType<typeof getI18n>): string {
  return i18n._(
    msg({
      message: "Something doesn't look right. Check the form and try again.",
      comment: "@context: Fallback validation error for setup form",
    }),
  );
}

function accountCreationFailedMessage(
  i18n: ReturnType<typeof getI18n>,
): string {
  return i18n._(
    msg({
      message: "Couldn't create your account. Check the details and try again.",
      comment: "@context: Error toast when account creation fails",
    }),
  );
}
