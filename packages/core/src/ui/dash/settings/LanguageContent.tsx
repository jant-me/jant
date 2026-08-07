/**
 * Language settings page.
 *
 * Server-side template that renders the <jant-settings-language> Lit element
 * with its labels and initial state. Every language-related setting lives here
 * — the site's content language, the dashboard's UI language, and multilingual
 * content — so there is one place to look rather than two.
 *
 * The page is called "Language" rather than "Multilingual" on purpose: it also
 * holds settings a single-language author owns, and they should not have to
 * recognize a feature name they never turned on to find their site's language.
 */

import { msg } from "@lingui/core/macro";
import { useLingui } from "../../../i18n/context.js";
import { getSupportedLocaleEntries } from "../../../i18n/supported-locales.js";
import type { Locale } from "../../../i18n/locales.js";

/**
 * A value that renders as its own placeholder.
 *
 * Lingui resolves an ICU message completely at `i18n._()` time, so a message
 * whose value is only known in the browser cannot simply be shipped as a
 * template — its plurals would be formatted against `undefined`. Passing the
 * placeholder back as the value leaves that one slot intact for the component
 * to fill, while everything else in the message is translated and formatted
 * here as usual.
 *
 * @param name - Placeholder name in the message
 * @returns The literal `{name}` text
 * @example
 * i18n._(msg({ message: "Remove {language}" }), {
 *   language: keepPlaceholder("language"),
 * }); // => "Remove {language}"
 */
function keepPlaceholder(name: string): string {
  return `{${name}}`;
}

export interface LanguageContentProps {
  /** Site content language, and primary language when multilingual is on. */
  contentLanguage: string;
  /** Resolved dashboard catalog locale currently in effect. */
  dashboardLanguage: Locale;
  /** Whether per-language browsing views are being served. */
  multilingualEnabled: boolean;
  /** Additional languages in switcher order. */
  additionalLanguages: string[];
  /** Posts with no language yet — the number the enable dialog quotes. */
  unmarkedPostCount: number;
  sitePathPrefix: string;
}

