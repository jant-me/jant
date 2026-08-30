/**
 * The line under each system nav toggle in Appearance, saying what turning it
 * on does.
 *
 * These live under `ui/dash/` rather than beside the nav labels in `ui/shared/`
 * because that is what puts them in the translated catalog: `lingui.config`
 * splits by path, and only `routes/dash/**`, `ui/dash/**` and the setup page
 * are translated. The labels themselves stay in `ui/shared/` — they render in
 * the public site nav, which is English in every view.
 */

import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import type { I18n, TranslationValues } from "../../../i18n/i18n.js";
import type { SystemNavKey } from "../../../types.js";

type Translator = Pick<I18n, "_">;

const SYSTEM_NAV_DESCRIPTIONS: Record<SystemNavKey, MessageDescriptor> = {
  latest: msg({
    message: "Link to your latest posts. Your homepage shows this feed.",
    comment: "@context: Description for the latest system navigation toggle",
  }),
  featured: msg({
    message: "Link to posts you've marked as featured.",
    comment: "@context: Description for the featured system navigation toggle",
  }),
  // These two sit next to each other in the same list and are the only pair an
  // author has to choose between, so they are written as a contrast: the raw
  // file versus the page about it, readers who already have a feed reader
  // versus readers who do not. Change one and change the other.
  rss: msg({
    message:
      "Links straight to /feed — the raw Atom file, currently your {feed} feed. Best for readers who already use a feed reader.",
    comment:
      "@context: Description for the RSS system navigation toggle. {feed} is either Latest or Featured. Pairs with the Subscribe toggle's description.",
  }),
  subscribe: msg({
    message:
      "Links to /subscribe, a page listing your feeds with copy buttons. Best for readers who don't already use one.",
    comment:
      "@context: Description for the Subscribe system navigation toggle. Pairs with the RSS toggle's description.",
  }),
  settings: msg({
    message: "Shows 'Settings' when logged in, 'Sign in' when logged out",
    comment: "@context: Description for the settings system navigation toggle",
  }),
  collections: msg({
    message: "Link to your collections page",
    comment:
      "@context: Description for the collections system navigation toggle",
  }),
  archive: msg({
    message: "Link to the post archive",
    comment: "@context: Description for the archive system navigation toggle",
  }),
};

/**
 * The description for one system nav toggle.
 *
 * @param key - Which system nav entry
 * @param i18n - Translator for the current request
 * @param values - Placeholder values, for the descriptions that carry one
 * @returns The description text
 * @example
 * getSystemNavDescription("rss", i18n, { feed: "Latest" });
 */
export function getSystemNavDescription(
  key: SystemNavKey,
  i18n: Translator,
  values?: TranslationValues,
): string {
  return i18n._(SYSTEM_NAV_DESCRIPTIONS[key], values);
}
