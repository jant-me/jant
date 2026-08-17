/**
 * View language: which language's browsing surface a request is asking for.
 *
 * A multilingual site keeps its primary language at the root (`/`, `/archive`,
 * `/feed`) and gives every other language a URL prefix (`/en`, `/zh-hant`).
 * The prefix selects a *view* — it filters the timeline, feeds and collection
 * pages to that language — and it does not change any post's own address.
 *
 * Everything a handler needs to stay inside its view goes through
 * `toViewPath()`, so a page rendered at `/en` links to `/en?page=2` rather
 * than throwing the reader back to the primary language on the second page.
 */

import type { Context } from "hono";
import type { Bindings } from "../types/bindings.js";
import type { AppVariables } from "../types/app-context.js";
import type {
  LanguageAlternate,
  LanguageSwitcherOption,
} from "../types/views.js";
import { toLanguagePrefix } from "../i18n/locales.js";
import { getOrBuildEntry } from "../i18n/supported-locales.js";
import { isPerLanguageSurface } from "./per-language-surfaces.js";
import { toAbsoluteSiteUrl, toPublicPath } from "./url.js";

type ViewContext = Context<{ Bindings: Bindings; Variables: AppVariables }>;

export type { LanguageAlternate, LanguageSwitcherOption };

/**
 * What the first path segment of a request means.
 *
 * - `pass` — not a language prefix; the request belongs to another route.
 * - `redirect` — a language prefix that has no view right now (the primary
 *   language's own prefix, or any prefix left over from before multilingual
 *   was switched off). Old links and feed subscriptions keep working.
 * - `view` — serve this language's view.
 */
export type LanguageViewDecision =
  | { kind: "pass" }
  | { kind: "redirect"; to: string }
  | { kind: "view"; lang: string };

const PASS: LanguageViewDecision = { kind: "pass" };

/** First segment of an internal path, without its slashes. */
function firstSegment(path: string): string {
  const rest = path.startsWith("/") ? path.slice(1) : path;
  const slash = rest.indexOf("/");
  return slash === -1 ? rest : rest.slice(0, slash);
}

/** The same path with its first segment removed, always rooted at `/`. */
function stripFirstSegment(path: string): string {
  const rest = path.startsWith("/") ? path.slice(1) : path;
  const slash = rest.indexOf("/");
  return slash === -1 ? "/" : rest.slice(slash);
}

/** Query string of the current request, including `?`, or an empty string. */
function queryString(c: ViewContext): string {
  const index = c.req.url.indexOf("?");
  return index === -1 ? "" : c.req.url.slice(index);
}

/**
 * Decide what the language prefix in the current URL means.
 *
 * A site that has never configured a second language gets `pass` for every
 * request — its posts are free to use any first segment they like, including
 * ones that happen to look like language tags (`/is`, `/it`, `/no`).
 *
 * @param c - Request context, after `withConfig()`
 * @returns How the request should be handled
 * @example
 * // On a site serving zh-Hans (primary) and en:
 * resolveLanguageView(c); // GET /en/archive  → { kind: "view", lang: "en" }
 * resolveLanguageView(c); // GET /zh-hans     → { kind: "redirect", to: "/" }
 * resolveLanguageView(c); // GET /hello       → { kind: "pass" }
 */
export function resolveLanguageView(c: ViewContext): LanguageViewDecision {
  const { siteLanguage, additionalLanguages, multilingualEnabled } =
    c.var.appConfig;

  const primaryPrefix = toLanguagePrefix(siteLanguage);
  const configured = additionalLanguages.filter(
    (tag) => toLanguagePrefix(tag) !== primaryPrefix,
  );
  if (configured.length === 0) return PASS;

  const segment = firstSegment(c.req.path).toLowerCase();
  if (!segment) return PASS;

  const redirect = (): LanguageViewDecision => ({
    kind: "redirect",
    to: `${toPublicPath(
      stripFirstSegment(c.req.path),
      c.var.appConfig.sitePathPrefix,
    )}${queryString(c)}`,
  });

  // The primary language is served from the root, so its own prefix is only
  // ever an alias for it (§4.3).
  if (segment === primaryPrefix) return redirect();

  const match = configured.find((tag) => toLanguagePrefix(tag) === segment);
  if (!match) return PASS;

  return multilingualEnabled ? { kind: "view", lang: match } : redirect();
}

