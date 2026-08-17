import {
  ASSET_BASE_PATH,
  isAssetPath,
  toPublicAssetPath,
} from "../lib/asset-path.js";
import { toPublicHref } from "../lib/url.js";
import { isPerLanguageSurface } from "../lib/per-language-surfaces.js";

type FetchInput = Parameters<typeof fetch>[0];

/**
 * The deployment's public path prefix, as the server stamped it on the page.
 *
 * @returns Prefix like `/blog`, or an empty string when the site is rooted
 */
export function sitePathPrefix(): string {
  return document.documentElement.dataset.sitePathPrefix || "";
}

function assetBasePath(): string {
  return document.documentElement.dataset.assetBasePath || ASSET_BASE_PATH;
}

function viewBasePath(): string {
  const base = document.documentElement.dataset.viewBasePath;
  return base === undefined ? sitePathPrefix() : base;
}

export function publicPath(path: string): string {
  if (isAssetPath(path)) {
    return toPublicAssetPath(path, assetBasePath());
  }
  return toPublicHref(path, sitePathPrefix());
}

/**
 * Build a link to a target the caller knows exists once per language.
 *
 * The client-side counterpart of the server's `toViewPath`: it always carries
 * the current view's language prefix. Reach for it when the call site knows
 * what it is linking to — a collection row knows its target is a collection
 * page, which is served per language even though it sits at `/{slug}` in the
 * same root namespace as language-neutral post permalinks.
 *
 * When the target's kind is not known at the call site, use {@link navPath}.
 *
 * @param path - Internal app path such as `/collections` or a collection slug
 * @returns Public path prefixed by the current view's language and site prefix
 * @example
 * viewPath("/collections"); // "/collections", or "/en/collections" under /en
 */
export function viewPath(path: string): string {
  if (isAssetPath(path)) {
    return toPublicAssetPath(path, assetBasePath());
  }
  return toPublicHref(path, viewBasePath());
}

/**
 * Build a link to a target whose kind the call site does not know.
 *
 * The command palette navigates to settings pages, posts, and archives through
 * one code path, so it cannot assert what any given target is. This keeps the
 * reader in their language view for the surfaces that demonstrably exist per
 * language, and leaves everything else at its single site-wide address — so a
 * jump to `/settings` never becomes `/en/settings`, which is a 404.
 *
 * Paths in the root namespace (`/{slug}`) are left alone, because a post and a
 * collection are indistinguishable there and posts have one address by design.
 * A call site that knows better should say so with {@link viewPath}.
 *
 * @param path - Internal app path, query string included if there is one
 * @returns Public path, carrying the view's language prefix where one applies
 * @example
 * navPath("/archive?media=any"); // "/en/archive?media=any" under /en
 * navPath("/settings"); // "/settings" — the dashboard is one place
 */
export function navPath(path: string): string {
  return isPerLanguageSurface(path) ? viewPath(path) : publicPath(path);
}

function normalizeFetchInput(input: FetchInput | URL): FetchInput | URL {
  if (typeof input === "string") {
    if (/^https?:\/\//.test(input)) {
      const url = new URL(input);
      if (url.origin !== window.location.origin) {
        return input;
      }
      url.pathname = publicPath(url.pathname);
      return url.toString();
    }
    return publicPath(input);
  }

  if (input instanceof URL) {
    if (input.origin !== window.location.origin) {
      return input;
    }
    const url = new URL(input.toString());
    url.pathname = publicPath(url.pathname);
    return url;
  }

  const url = new URL(input.url);
  if (url.origin !== window.location.origin) {
    return input;
  }

  url.pathname = publicPath(url.pathname);
  return new Request(url.toString(), input);
}

export function installPrefixedFetch(): void {
  const currentFetch = globalThis.fetch as typeof fetch & {
    __jantPrefixed?: boolean;
  };

  if (currentFetch.__jantPrefixed) {
    return;
  }

  const wrappedFetch: typeof fetch & { __jantPrefixed?: boolean } = (
    input,
    init,
  ) => currentFetch(normalizeFetchInput(input), init);

  wrappedFetch.__jantPrefixed = true;
  globalThis.fetch = wrappedFetch;
}
