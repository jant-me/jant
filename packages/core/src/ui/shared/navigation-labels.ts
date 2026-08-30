import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { I18n } from "../../i18n/i18n.js";
import { isFullUrl, stripSitePathPrefix } from "../../lib/url.js";
import type { NavItemType, SystemNavKey } from "../../types.js";

type Translator = Pick<I18n, "_">;

type NavigationLabelItem = {
  type: NavItemType;
  systemKey?: SystemNavKey;
  label: string;
  url: string;
  targetTitle?: string;
};

// `context: "nav"` gives these site-header labels a distinct Lingui hash so
// they don't collide with identically-worded strings in the settings surface
// (e.g. the "Latest"/"Featured" radios on the General settings page). The
// header nav is shared between public and admin pages — keeping it untranslated
// everywhere makes the chrome feel consistent and avoids routing quirks.
const BUILTIN_NAV_LABELS = {
  latest: msg({
    message: "Latest",
    context: "nav",
    comment: "@context: Built-in navigation label for the latest feed",
  }),
  featured: msg({
    message: "Featured",
    context: "nav",
    comment: "@context: Built-in navigation label for the featured feed",
  }),
  collections: msg({
    message: "Collections",
    context: "nav",
    comment: "@context: Built-in navigation label for the collections page",
  }),
  archive: msg({
    message: "All",
    context: "nav",
    comment:
      "@context: Built-in navigation label for the archive page. Reads as the widest of Featured / Latest / All rather than 'old posts' — the page is the complete index, and its URL stays /archive.",
  }),
  settings: msg({
    message: "Settings",
    context: "nav",
    comment: "@context: Built-in navigation label for settings",
  }),
  rss: msg({
    message: "RSS",
    context: "nav",
    comment:
      "@context: Built-in navigation label for the feed. Keep the acronym in every locale — it is what readers scan for. The document /feed serves is Atom, but RSS is the category name readers and feed apps use, and it matches the vocabulary the rest of the product already speaks (systemKey `rss`, `mainRssFeed`). 'Feed' would collide with Featured/Latest/All, which are feeds too.",
  }),
  subscribe: msg({
    message: "Subscribe",
    context: "nav",
    comment:
      "@context: Built-in navigation label for the page that explains the site's feeds. Names what the reader wants to do, unlike the sibling RSS entry which names the format and links at the Atom document itself.",
  }),
  signIn: msg({
    message: "Sign in",
    context: "nav",
    comment: "@context: Built-in navigation label shown when auth is required",
  }),
  more: msg({
    message: "More",
    context: "nav",
    comment: "@context: Built-in navigation label for the More dropdown",
  }),
} as const;

/**
 * Shared message descriptor for the nav "More" dropdown button. Re-exported
 * so the real site header (public) and the nav preview inside settings resolve
 * to the same Lingui hash in the public catalog — the preview would otherwise
 * produce a colliding hash in the settings catalog and leak a translation
 * back onto the real header.
 */
export const NAV_MORE_LABEL = BUILTIN_NAV_LABELS.more;

/**
 * The default label for every system nav entry.
 *
 * Total on purpose: this is the map both the settings toggle list and the
 * rendered navigation read, so a new `SystemNavKey` without an entry here is a
 * compile error rather than a nav item that renders blank.
 */
const SYSTEM_NAV_TITLES: Record<SystemNavKey, MessageDescriptor> = {
  latest: BUILTIN_NAV_LABELS.latest,
  featured: BUILTIN_NAV_LABELS.featured,
  collections: BUILTIN_NAV_LABELS.collections,
  archive: BUILTIN_NAV_LABELS.archive,
  settings: BUILTIN_NAV_LABELS.settings,
  rss: BUILTIN_NAV_LABELS.rss,
  subscribe: BUILTIN_NAV_LABELS.subscribe,
};

function getInternalNavPath(url: string, sitePathPrefix = ""): string | null {
  if (
    isFullUrl(url) ||
    url.startsWith("//") ||
    url.startsWith("mailto:") ||
    url.startsWith("tel:") ||
    url.startsWith("#")
  ) {
    return null;
  }

  try {
    const pathname = new URL(url, "https://jant.invalid").pathname;
    return stripSitePathPrefix(pathname, sitePathPrefix) ?? pathname;
  } catch {
    return null;
  }
}

function getBuiltinNavLabelDescriptor(
  item: NavigationLabelItem,
  sitePathPrefix = "",
): MessageDescriptor | null {
  if (item.type !== "system" || !item.systemKey) return null;

  // Settings is the one entry whose label depends on where it currently
  // points, so it cannot be read from the key alone.
  if (item.systemKey === "settings") {
    const path = getInternalNavPath(item.url, sitePathPrefix);
    return path === "/signin"
      ? BUILTIN_NAV_LABELS.signIn
      : BUILTIN_NAV_LABELS.settings;
  }

  return SYSTEM_NAV_TITLES[item.systemKey] ?? null;
}

/**
 * The text a nav item shows.
 *
 * A stored label is always the author's own words, so it wins outright. An
 * empty one means the item follows what it points at: a built-in destination
 * shows its translated default, a page or collection shows that row's current
 * title — which is also how a nav entry ends up in the reader's language once
 * a language view has resolved it to a translated page.
 *
 * @param item - Nav item, view or raw
 * @param i18n - Translator for built-in destinations
 * @param sitePathPrefix - Deployment path prefix, such as `/blog`
 * @returns Label to render
 */
export function getNavItemDisplayLabel(
  item: NavigationLabelItem,
  i18n: Translator,
  sitePathPrefix = "",
): string {
  if (item.label) return item.label;

  const descriptor = getBuiltinNavLabelDescriptor(item, sitePathPrefix);
  if (descriptor) return i18n._(descriptor);

  return item.targetTitle?.trim() || item.label;
}

export function getSystemNavDisplayLabel(
  key: SystemNavKey,
  i18n: Translator,
): string {
  return i18n._(SYSTEM_NAV_TITLES[key]);
}