export function LanguageContent({
  contentLanguage,
  dashboardLanguage,
  multilingualEnabled,
  additionalLanguages,
  unmarkedPostCount,
  sitePathPrefix,
}: LanguageContentProps) {
  const { i18n } = useLingui();

  const labels = JSON.stringify({
    siteSection: i18n._(
      msg({
        message: "Site",
        comment:
          "@context: Language settings section for reader-facing settings",
      }),
    ),
    dashboardSection: i18n._(
      msg({
        message: "Dashboard",
        comment:
          "@context: Language settings section for author-facing settings",
      }),
    ),
    contentLanguage: i18n._(
      msg({
        message: "Content language",
        comment: "@context: Language settings field — the site's language",
      }),
    ),
    contentLanguageHelp: i18n._(
      msg({
        message: "The language your readers and search engines see.",
        comment: "@context: Help text for the content language field",
      }),
    ),
    primaryLanguage: i18n._(
      msg({
        message: "Primary language",
        comment:
          "@context: Label the content language field takes once multilingual is on",
      }),
    ),
    primaryLanguageHelp: i18n._(
      msg({
        message: "The root address (/, /feed) shows this language.",
        comment: "@context: Help text for the primary language field",
      }),
    ),
    dashboardLanguage: i18n._(
      msg({
        message: "Dashboard language",
        comment: "@context: Language settings field — the admin UI language",
      }),
    ),
    dashboardLanguageHelp: i18n._(
      msg({
        message: "The language of your admin pages. Only you see this.",
        comment: "@context: Help text for the dashboard language field",
      }),
    ),
    followContent: i18n._(
      msg({
        message: "Follow content language",
        comment:
          "@context: Dashboard language option that follows the site language",
      }),
    ),
    multilingual: i18n._(
      msg({
        message: "Multilingual content",
        comment: "@context: Language settings toggle for multilingual content",
      }),
    ),
    multilingualHelp: i18n._(
      msg({
        message:
          "Give each language its own home page, archive, and feed. You pick a language when you publish, and can link posts as translations of one another.",
        comment: "@context: Help text for the multilingual content toggle",
      }),
    ),
    otherLanguages: i18n._(
      msg({
        message: "Other languages",
        comment: "@context: Label for the list of non-primary languages",
      }),
    ),
    addLanguage: i18n._(
      msg({
        message: "Add language",
        comment: "@context: Button that adds another content language",
      }),
    ),
    removeLanguage: i18n._(
      msg({
        message: "Remove {language}",
        comment: "@context: Accessible label on the button removing a language",
      }),
      { language: keepPlaceholder("language") },
    ),
    enableTitle: i18n._(
      msg({
        message: "Turn on multilingual content",
        comment: "@context: Title of the multilingual confirmation dialog",
      }),
    ),
    enableWhatHappensTitle: i18n._(
      msg({
        message: "What turning this on does",
        comment:
          "@context: Heading above the multilingual dialog's effect list",
      }),
    ),
    enableEffectViews: i18n._(
      msg({
        message:
          "Each language gets its own home page, archive, feed, and collection pages.",
        comment: "@context: Multilingual dialog effect — per-language views",
      }),
    ),
    enableEffectCompose: i18n._(
      msg({
        message:
          "You choose a language when you publish, and can link posts as translations of one another.",
        comment: "@context: Multilingual dialog effect — composing",
      }),
    ),
    enableEffectUrls: i18n._(
      msg({
        message:
          "Post addresses do not change. The primary language keeps the root address; the others get a URL prefix.",
        comment: "@context: Multilingual dialog effect — URLs",
      }),
    ),
    enableEffectReversible: i18n._(
      msg({
        message:
          "You can turn this off again at any time without losing anything.",
        comment: "@context: Multilingual dialog effect — reversibility",
      }),
    ),
    enableMarkTitle: i18n._(
      msg({
        message: "One-time change to your existing posts",
        comment:
          "@context: Title of the stamping warning in the multilingual dialog",
      }),
    ),
    enableMarkWarning: i18n._(
      msg({
        message:
          "Your {count, plural, one {# existing post} other {# existing posts}} will be marked as {language}.",
        comment:
          "@context: Warning in the multilingual dialog about stamping existing posts",
      }),
      // The count is fixed for this page load, so Lingui resolves the plural
      // here. The language is picked inside the dialog, so its placeholder is
      // carried through untouched and filled in by the component.
      { count: unmarkedPostCount, language: keepPlaceholder("language") },
    ),
    enableMarkWarningEmpty: i18n._(
      msg({
        message: "You have no posts yet, so nothing gets marked.",
        comment:
          "@context: Variant of the stamping warning when the site has no posts",
      }),
    ),
    enableFixHint: i18n._(
      msg({
        message:
          "Any post written in another language can be corrected from its own menu afterwards.",
        comment: "@context: Follow-up hint under the stamping warning",
      }),
    ),
    enableNeedsLanguage: i18n._(
      msg({
        message: "Add at least one more language to turn this on.",
        comment:
          "@context: Validation message when the multilingual dialog has no second language",
      }),
    ),
    enableConfirm: i18n._(
      msg({
        message: "Mark posts and turn on",
        comment: "@context: Confirm button in the multilingual dialog",
      }),
    ),
    changePrimaryTitle: i18n._(
      msg({
        message: "Change the primary language?",
        comment: "@context: Title of the change-primary-language dialog",
      }),
    ),
    changePrimaryBody: i18n._(
      msg({
        message:
          "{next} will be served at the root address (/, /feed, /archive), and {previous} moves to {prefix}. Post addresses do not change, but anyone subscribed to /feed starts receiving {next} posts.",
        comment: "@context: Body of the change-primary-language dialog",
      }),
      {
        next: keepPlaceholder("next"),
        previous: keepPlaceholder("previous"),
        prefix: keepPlaceholder("prefix"),
      },
    ),
    changePrimaryConfirm: i18n._(
      msg({
        message: "Switch",
        comment:
          "@context: Confirm button in the change-primary-language dialog",
      }),
    ),
    disableTitle: i18n._(
      msg({
        message: "Turn off multilingual content?",
        comment: "@context: Title of the disable-multilingual dialog",
      }),
    ),
    disableBody: i18n._(
      msg({
        message:
          "The root address goes back to showing every language, and addresses like {prefix} redirect to it, so existing links and feed subscriptions keep working. Post addresses and each post's language are unchanged, so you can turn this back on any time.",
        comment: "@context: Body of the disable-multilingual dialog",
      }),
      { prefix: keepPlaceholder("prefix") },
    ),
    disableConfirm: i18n._(
      msg({
        message: "Turn off",
        comment: "@context: Confirm button in the disable-multilingual dialog",
      }),
    ),
    cancel: i18n._(
      msg({ message: "Cancel", comment: "@context: Dialog cancel button" }),
    ),
    save: i18n._(
      msg({ message: "Save", comment: "@context: Settings save button" }),
    ),
    saving: i18n._(
      msg({
        message: "Saving…",
        comment: "@context: Settings save in progress",
      }),
    ),
    searchPlaceholder: i18n._(
      msg({
        message: "Search…",
        comment: "@context: Placeholder in the language picker search box",
      }),
    ),
    noMatches: i18n._(
      msg({
        message: "No matches.",
        comment: "@context: Empty state in the language picker",
      }),
    ),
    urlPreview: i18n._(
      msg({
        message: "Reader URLs:",
        comment: "@context: Label above the per-language URL preview",
      }),
    ),
  }).replace(/</g, "\\u003c");

  const locales = JSON.stringify(
    getSupportedLocaleEntries().map((entry) => ({
      tag: entry.tag,
      native: entry.native,
      english: entry.english,
      coverage: entry.coverage,
    })),
  ).replace(/</g, "\\u003c");

  const initialState = JSON.stringify({
    contentLanguage,
    dashboardLanguage,
    multilingualEnabled,
    additionalLanguages,
    unmarkedPostCount,
    sitePathPrefix,
  }).replace(/</g, "\\u003c");

  return (
    <>
      <div class="flex flex-col max-w-form">
        <jant-settings-language labels={labels} locales={locales}>
          {/* SSR fallback skeleton */}
          <div>
            <h2 class="skel-label" />
            <div class="skel-section-lg" />
          </div>
        </jant-settings-language>
      </div>

      <script
        type="application/json"
        id="language-settings-initial-data"
        dangerouslySetInnerHTML={{ __html: initialState }}
      />
    </>
  );
}