/**
 * Every URL prefix a path on this site can arrive under.
 *
 * The site's own languages, the primary one included: its prefix has no view
 * of its own but still redirects to the root, so `/zh-hans/hello` names the
 * same page as `/hello`. Empty on a site with one language, where a first
 * segment that looks like a language tag is just a post's slug.
 *
 * Use it to resolve an address the author pasted; requests themselves are
 * decided by {@link resolveLanguageView}, which knows view from redirect.
 *
 * @param config - Site language settings
 * @returns Prefixes without slashes, e.g. `["zh-hans", "en"]`
 */
export function languageUrlPrefixes(config: {
  siteLanguage: string;
  additionalLanguages: readonly string[];
}): string[] {
  const primaryPrefix = toLanguagePrefix(config.siteLanguage);
  const others = config.additionalLanguages
    .map((tag) => toLanguagePrefix(tag))
    .filter((prefix) => prefix !== primaryPrefix);

  return others.length === 0 ? [] : [primaryPrefix, ...new Set(others)];
}

/**
 * Whether the current URL carries a language prefix.
 *
 * Distinct from `getViewLang()`: the root URLs of a multilingual site show the
 * primary language, so they *have* a view language while having no prefix.
 *
 * @param c - Request context
 * @returns True when the request came in under `/en`-style URLs
 */
export function isPrefixedLanguageView(c: ViewContext): boolean {
  return c.var.viewLang !== undefined;
}

/**
 * The language the current view shows, for filtering content.
 *
 * On a multilingual site the root is the primary language's view, so this
 * returns the primary language there rather than "no filter" — otherwise `/`
 * would show every language while `/en` showed one, and the primary language
 * would have no view of its own.
 *
 * @param c - Request context
 * @returns Canonical BCP 47 tag, or `null` when the site is single-language
 */
export function getViewLang(c: ViewContext): string | null {
  if (c.var.viewLang) return c.var.viewLang;

  const { siteLanguage, additionalLanguages, multilingualEnabled } =
    c.var.appConfig;
  if (!multilingualEnabled) return null;

  const primaryPrefix = toLanguagePrefix(siteLanguage);
  const hasSecondLanguage = additionalLanguages.some(
    (tag) => toLanguagePrefix(tag) !== primaryPrefix,
  );
  return hasSecondLanguage ? siteLanguage : null;
}

/**
 * URL prefix of the current view, for building in-view links.
 *
 * @param c - Request context
 * @returns `/en`-style prefix, or an empty string on the root view
 */
export function viewBasePath(c: ViewContext): string {
  const lang = c.var.viewLang;
  return lang ? `/${toLanguagePrefix(lang)}` : "";
}

/**
 * URL prefix of the view a given language is served under.
 *
 * A post page belongs to its own language's site: its chrome — logo, nav,
 * search — links into that language's view, so a reader on a Japanese post
 * stays among Japanese surfaces. Post pages render at language-neutral URLs,
 * so this is derived from the post's language rather than the request path.
 *
 * @param c - Request context
 * @param lang - Content language of the page, or null/undefined when unknown
 * @returns `/ja`-style prefix for an active non-primary language, otherwise
 *   an empty string (the root view)
 * @example
 * languageScopeBasePath(c, "ja"); // "/ja" on a zh-Hans + ja site
 * languageScopeBasePath(c, "zh-Hans"); // "" — the primary lives at the root
 */
