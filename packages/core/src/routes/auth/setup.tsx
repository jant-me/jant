/**
 * Setup Routes
 *
 * First-run setup, for both ways a Jant site comes into existence.
 *
 * A self-hosted site starts empty and is set up in two screens: the account
 * first, then the site. A hosted site is created by a control plane, which
 * already knows the name and the owner but can only guess at the one thing
 * that shows up in public HTML, feeds and font stacks — the language its
 * author writes in — so it arrives at the second screen and stops there.
 *
 * The split is what makes that true. Between the screens the site stands
 * provisioned with an owner and no answers, which is exactly the state a
 * control plane leaves a hosted site in, so the second screen is one code path
 * asking one site's worth of questions rather than two forms drifting apart.
 * Which step a request is on is never in the URL: it is read from the
 * onboarding status and the session, the only record that survives a closed
 * tab. A `provisioned` site also serves `/signin` normally, so an author who
 * loses the session between the screens signs back in and lands on the second.
 * The first screen is resumable in its own way, for the run that failed partway
 * through it — see `openOwnerSession`, which is the only way out of that one.
 *
 * The cost of standing the site up early is that the public root answers for
 * the width of one screen under the fallback name. On a first run there is
 * nothing there to read, and the alternative was a second "does an owner
 * exist" query wired into the onboarding middleware.
 *
 * Asking little is not the same as saying nothing. A hosted author reaches
 * this page by following a link out of a control plane and lands on a domain
 * they have never seen serve anything, so the screen names the step and the
 * site it belongs to. A self-hosted author has no site name to be told, and
 * gets the count of what is left instead. That is the whole of it: one muted
 * line above the question, no mark and no status summary, because chrome is
 * what made a one-field form look like a gate in the first place. The counter
 * is text and not a stepper on purpose — once the first screen is submitted
 * the account exists and there is no going back, and anything that looked like
 * navigation would say otherwise.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import type { Child, FC, PropsWithChildren } from "hono/jsx";
import { msg } from "@lingui/core/macro";
import { useLingui } from "../../i18n/context.js";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { BaseLayout } from "../../ui/layouts/BaseLayout.js";
import { dsRedirect, dsToast } from "../../lib/sse.js";
import type { ZodError } from "zod";
import {
  deriveAccountName,
  SetupAccountSchema,
  SetupLanguageSchema,
  SetupSiteSchema,
  type SetupLanguageAnswers,
} from "../../lib/schemas.js";
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
import { announceInBackground } from "../discover-announce.js";
import {
  getDiscoverDirectoryUrl,
  resolveDiscoverMode,
  splitLinkedTerm,
} from "../../lib/discover.js";
import {
  getDiscoverDefault,
  getDiscoverDirectoryBaseUrl,
} from "../../lib/env.js";

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
 * settings page's own: one control appearing twice should not describe itself
 * two ways.
 *
 * The help line is the settings page's own catalog entry, message for message,
 * which is what keeps the two surfaces from drifting when either is edited. It
 * used to carry one more sentence — where to find the setting again — but the
 * screen's footnote says that once for every answer on it, and saying it here
 * as well was saying it twice.
 */
