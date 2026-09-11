/**
 * What the Jant Discover checkbox says, wherever it appears.
 *
 * The checkbox is on the settings page, and it is asked once more on the
 * first-run setup screen. One control appearing twice should not describe
 * itself two ways, so both surfaces take their words from here rather than
 * each keeping a wording of its own that drifts when the other is edited.
 *
 * The two help lines differ in length, not in wording. Setup shows only the
 * sentence saying what the directory is: the delay, the lists and the rules
 * matter to an author with posts to show, and setup comes before the first
 * one — anyone curious follows the name to the directory itself. The settings
 * line carries that same sentence as its `{about}` placeholder and goes on
 * from there, so the opening can only ever be edited in one place, in every
 * locale.
 *
 * Lives under `ui/dash/` because that is what puts it in the translated
 * catalog: `lingui.config` splits by path, and only `routes/dash/**`,
 * `ui/dash/**` and the setup page are translated.
 */

import { msg } from "@lingui/core/macro";
import type { I18n } from "../../../i18n/i18n.js";
import {
  DISCOVER_LIST_NAMES,
  DISCOVER_PUBLIC_DELAY_HOURS,
} from "../../../lib/discover.js";

type Translator = Pick<I18n, "_">;

/** The Discover checkbox's words, translated. */
export interface DiscoverCopy {
  /** The directory's name, as `label`, `about` and `intro` carry it. */
  name: string;
  /** The rules page's name, as the end of `intro` carries it. */
  rules: string;
  /** The checkbox label, on both surfaces. */
  label: string;
  /** What the directory is, in one sentence: setup's whole help line. */
  about: string;
  /** The settings page's help line, which opens with `about`. */
  intro: string;
}

/**
 * Translate the Discover checkbox's label and help lines.
 *
 * The directory's name and the rules page's name are split out so the label
 * and the help lines can carry them as placeholders, leaving word order free
 * per locale; they are returned too, because `discoverIntroRuns` finds each
 * one in the translated line to make it a link.
 *
 * @param i18n - The request's i18n instance
 * @returns The five strings, in the i18n instance's locale
 * @example
 * ```ts
 * const copy = getDiscoverCopy(i18n);
 * copy.label; // "Allow Jant Discover to list my site"
 * copy.intro.startsWith(copy.about); // true
 * ```
 */
export function getDiscoverCopy(i18n: Translator): DiscoverCopy {
  const name = i18n._(
    msg({
      message: "Jant Discover",
      comment:
        "@context: Name of the Jant blog directory. Appears inside the Discover checkbox label, and in the help line under it as the link to the directory.",
    }),
  );

  // The run of text the rules link sits on, at the end of the help line.
  const rules = i18n._(
    msg({
      message: "Discover community rules",
      comment:
        "@context: Link text at the end of the help line under the Discover checkbox, leading to the directory's page on how blogs are listed: joining, review, and what takes a blog off. This run of text is rendered as the link, so translate it as it should read inside that sentence.",
    }),
  );

  const label = i18n._(
    msg({
      message: "Allow {name} to list my site",
      comment:
        "@context: Checkbox for joining the Jant Discover directory, on the settings page and once on the first-run setup screen. {name} is the directory's name, kept as one run of text.",
    }),
    { name },
  );

  const about = i18n._(
    msg({
      message:
        "{name} is a directory of Jant blogs, curated by hand by the Jant community to help people find new Jant blogs and posts.",
      comment:
        "@context: What the Jant Discover directory is, in one sentence. The whole help line under the Discover checkbox on the first-run setup screen, and the opening of the settings page's longer one. {name} is the directory's name and is rendered as the link to it, so keep it as one run of text.",
    }),
    { name },
  );

  const intro = i18n._(
    msg({
      message:
        "{about} A post you mark Featured appears on the Discover home page {hours} hours later, and link and quote posts appear on the {links} and {quotes} lists {hours} hours after they are published. You can keep editing them in the meantime. See the {rules}.",
      comment:
        "@context: Help text under the Jant Discover checkbox on the settings page. {about} is the sentence saying what the directory is, translated on its own and shown alone on the setup screen; keep it, and join it to what follows as your language joins two sentences. {links} and {quotes} are the directory's two list names, which stay in English, and {rules} is the name of its rules page; each is rendered as a link, so keep every placeholder as one run of text. {hours} is how long the directory waits before showing a post, which is the time left to edit it. 'Featured' is the mark on a post, as this site's own UI spells it; the lowercase 'link and quote' are the post formats, not the lists.",
    }),
    {
      about,
      hours: DISCOVER_PUBLIC_DELAY_HOURS,
      links: DISCOVER_LIST_NAMES.links,
      quotes: DISCOVER_LIST_NAMES.quotes,
      rules,
    },
  );

  return { name, rules, label, about, intro };
}