export function languageScopeBasePath(
  c: ViewContext,
  lang: string | null | undefined,
): string {
  if (!lang) return "";
  const { siteLanguage } = c.var.appConfig;
  const prefix = toLanguagePrefix(lang);
  if (prefix === toLanguagePrefix(siteLanguage)) return "";
  const active = getViewLanguages(c).some(
    (tag) => toLanguagePrefix(tag) === prefix,
  );
  return active ? `/${prefix}` : "";
}

/**
 * Build a public path that stays inside the current language view.
 *
 * Use this for every in-page link a handler generates — pagination, filter
 * chips, feed autodiscovery, JSON-LD. Post permalinks are deliberately *not*
 * view-scoped: a post has one address whatever view it was reached from.
 *
 * @param c - Request context
 * @param path - Internal app path such as `/archive`
 * @returns Public path, prefixed by the view language and the site path prefix
 * @example
 * toViewPath(c, "/"); // "/" at the root, "/en" under the English view
 * toViewPath(c, "/archive"); // "/archive" or "/en/archive"
 */
export function toViewPath(c: ViewContext, path = "/"): string {
  const base = viewBasePath(c);
  const { sitePathPrefix } = c.var.appConfig;
  if (!base) return toPublicPath(path, sitePathPrefix);
  const suffix = path === "/" || path === "" ? "" : path;
  return toPublicPath(`${base}${suffix}`, sitePathPrefix);
}

/**
 * The request path with the language prefix removed.
 *
 * Handlers that resolve a path against the site's own content — the
 * `path_registry` catch-all above all — work on this, so `/en/hello` and
 * `/hello` resolve to the same row.
 *
 * @param c - Request context
 * @returns Internal path rooted at `/`, without the view prefix
 */
export function viewRelativePath(c: ViewContext): string {
  return c.var.viewLang ? stripFirstSegment(c.req.path) : c.req.path;
}

// The table of per-language surfaces lives in its own module so the client can
// import it too — a link built in the browser needs the same answer.
export { isPerLanguageSurface };

/**
 * Build a path inside an arbitrary language's view.
 *
 * Used by the language switcher, which links out of the current view.
 *
 * @param c - Request context
 * @param lang - Target language tag, or `null` for the primary view
 * @param path - Internal app path such as `/archive`
 * @returns Public path in that language's view
 */
export function toLanguagePath(
  c: ViewContext,
  lang: string | null,
  path = "/",
): string {
  const { sitePathPrefix, siteLanguage } = c.var.appConfig;
  const isPrimary =
    !lang || toLanguagePrefix(lang) === toLanguagePrefix(siteLanguage);
  if (isPrimary) return toPublicPath(path, sitePathPrefix);
  const suffix = path === "/" || path === "" ? "" : path;
  return toPublicPath(`/${toLanguagePrefix(lang)}${suffix}`, sitePathPrefix);
}

/**
 * Every language the site serves a view for, primary first.
 *
 * @param c - Request context
 * @returns Canonical tags, or an empty array when multilingual is off
 */
export function getViewLanguages(c: ViewContext): string[] {
  const { siteLanguage, additionalLanguages, multilingualEnabled } =
    c.var.appConfig;
  if (!multilingualEnabled) return [];
  const primaryPrefix = toLanguagePrefix(siteLanguage);
  const rest = additionalLanguages.filter(
    (tag) => toLanguagePrefix(tag) !== primaryPrefix,
  );
  return rest.length === 0 ? [] : [siteLanguage, ...rest];
}

/**
 * The site's languages as the composer offers them.
 *
 * Empty on a single-language site, which is what makes the composer show no
 * language UI at all — an author who never turned multilingual content on
 * should never meet it.
 *
 * @param c - Request context
 * @returns Tag and native label per language, primary first
 */
export function buildComposeLanguages(
  c: ViewContext,
): Array<{ tag: string; label: string }> {
  return getViewLanguages(c).map((tag) => ({
    tag,
    label: getOrBuildEntry(tag).native,
  }));
}