const DiscoverField: FC<{
  label: string;
  hint: string;
  /** The word in `hint` the link sits on, and where it goes. */
  directory: string;
  directoryUrl: string | null;
}> = ({ label, hint, directory, directoryUrl }) => {
  const parts = directoryUrl ? splitLinkedTerm(hint, directory) : null;

  return (
    // Held a little further from the field above it than the form's own gap:
    // every other field on this screen is about the site itself, and this one
    // is about the world outside it.
    <div class="field mt-2">
      {/* Classes copied from the settings page's own Discover checkbox
          (`jant-settings-general.ts`), so the control a hosted author meets here
          and the one they find later in Settings are the same object. */}
      <label
        class="flex items-center gap-2 cursor-pointer"
        for="setup-discover"
      >
        <input
          id="setup-discover"
          type="checkbox"
          data-bind="discover"
          class="checkbox"
        />
        <span>{label}</span>
      </label>
      <p class="text-sm text-muted-foreground mt-1">
        {parts ? (
          <>
            {parts.before}
            <a
              href={directoryUrl ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              class="underline hover:text-foreground transition-colors"
            >
              {parts.term}
            </a>
            {parts.after}
          </>
        ) : (
          hint
        )}
      </p>
    </div>
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

/** How many screens a self-hosted setup has, and which one this is. */
const SETUP_STEPS = 2;

/**
 * The frame every first-run screen shares.
 *
 * One muted line carries everything these screens were missing: which step
 * this is, and which site it belongs to. A mark, an address, and a summary of
 * what the control plane already answered were all tried above it and all read
 * as chrome stacked around a form with one field in it.
 *
 * The two facts occupy the same line because no screen ever has both: a
 * self-hosted install is counting steps and has no name yet, and a hosted one
 * has a name and only ever sees a single screen. They are joined rather than
 * chosen between anyway, so a future screen that has both says both.
 */
const SetupShell: FC<
  PropsWithChildren<{
    /** Site being set up. Blank while it has no name yet. */
    siteName?: string;
    /** Which of the self-hosted screens this is. Absent on a hosted site. */
    step?: number;
    heading: string;
    /** What this screen is for, under the heading. Omitted where the heading says it. */
    description?: string;
    /**
     * A note that belongs to the screen but not to the question — set in the
     * card's footer, after the button, where it is read once the answers are
     * given rather than before.
     */
    footnote?: string;
  }>
> = ({ siteName, step, heading, description, footnote, children }) => {
  const { i18n } = useLingui();
  const name = siteName?.trim() ?? "";
  const parts = [setupLabel(i18n)];
  if (step) {
    parts.push(
      i18n._(
        msg({
          message: "Step {current} of {total}",
          comment:
            "@context: How far along first-run setup is, shown beside the screen's name on a self-hosted install",
        }),
        { current: step, total: SETUP_STEPS },
      ),
    );
  }
  if (name) parts.push(name);

  return (
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="card max-w-md w-full">
        <header>
          <p class="mb-2 text-sm text-muted-foreground">{parts.join(" · ")}</p>
          <h2>{heading}</h2>
          {description ? <p>{description}</p> : null}
        </header>
        <section>{children}</section>
        {footnote ? (
          <footer>
            <p class="text-sm text-muted-foreground">{footnote}</p>
          </footer>
        ) : null}
      </div>
    </div>
  );
};

/**
 * The first self-hosted screen: the account, and nothing about the site.
 *
 * Credentials alone is not only less to read: an email and a password with
 * nothing between them is the shape a password manager is looking for, which
 * a form that opens with the site's name and language is not.
 */
const AccountStep: FC<{ action: string; spinner: Child }> = ({
  action,
  spinner,
}) => {
  const { i18n } = useLingui();

  return (
    <SetupShell
      step={1}
      heading={i18n._(
        msg({
          message: "Welcome to Jant",
          comment: "@context: Setup page welcome heading",
        }),
      )}
      description={i18n._(
        msg({
          message: "Create the account you write from.",
          comment:
            "@context: Setup page description on the first screen, which asks only for credentials",
        }),
      )}
    >
      <form
        data-signals="{email: '', password: ''}"
        data-on:submit__prevent={action}
        data-indicator="_loading"
        class="flex flex-col gap-4"
      >
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
            autocomplete="username"
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
            autocomplete="new-password"
            minLength={8}
          />
        </div>
        {/* Not "Complete Setup": there is another screen after this one, and a
            button that claims otherwise is the reason the next one reads as a
            failure rather than a step. */}
        <button type="submit" class="btn" data-attr:disabled="$_loading">
          {spinner}
          {i18n._(
            msg({
              message: "Continue",
              comment:
                "@context: Setup submit button on the first screen, which is followed by the site screen",
            }),
          )}
        </button>
      </form>
    </SetupShell>
  );
};

export type SetupContentProps = {
  sitePathPrefix?: string;
} & (
  | {
      /** The account screen, which a hosted site never sees. */
      mode: "account";
    }
  | {
      /**
       * The site screen: the last question either install kind has left.
       */
      mode: "site";
      /**
       * Whether the site still needs a name — true on a self-hosted install,
       * false on a hosted one the control plane already named.
       *
       * Doubles as which flow this is, and so as whether the step counter
       * shows: only a two-screen setup has a step to count.
       */
      askSiteName: boolean;
      contentLanguage: string;
      /** Shown beside the step name once there is a name, so the site is identified. */
      siteName?: string;
      /**
       * Whether to ask the Discover question at all.
       *
       * False where the answer could not be honoured — a demo site, or feeds
       * switched off — and a control nobody can act on is worse than none.
       */
      discoverAvailable: boolean;
      /**
       * The state the Discover box starts in, derived from the deployment
       * rather than hardcoded per install kind. Hosted Jant sets
       * `DISCOVER=latest`, so a hosted author finds it ticked; a self-hosted
       * install with nothing configured finds it clear.
       */
      discoverDefault: boolean;
      /**
       * The directory itself, for the link in the help line. Null when this
       * deployment announces to no directory, and the line is then plain text.
       */
      discoverUrl: string | null;
    }
);

export const SetupContent: FC<SetupContentProps> = (props) => {
  const { i18n } = useLingui();
  const action = `@post('${toPublicPath("/setup", props.sitePathPrefix ?? "")}')`;
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

  if (props.mode === "account") {
    return <AccountStep action={action} spinner={spinner} />;
  }

  const {
    askSiteName,
    contentLanguage,
    siteName,
    discoverAvailable,
    discoverDefault,
    discoverUrl,
  } = props;

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

  const discoverName = i18n._(
    msg({
      message: "Jant Discover",
      comment:
        "@context: The same name of the Jant blog directory, on the first-run setup screen.",
    }),
  );
  // Passed twice over: once as the value inside the sentence, once as the run
  // of text the link goes on, so the two can never be different words.
  const discoverDirectory = i18n._(
    msg({
      message: "directory",
      comment:
        "@context: The same noun for the Jant Discover list, on the first-run setup screen.",
    }),
  );
  // Rendered even when the question is not asked, so the form can name the
  // signal unconditionally; `discoverAvailable` decides whether the control
  // appears, and an absent field simply sends the default back.
  const discoverField = discoverAvailable ? (
    <DiscoverField
      label={i18n._(
        msg({
          message: "Allow {name} to list my site",
          comment:
            "@context: The settings page's Discover checkbox, asked once on the first-run setup screen. {name} is the directory's name, kept as one run of text.",
        }),
        { name: discoverName },
      )}
      hint={i18n._(
        msg({
          message:
            "{name} is a {directory} of Jant blogs, curated by hand by the Jant community. Posts you mark Featured appear on it.",
          comment:
            "@context: Help text under the Jant Discover checkbox on the first-run setup screen, shorter than the settings page's. {name} is the directory's name; {directory} is the noun for the list itself and is rendered as the link to it, so keep it as one run of text. 'Featured' is the mark on a post, as this site's own UI spells it.",
        }),
        { name: discoverName, directory: discoverDirectory },
      )}
      directory={discoverDirectory}
      directoryUrl={discoverUrl}
    />
  ) : null;

  const signals = [
    askSiteName ? "siteName: ''" : null,
    `contentLanguage: ${JSON.stringify(contentLanguage)}`,
    "language: ''",
    // Only the install that is still choosing its own clock reports one. A
    // hosted site's time zone came from the control plane, and this screen can
    // be opened from anywhere.
    askSiteName ? "timezone: ''" : null,
    `discover: ${discoverAvailable && discoverDefault}`,
  ]
    .filter(Boolean)
    .join(", ");
  const init = [
    "$language = navigator.language || ''",
    askSiteName
      ? "$timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''"
      : null,
  ]
    .filter(Boolean)
    .join("; ");

  return (
    <SetupShell
      siteName={siteName}
      step={askSiteName ? 2 : undefined}
      heading={
        askSiteName
          ? i18n._(
              msg({
                message: "Set up your site",
                comment:
                  "@context: Setup heading on the second self-hosted screen, which asks for the site's name and language",
              }),
            )
          : i18n._(
              msg({
                message: "What language do you write in?",
                comment:
                  "@context: Setup heading on a hosted site, where the language is all that is left to ask",
              }),
            )
      }
      // Not under the heading. Said there, before the questions, it reads as
      // permission to leave them blank; said after the button, it is what it
      // is — a note that nothing here is final.
      footnote={i18n._(
        msg({
          message: "You can change all of this later in Settings.",
          comment:
            "@context: Note at the foot of the last setup screen, after the submit button",
        }),
      )}
    >
      <form
        data-signals={`{${signals}}`}
        data-init={init}
        data-on:submit__prevent={action}
        data-indicator="_loading"
        class="flex flex-col gap-4"
      >
        {askSiteName ? (
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
        ) : null}
        {/* Asked outright rather than inferred from the browser. The inference
            is wrong exactly for the people it matters to — anyone whose browser
            language is not their writing language — and it silently mis-sets
            `<html lang>`, the feed language, and the CJK font stack. */}
        <div class="field">
          {askSiteName ? (
            <label class="label" id="setup-language-label">
              {i18n._(
                msg({
                  message: "Content language",
                  comment: "@context: Setup form field - site content language",
                }),
              )}
            </label>
          ) : (
            // The heading already asks the question, so a visible label would
            // ask it twice.
            <span id="setup-language-label" class="sr-only">
              {i18n._(
                msg({
                  message: "Content language",
                  comment: "@context: Setup form field - site content language",
                }),
              )}
            </span>
          )}
          <LocaleField
            id="setup-content-language"
            labelId="setup-language-label"
            contentLanguage={contentLanguage}
            searchLabel={searchLabel}
            emptyLabel={emptyLabel}
          />
          {askSiteName ? (
            <p class="text-sm text-muted-foreground mt-1">
              {i18n._(
                msg({
                  message: "The language your readers and search engines see.",
                  comment:
                    "@context: Setup form help text under the content language field",
                }),
              )}
            </p>
          ) : null}
        </div>
        {discoverField}
        <button type="submit" class="btn" data-attr:disabled="$_loading">
          {spinner}
          {i18n._(
            msg({
              message: "Start writing",
              comment:
                "@context: Setup submit button on the last screen, after which the site is live",
            }),
          )}
        </button>
      </form>
    </SetupShell>
  );
};

/**
 * Record the Discover answer the setup form carried, and act on it.
 *
 * Stored either way, including a refusal: from here on the author's own answer
 * outranks the deployment's `DISCOVER` default and the `noindex` reading, which
 * is the whole point of asking. An absent field is not a refusal — an older
 * client or a scripted setup sends none — and leaves the default in force.
 *
 * A yes is announced immediately, on the same terms as the settings page's own
 * switch. A directory decides eligibility for itself and re-reads the feed on
 * its own schedule, so a site with nothing published yet loses nothing by
 * saying hello early — it is on the list of addresses to look at, and the
 * looking happens when there is something to see. Waiting instead would mean
 * the answer only takes effect if the author later finds a settings page they
 * have no reason to open, which is not a design, it is a leak.
 *
 * The announcement is not awaited, and so cannot be reported here: a directory
 * takes up to twelve seconds to give up on, and the last screen of setup is not
 * a place to spend them. The outcome is recorded and logged, and the settings
 * page's status block reads it back with a Retry beside it.
 *
 * @param c - The setup request, for its services and its config
 * @param answer - The checkbox, or undefined when the form carried no field
 */
async function storeDiscoverAnswer(
  c: Context<Env>,
  answer: boolean | undefined,
): Promise<void> {
  if (answer === undefined) return;
  const stored = answer ? "latest" : "off";
  const { shouldAnnounce } =
    await c.var.services.settings.updateDiscoverSetting(stored, {
      demoMode: c.var.appConfig.demoMode,
    });
  if (shouldAnnounce) {
    // The value just written, not `allSettings`: that snapshot was taken before
    // this request ran and still holds the deployment default.
    announceInBackground(c, stored);
  }
}

/**
 * Whether this site still owes setup a name of its own.
 *
 * The discriminator between the two ways a site reaches the second screen, and
 * it reads the stored fact rather than a flow flag: a control plane names the
 * site it creates, a self-hosted install does not, and nothing else can put a
 * name there before setup closes.
 *
 * @param c - The setup request, for its settings service
 * @returns True when the second screen must ask for the site's name
 */
async function needsSiteName(c: Context<Env>): Promise<boolean> {
  const stored = await c.var.services.settings.get("SITE_NAME");
  return !stored?.trim();
}

export const setupRoutes = new Hono<Env>();

setupRoutes.get("/setup", async (c) => {
  const status = await c.var.services.settings.getOnboardingStatus();
  const home = toPublicPath("/", c.var.appConfig.sitePathPrefix);
  if (status === ONBOARDING_STATUS.COMPLETED) return c.redirect(home);

  const i18n = getI18n(c);
  const { appConfig } = c.var;
  const title = buildPageTitle(setupLabel(i18n), appConfig.siteName);

  if (status === ONBOARDING_STATUS.PENDING) {
    return c.html(
      <BaseLayout title={title} c={c}>
        <SetupContent
          mode="account"
          sitePathPrefix={appConfig.sitePathPrefix}
        />
      </BaseLayout>,
    );
  }

  // The site now exists and is perfectly readable, so the remaining question
  // belongs to its owner alone — a visitor who is not signed in to this site is
  // sent to the site rather than shown a form they cannot submit.
  if (!(await isCurrentSiteMember(c))) return c.redirect(home);

  const askSiteName = await needsSiteName(c);

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
    <BaseLayout title={title} c={c}>
      <SetupContent
        sitePathPrefix={appConfig.sitePathPrefix}
        mode="site"
        askSiteName={askSiteName}
        // Not asked where it could not be honoured. Both locks outlive setup —
        // a demo site is never listed, and Discover reads an Atom feed — so a
        // ticked box here would be a promise the next screen breaks.
        discoverAvailable={!appConfig.demoMode && appConfig.rssFeedsEnabled}
        discoverDefault={discoverDefault}
        // The same directory the settings page links to, derived from the same
        // configuration, so this screen can never point at one directory while
        // the site announces to another.
        discoverUrl={getDiscoverDirectoryUrl(
          getDiscoverDirectoryBaseUrl(c.env),
        )}
        contentLanguage={
          // On a named site the control plane's guess is already stored, so
          // offering it back is offering the site's current language. On an
          // unnamed one nothing has been stored yet, so the browser's header is
          // the only prefill there is.
          askSiteName
            ? resolveSupportedLocaleTag(c.req.header("Accept-Language"))
            : appConfig.siteLanguage
        }
        // Only a named site has a name worth showing: until the second screen
        // is submitted, `siteName` is still the built-in default.
        siteName={askSiteName ? undefined : appConfig.siteName}
      />
    </BaseLayout>,
  );
});

/**
 * Open the owner's account, or pick up the one an interrupted run already
 * opened.
 *
 * The resume half exists because the first screen is otherwise a place a site
 * can brick itself: if the account is created and standing the site up then
 * fails, the site is left `pending` with a user row in it, and from there
 * `createAuth`'s registration hook refuses every signup — any email, not just
 * this one — while the onboarding middleware sends `/signin` and `/reset` back
 * to this same screen. Nothing in a browser gets out of that.
 *
 * So a failed signup is followed by a sign-in with the credentials just typed.
 * It is safe because of what `pending` means: registration is closed the moment
 * any user exists, so the only row that can be here is the one the interrupted
 * run left, and claiming it takes that row's password. What follows is
 * idempotent, so resuming is simply running the rest again.
 *
 * @param c - The setup request, for its auth instance
 * @param credentials - The address and password the screen collected
 * @returns The owner and the headers that sign them in, or null when neither
 *   opening nor resuming an account worked
 */
async function openOwnerSession(
  c: Context<Env>,
  credentials: { email: string; password: string },
): Promise<{ ownerUserId: string; headers: Headers } | null> {
  const auth = c.var.auth;
  if (!auth) return null;
  const { email, password } = credentials;

  try {
    const { headers, response } = await auth.api.signUpEmail({
      returnHeaders: true,
      // A stand-in until the next screen has a site name to put here. See
      // `deriveAccountName`.
      body: { name: deriveAccountName(email), email, password },
    });
    if (response?.user?.id) {
      return { ownerUserId: response.user.id, headers };
    }
  } catch (err) {
    // Not reported yet: the next attempt is the one that decides whether this
    // is a failure or an interrupted run being picked up.
    // eslint-disable-next-line no-console -- Error logging is intentional
    console.error("Setup sign-up failed:", err);
  }

  try {
    const { headers, response } = await auth.api.signInEmail({
      returnHeaders: true,
      body: { email, password },
    });
    if (response?.user?.id) {
      return { ownerUserId: response.user.id, headers };
    }
  } catch {
    // Nothing to resume, or the wrong password for what is here. Either way
    // the caller says the same thing: check the details and try again.
  }

  return null;
}

/**
 * The first screen's submission: open the owner's account and stand the site
 * up around it.
 *
 * Signs the new owner in on the way out rather than sending them to `/signin`
 * to type the password they just chose. The screen after this one is theirs to
 * answer, and it can only be reached with a session.
 *
 * @param c - The setup request
 * @param body - The submitted form
 */
async function createOwnerAccount(
  c: Context<Env>,
  body: Record<string, string>,
): Promise<Response> {
  const i18n = getI18n(c);

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

  const parsed = SetupAccountSchema.safeParse(body);
  if (!parsed.success) {
    return dsToast(validationMessage(i18n, parsed.error), "error");
  }

  const owner = await openOwnerSession(c, parsed.data);
  if (!owner) {
    return dsToast(accountCreationFailedMessage(i18n), "error");
  }

  try {
    await c.var.services.bootstrap.provisionOwnerAccount({
      ownerUserId: owner.ownerUserId,
    });
  } catch (err) {
    // The failure that used to be unrecoverable. The account survives it, so
    // the next attempt resumes through `openOwnerSession` rather than trying to
    // create it a second time.
    // eslint-disable-next-line no-console -- Error logging is intentional
    console.error("Setup error:", err);
    return dsToast(accountCreationFailedMessage(i18n), "error");
  }

  // Back to the same URL: the status this just wrote is what decides which
  // screen answers, so the second step needs no address of its own.
  return dsRedirect(toPublicPath("/setup", c.var.appConfig.sitePathPrefix), {
    headers: owner.headers,
  });
}

/**
 * The last screen's submission, for both install kinds: record what the author
 * said about their site and let them in.
 *
 * The two schemas are parsed in separate branches rather than picked between,
 * so a site name can only reach the service when the schema that requires one
 * is the schema that ran.
 *
 * @param c - The setup request
 * @param body - The submitted form
 */
async function completeSiteSetup(
  c: Context<Env>,
  body: Record<string, string>,
): Promise<Response> {
  const i18n = getI18n(c);

  // Membership is the check that makes "the owner is answering" true: a session
  // alone can belong to someone this site has never heard of, and this branch
  // writes the site's own name and language.
  if (!(await isCurrentSiteMember(c))) {
    return dsRedirect(
      toPublicPath("/signin?redirect=/setup", c.var.appConfig.sitePathPrefix),
    );
  }

  if (await needsSiteName(c)) {
    const parsed = SetupSiteSchema.safeParse(body);
    if (!parsed.success) {
      return dsToast(validationMessage(i18n, parsed.error), "error");
    }
    return storeSiteAnswers(c, body, parsed.data, parsed.data.siteName);
  }

  const parsed = SetupLanguageSchema.safeParse(body);
  if (!parsed.success) {
    return dsToast(validationMessage(i18n, parsed.error), "error");
  }
  return storeSiteAnswers(c, body, parsed.data, undefined);
}

/**
 * Write the last screen's answers and send the author into their site.
 *
 * @param c - The setup request
 * @param body - The submitted form, for the two values the browser reports
 *   rather than the author choosing: its language and its time zone
 * @param answers - The validated answers both install kinds share
 * @param siteName - The name, on an install that was asked for one
 */
async function storeSiteAnswers(
  c: Context<Env>,
  body: Record<string, string>,
  answers: SetupLanguageAnswers,
  siteName: string | undefined,
): Promise<Response> {
  const auth = c.var.auth;

  await c.var.services.bootstrap.completeSiteSetup(
    {
      siteName,
      siteLanguage: answers.contentLanguage,
      browserLanguage: body.language,
      // Left alone on a site whose clock the control plane already set: this
      // screen can be opened from anywhere, and the browser reporting a
      // different zone is not the author moving their site.
      timeZone: siteName ? mapIanaToTimezone(body.timezone ?? "") : undefined,
    },
    { oldLanguage: c.var.appConfig.siteLanguage },
    {
      // better-auth requires user.name to stay aligned with the active site
      // display name for the current operator, the same way saving the general
      // settings page does.
      updateCurrentUserName: auth
        ? async (displayName) => {
            await auth.api.updateUser({
              body: { name: displayName },
              headers: c.req.raw.headers,
            });
          }
        : null,
    },
  );

  await storeDiscoverAnswer(c, answers.discover);

  return dsRedirect(toPublicPath("/", c.var.appConfig.sitePathPrefix));
}

setupRoutes.post("/setup", async (c) => {
  const status = await c.var.services.settings.getOnboardingStatus();
  if (status === ONBOARDING_STATUS.COMPLETED)
    return c.redirect(toPublicPath("/", c.var.appConfig.sitePathPrefix));

  const body = await c.req.json<Record<string, string>>();

  return status === ONBOARDING_STATUS.PENDING
    ? createOwnerAccount(c, body)
    : completeSiteSetup(c, body);
});

/**
 * The first thing a rejected setup form got wrong, in words.
 *
 * @param i18n - The request's catalog
 * @param error - What the schema rejected
 * @returns The first issue's message, or a general one when it carried none
 */
function validationMessage(
  i18n: ReturnType<typeof getI18n>,
  error: ZodError,
): string {
  return (
    error.issues[0]?.message ??
    i18n._(
      msg({
        message: "Something doesn't look right. Check the form and try again.",
        comment: "@context: Fallback validation error for setup form",
      }),
    )
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
