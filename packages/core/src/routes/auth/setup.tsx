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
import type { Context } from "hono";
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
import { isCurrentSiteMember } from "../../middleware/auth.js";
import type { I18n } from "../../i18n/i18n.js";
import {
  getSupportedLocaleEntries,
  resolveSupportedLocaleTag,
} from "../../i18n/supported-locales.js";
import { toPublicPath } from "../../lib/url.js";
import { ONBOARDING_STATUS } from "../../lib/constants.js";
import { resolveDiscoverMode } from "../../lib/discover.js";
import { getDiscoverDefault } from "../../lib/env.js";

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
 * The one question setup asks about the world outside this site.
 *
 * It earns a place on a screen that asks as little as it can because the
 * setting behind it is otherwise three clicks into Settings, and an author who
 * never goes looking never learns a directory exists. The wording is the
 * settings page's own, word for word: one control appearing twice should not
 * describe itself two ways.
 *
 * Both the label and the help line are shared catalog entries rather than
 * setup-specific copy, which is what keeps the two surfaces from drifting when
 * either is edited.
 */
const DiscoverField: FC<{ label: string; hint: string }> = ({
  label,
  hint,
}) => (
  <div class="field">
    {/* Classes copied from the settings page's own Discover checkbox
        (`jant-settings-general.ts`), so the control a hosted author meets here
        and the one they find later in Settings are the same object. */}
    <label class="flex items-center gap-2 cursor-pointer" for="setup-discover">
      <input
        id="setup-discover"
        type="checkbox"
        data-bind="discover"
        class="checkbox"
      />
      <span>{label}</span>
    </label>
    <p class="text-sm text-muted-foreground mt-1">{hint}</p>
  </div>
);

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
  /**
   * Whether to ask the Discover question at all.
   *
   * False where the answer could not be honoured — a demo site, or feeds
   * switched off — and a control nobody can act on is worse than none.
   */
  discoverAvailable: boolean;
  /**
   * The state the Discover box starts in, derived from the deployment rather
   * than hardcoded per install kind. Hosted Jant sets `DISCOVER=latest`, so a
   * hosted author finds it ticked; a self-hosted install with nothing
   * configured finds it clear.
   */
  discoverDefault: boolean;
}> = ({
  sitePathPrefix = "",
  contentLanguage,
  mode,
  siteName,
  discoverAvailable,
  discoverDefault,
}) => {
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

  // Rendered even when the question is not asked, so both forms can name the
  // signal unconditionally; `discoverAvailable` decides whether the control
  // appears, and an absent field simply sends the default back.
  const discoverField = discoverAvailable ? (
    <DiscoverField
      label={i18n._(
        msg({
          message: "Allow {name} to list my site",
          comment:
            "@context: The settings page's Discover checkbox, asked once on the first-run setup screen. Here {name} is plain text rather than a link; keep it as one run of text either way.",
        }),
        { name: "Jant Discover" },
      )}
      hint={i18n._(
        msg({
          message:
            "A public list of Jant blogs. It shows your blog's latest post 24 hours after you publish it, and links back to your site.",
          comment:
            "@context: The same help line under the Discover checkbox, on the first-run setup screen.",
        }),
      )}
    />
  ) : null;
  const discoverSignal = `discover: ${discoverAvailable && discoverDefault}`;

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
            message: "Change it any time in Settings.",
            comment:
              "@context: Setup page description under the write-language question",
          }),
        )}
      >
        <form
          data-signals={`{contentLanguage: ${JSON.stringify(contentLanguage)}, language: '', ${discoverSignal}}`}
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
          {discoverField}
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
        data-signals={`{siteName: '', email: '', password: '', timezone: '', language: '', contentLanguage: ${JSON.stringify(contentLanguage)}, ${discoverSignal}}`}
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
          {discoverField}
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

/**
 * Record the Discover answer the setup form carried.
 *
 * Stored either way, including a refusal: from here on the author's own answer
 * outranks the deployment's `DISCOVER` default and the `noindex` reading, which
 * is the whole point of asking. An absent field is not a refusal — an older
 * client or a scripted setup sends none — and leaves the default in force.
 *
 * **Nothing is announced.** At first run a self-hosted site is usually not
 * reachable from the internet yet: DNS unpointed, still on localhost. The ping
 * answers 202 for everything, so announcing then would record a success against
 * an address that answers nothing — and that stored success is exactly what
 * hides the retry the owner would later need. The settings page shows "not
 * announced yet" beside the button instead, which is the true state of a site
 * that is not live.
 *
 * @param c - The setup request, for its services and its config
 * @param answer - The checkbox, or undefined when the form carried no field
 */
async function storeDiscoverAnswer(
  c: Context<Env>,
  answer: boolean | undefined,
): Promise<void> {
  if (answer === undefined) return;
  await c.var.services.settings.updateDiscoverSetting(
    answer ? "latest" : "off",
    { demoMode: c.var.appConfig.demoMode },
  );
}

export const setupRoutes = new Hono<Env>();

setupRoutes.get("/setup", async (c) => {
  const status = await c.var.services.settings.getOnboardingStatus();
  const home = toPublicPath("/", c.var.appConfig.sitePathPrefix);
  if (status === ONBOARDING_STATUS.COMPLETED) return c.redirect(home);

  // On a provisioned site the remaining question belongs to its owner, and the
  // site is perfectly readable meanwhile — so a visitor who is not signed in to
  // this site is sent to the site rather than shown a form they cannot submit.
  const isProvisioned = status === ONBOARDING_STATUS.PROVISIONED;
  if (isProvisioned && !(await isCurrentSiteMember(c))) return c.redirect(home);

  const i18n = getI18n(c);
  const { appConfig } = c.var;

  // Read through the same derivation the feed uses, so the box shows what this
  // site would declare if the author changed nothing. `storedValue` is null by
  // construction: setup runs before anyone has answered.
  const discoverDefault =
    resolveDiscoverMode({
      storedValue: null,
      defaultValue: getDiscoverDefault(c.env),
      demoMode: appConfig.demoMode,
      noindex: appConfig.noindex,
      rssFeedsEnabled: appConfig.rssFeedsEnabled,
    }) !== "none";

  return c.html(
    <BaseLayout
      title={buildPageTitle(setupLabel(i18n), c.var.appConfig.siteName)}
      c={c}
    >
      <SetupContent
        sitePathPrefix={c.var.appConfig.sitePathPrefix}
        mode={isProvisioned ? "language" : "full"}
        // Not asked where it could not be honoured. Both locks outlive setup —
        // a demo site is never listed, and Discover reads an Atom feed — so a
        // ticked box here would be a promise the next screen breaks.
        discoverAvailable={!appConfig.demoMode && appConfig.rssFeedsEnabled}
        discoverDefault={discoverDefault}
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
    // about their own site. Membership is the check that makes that true: a
    // session alone can belong to someone this site has never heard of, and
    // this branch writes the site's language.
    if (!(await isCurrentSiteMember(c))) {
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

    await storeDiscoverAnswer(c, parsed.data.discover);

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

    await storeDiscoverAnswer(c, parsed.data.discover);

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