/**
 * Build the site's language switcher for the current page.
 *
 * The switcher means "take me to this language's site", not "translate this
 * page": from a list surface it goes to that surface in the other language,
 * from a post it goes to the translation when one exists, and from anywhere
 * without a counterpart in that language — a post with no translation, a
 * settings page — it goes to that language's home. It is never disabled and
 * never warns: a reader who lands on a language's home page has still
 * arrived somewhere, and it never links to a 404.
 *
 * @param c - Request context
 * @param options - Per-language destinations, and where to go without one
 * @returns Switcher entries in configured order, or an empty array when the
 *   site serves one language
 * @example
 * buildLanguageSwitcher(c); // list surfaces: same path, each language
 * buildLanguageSwitcher(c, {
 *   hrefByLanguage: new Map([["en", "/my-post"]]),
 *   fallbackPath: "/",
 * }); // a post: its translations, else that language's home
 */
export function buildLanguageSwitcher(
  c: ViewContext,
  options: {
    hrefByLanguage?: ReadonlyMap<string, string>;
    fallbackPath?: string;
    /** Language to mark as current. Defaults to the view's own language. */
    currentLang?: string;
  } = {},
): LanguageSwitcherOption[] {
  const languages = getViewLanguages(c);
  if (languages.length === 0) return [];

  const currentPath = viewRelativePath(c);
  const fallbackPath =
    options.fallbackPath ??
    (isPerLanguageSurface(currentPath) ? currentPath : "/");
  const currentPrefix = toLanguagePrefix(
    options.currentLang || getViewLang(c) || c.var.appConfig.siteLanguage,
  );
  const primaryPrefix = toLanguagePrefix(c.var.appConfig.siteLanguage);

  return languages.map((lang) => {
    const override = options.hrefByLanguage?.get(lang);
    return {
      lang,
      label: getOrBuildEntry(lang).native,
      href: override
        ? toPublicPath(override, c.var.appConfig.sitePathPrefix)
        : toLanguagePath(c, lang, fallbackPath),
      isCurrent: toLanguagePrefix(lang) === currentPrefix,
      isPrimary: toLanguagePrefix(lang) === primaryPrefix,
    };
  });
}

/**
 * `hreflang` alternates for the surface the current request is rendering.
 *
 * List surfaces exist once per language at the same path, so every language's
 * copy of the current path is an alternate of it.
 *
 * No `x-default` is emitted: it would have to point at the primary language's
 * URL, and hono/jsx collapses `<link>` elements that share an `href`, so it
 * would silently replace the primary language's own alternate. It is optional
 * in the spec, and search engines fall back to the primary language anyway.
 *
 * Returns an empty array on a single-language site, and when the site has no
 * absolute URL configured — an hreflang `href` must be absolute to be honoured.
 *
 * @param c - Request context
 * @returns Alternates for this surface, primary first
 * @example
 * // Rendering /en/archive on a zh-Hans + en site:
 * buildSurfaceAlternates(c);
 * // [{hreflang: "zh-Hans", href: "https://…/archive"},
 * //  {hreflang: "en", href: "https://…/en/archive"},
 * //  {hreflang: "x-default", href: "https://…/archive"}]
 */
export function buildSurfaceAlternates(c: ViewContext): LanguageAlternate[] {
  const languages = getViewLanguages(c);
  const { siteUrl, sitePathPrefix } = c.var.appConfig;
  if (languages.length === 0 || !siteUrl) return [];

  const path = viewRelativePath(c);
  const query = queryString(c);
  const primaryPrefix = toLanguagePrefix(c.var.appConfig.siteLanguage);

  const alternates = languages.map((lang) => {
    const prefix = toLanguagePrefix(lang);
    const internal =
      prefix === primaryPrefix ? path : `/${prefix}${path === "/" ? "" : path}`;
    return {
      hreflang: lang,
      href: `${toAbsoluteSiteUrl(internal, siteUrl, sitePathPrefix)}${query}`,
    };
  });

  // A reader whose language the site does not publish lands on the primary one.
  const primary = alternates[0];
  if (primary) {
    alternates.push({ hreflang: "x-default", href: primary.href });
  }
  return alternates;
}
