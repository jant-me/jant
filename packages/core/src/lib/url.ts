/**
 * URL Utilities
 */

function normalizeSitePathname(pathname: string): string {
  if (pathname === "/" || pathname === "") return "";
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/**
 * Normalize a configured public site path prefix.
 *
 * @param sitePathPrefix - Prefix such as `/blog` or `blog`
 * @returns Normalized prefix like `/blog`, or an empty string when rooted
 */
export function normalizeSitePathPrefix(sitePathPrefix: string): string {
  return normalizeSitePathname(sitePathPrefix);
}

/**
 * Extracts the hostname (domain) from a URL string.
 *
 * Parses a full URL and returns just the hostname portion (e.g., "example.com" from
 * "https://example.com/path"). Returns `null` if the URL is malformed or cannot be parsed.
 *
 * @param url - The full URL string to extract the domain from
 * @returns The hostname/domain if valid, or `null` if parsing fails
 *
 * @example
 * ```ts
 * const domain = extractDomain("https://www.example.com/path");
 * // Returns: "www.example.com"
 *
 * const invalid = extractDomain("not-a-url");
 * // Returns: null
 * ```
 */
export function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return null;
  }
}

/**
 * Normalizes a path by removing slashes and converting to lowercase.
 *
 * Trims whitespace, converts to lowercase, removes leading and trailing slashes,
 * and collapses multiple consecutive slashes into single slashes. Used to create
 * consistent path representations for routing and storage.
 *
 * @param path - The path string to normalize
 * @returns The normalized path string
 *
 * @example
 * ```ts
 * const normalized = normalizePath("  /About/Contact//  ");
 * // Returns: "about/contact"
 * ```
 */
export function normalizePath(path: string): string {
  return path
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/+/g, "/");
}

/**
 * Checks if a string is a full URL with HTTP or HTTPS protocol.
 *
 * Validates whether a string starts with "http://" or "https://", indicating it's
 * a full URL rather than a relative path. Useful for distinguishing between internal
 * paths and external URLs.
 *
 * @param str - The string to check
 * @returns `true` if the string starts with http:// or https://, `false` otherwise
 *
 * @example
 * ```ts
 * isFullUrl("https://example.com");  // Returns: true
 * isFullUrl("/about");               // Returns: false
 * isFullUrl("example.com");          // Returns: false
 * ```
 */
export function isFullUrl(str: string): boolean {
  return str.startsWith("http://") || str.startsWith("https://");
}

/**
 * If a full URL points at the site's own host, return its same-site path
 * (`pathname` + `search` + `hash`). Returns `null` when the input is not a full
 * URL, is unparseable, or points at a different host.
 *
 * Self-referential absolute links — e.g. a nav item set to
 * `https://example.com/about` on `example.com` — should behave like the
 * internal path `/about`: no external-link icon, no `target="_blank"`.
 *
 * Matching is by **hostname**, not full origin: scheme and port differences are
 * treated as same-site. This keeps the check intuitive ("same domain") and
 * robust in dev, where the site is often served over `http://host:<port>` while
 * a nav link stores the canonical `https://host` URL. In production (canonical
 * https + default port) hostname match is equivalent to origin match.
 *
 * @param url - Candidate URL (full URL or relative path)
 * @param siteOrigin - The site's own origin, e.g. `https://example.com`
 * @returns The same-site path, or `null` when the URL is external/non-absolute
 *
 * @example
 * ```ts
 * toSameSitePath("https://example.com/about", "https://example.com");    // "/about"
 * toSameSitePath("https://example.com/about", "http://example.com:8787"); // "/about"
 * toSameSitePath("https://other.com/about", "https://example.com");      // null
 * toSameSitePath("/about", "https://example.com");                       // null
 * ```
 */
export function toSameSitePath(url: string, siteOrigin: string): string | null {
  if (!siteOrigin || !isFullUrl(url)) return null;
  let parsed: URL;
  let reference: URL;
  try {
    parsed = new URL(url);
    reference = new URL(siteOrigin);
  } catch {
    return null;
  }
  if (parsed.hostname !== reference.hostname) return null;
  return `${parsed.pathname}${parsed.search}${parsed.hash}` || "/";
}

/**
 * Any `scheme:` at the start. `mailto:` and `tel:` address something real but
 * never a page here, and an unrecognized scheme must not be read as a path.
 */
const ANY_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

export interface InternalPathOptions {
  /**
   * Origins this site answers on. Pass the configured one *and* the origin of
   * the current request: a hosted site is often reached on a custom domain the
   * canonical URL knows nothing about.
   */
  siteOrigins?: readonly string[];
  /** Public site path prefix, such as `/blog`. */
  sitePathPrefix?: string;
  /**
   * Language URL prefixes the site serves, without slashes (`["en", "ja"]`).
   * A leading one is removed, because `/en/about` and `/about` are the same
   * page seen from two views.
   */
  languagePrefixes?: readonly string[];
  /** Keep `?query` and `#hash`. Off by default: they name a spot, not a page. */
  keepQuery?: boolean;
}

/**
 * Whether a string is meant as an address rather than as search words.
 *
 * Deliberately narrow — a leading slash or a full `http(s)` URL. Anything
 * looser would swallow real queries: a search for "about" is not a search for
 * `/about`.
 *
 * @param input - What the author typed or pasted
 * @returns True when the input should be resolved instead of searched
 * @example
 * looksLikeAddress("/about"); // true
 * looksLikeAddress("https://example.com/about"); // true
 * looksLikeAddress("about"); // false
 */
export function looksLikeAddress(input: string): boolean {
  const trimmed = input.trim();
  return trimmed.startsWith("/") || isFullUrl(trimmed);
}

/**
 * Convert an address the author pasted into an internal app path.
 *
 * Accepts what a browser address bar would produce — a full URL on one of the
 * site's own origins, or a path — and returns the path the router resolves
 * against: no site path prefix, no language prefix, rooted at `/`. Returns
 * `null` for anything that is not a page on this site, so callers can tell an
 * external link apart from a bad one.
 *
 * Case is left alone; storage-level normalization belongs to the path
 * registry, which lowercases on its own terms.
 *
 * A full URL has to sit inside the deployment to count. A typed path does not:
 * `/about` on a site served from `/blog` is the About page, because that is
 * what someone typing it means.
 *
 * @param input - A full URL, or a path
 * @param options - The site's origins, prefixes, and what to keep
 * @returns Internal path rooted at `/`, or `null` when the address is not ours
 * @example
 * toInternalPath("https://example.com/blog/en/about", {
 *   siteOrigins: ["https://example.com"],
 *   sitePathPrefix: "/blog",
 *   languagePrefixes: ["en"],
 * }); // "/about"
 * toInternalPath("https://other.com/about", { siteOrigins: ["https://example.com"] }); // null
 */
export function toInternalPath(
  input: string,
  options: InternalPathOptions = {},
): string | null {
  const value = input.trim();
  if (!value) return null;

  const {
    siteOrigins = [],
    sitePathPrefix = "",
    languagePrefixes = [],
    keepQuery = false,
  } = options;

  const isFull = isFullUrl(value);
  let candidate: string | null = null;
  if (isFull) {
    for (const origin of siteOrigins) {
      const path = toSameSitePath(value, origin);
      if (path !== null) {
        candidate = path;
        break;
      }
    }
    // A full URL on a host we do not serve is somebody else's page.
    if (candidate === null) return null;
  } else if (
    value.startsWith("//") ||
    ANY_SCHEME_RE.test(value) ||
    value.startsWith("#")
  ) {
    return null;
  } else {
    candidate = value;
  }

  let url: URL;
  try {
    // A fixed base resolves `..`, percent-encoding, and stray backslashes the
    // same way the browser that produced the address did.
    url = new URL(candidate, "https://jant.invalid");
  } catch {
    return null;
  }

  const withoutSite = stripSitePathPrefix(
    url.pathname,
    normalizeSitePathPrefix(sitePathPrefix),
  );
  if (withoutSite === null && isFull) {
    // A URL on our host but outside the deployment: another app, not a page.
    return null;
  }

  // A typed path that does not carry the prefix is already an internal one —
  // an author writing `/about` on a site served from `/blog` means the About
  // page, not a different site.
  const internal = stripLanguagePrefix(
    withoutSite ?? url.pathname,
    languagePrefixes,
  );
  const trimmed =
    internal.length > 1 ? internal.replace(/\/+$/, "") || "/" : internal;

  return keepQuery ? `${trimmed}${url.search}${url.hash}` : trimmed;
}

/** Drop a leading `/en`-style segment when the site serves that language. */
function stripLanguagePrefix(
  pathname: string,
  languagePrefixes: readonly string[],
): string {
  if (languagePrefixes.length === 0) return pathname;

  const rest = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  const slash = rest.indexOf("/");
  const first = (slash === -1 ? rest : rest.slice(0, slash)).toLowerCase();
  if (!first) return pathname;
  if (!languagePrefixes.some((prefix) => prefix.toLowerCase() === first)) {
    return pathname;
  }

  return slash === -1 ? "/" : rest.slice(slash);
}

/**
 * Extracts a human-friendly domain name from a URL for display purposes.
 *
 * Parses the URL, strips common prefixes (`www.`, `m.`, `mobile.`), and returns
 * a clean domain. Returns `null` if the URL is malformed.
 *
 * @param url - The full URL string
 * @returns A display-friendly domain string, or `null` if parsing fails
 *
 * @example
 * ```ts
 * extractDisplayDomain("https://www.example.com/path");
 * // Returns: "example.com"
 *
 * extractDisplayDomain("https://m.wikipedia.org/wiki/Test");
 * // Returns: "wikipedia.org"
 *
 * extractDisplayDomain("https://blog.example.com");
 * // Returns: "blog.example.com"
 * ```
 */
export function extractDisplayDomain(url: string): string | null {
  const hostname = extractDomain(url);
  if (!hostname) return null;
  return hostname.replace(/^(?:www|m|mobile)\./, "");
}

const SAFE_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const SAFE_RICH_TEXT_HREF_PROTOCOLS = new Set([
  ...SAFE_URL_PROTOCOLS,
  "tel:",
  "sms:",
]);

function sanitizeUrlWithProtocols(
  url: string,
  protocols: ReadonlySet<string>,
): string {
  try {
    const parsed = new URL(url, "https://placeholder.invalid");
    // Relative URLs resolve against the placeholder and get https: — allow them
    if (protocols.has(parsed.protocol)) return url;
    return "";
  } catch {
    return "";
  }
}

/**
 * Checks whether a string is a safe absolute URL.
 *
 * Accepts absolute URLs that use `http:`, `https:`, or `mailto:`. Relative
 * paths are rejected because external post/source URLs must be fully qualified.
 *
 * @param url - The URL string to validate
 * @returns `true` when the URL is absolute and uses an allowed protocol
 *
 * @example
 * ```ts
 * isSafeAbsoluteUrl("https://example.com"); // true
 * isSafeAbsoluteUrl("mailto:hello@example.com"); // true
 * isSafeAbsoluteUrl("example.com"); // false
 * ```
 */
export function isSafeAbsoluteUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;

  try {
    const parsed = new URL(trimmed);
    return SAFE_URL_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Sanitizes a URL by ensuring it uses a safe protocol.
 *
 * Returns the URL unchanged if it uses an allowed protocol (http:, https:, mailto:)
 * or is a relative path. Returns an empty string for dangerous protocols like
 * `javascript:`, `data:`, or `vbscript:`.
 *
 * @param url - The URL string to sanitize
 * @returns The original URL if safe, or an empty string if the protocol is disallowed
 *
 * @example
 * ```ts
 * sanitizeUrl("https://example.com");       // "https://example.com"
 * sanitizeUrl("/about");                     // "/about"
 * sanitizeUrl("javascript:alert(1)");        // ""
 * sanitizeUrl("data:text/html,<h1>Hi</h1>"); // ""
 * ```
 */
export function sanitizeUrl(url: string): string {
  return sanitizeUrlWithProtocols(url, SAFE_URL_PROTOCOLS);
}

/**
 * Sanitizes a rich-text link destination.
 *
 * In addition to safe web and email URLs, rich-text links may launch the
 * device's phone or messaging app through `tel:` and `sms:`. Relative links
 * remain valid, while executable and resource-only protocols are rejected.
 *
 * @param url - The link destination to sanitize
 * @returns The original URL if safe for an anchor, or an empty string otherwise
 *
 * @example
 * ```ts
 * sanitizeRichTextHref("sms:+15551234567"); // "sms:+15551234567"
 * sanitizeRichTextHref("javascript:alert(1)"); // ""
 * ```
 */
export function sanitizeRichTextHref(url: string): string {
  return sanitizeUrlWithProtocols(url, SAFE_RICH_TEXT_HREF_PROTOCOLS);
}

/**
 * Normalize a public site URL by stripping any trailing slash from the path.
 *
 * @param siteUrl - Full site URL, optionally with a path prefix
 * @returns Normalized site URL, or an empty string when not configured
 */
export function normalizeSiteUrl(siteUrl: string): string {
  const trimmed = siteUrl.trim();
  if (!trimmed) return "";

  const parsed = new URL(trimmed);
  parsed.pathname = normalizeSitePathname(parsed.pathname) || "/";
  if (parsed.pathname !== "/") {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }
  return parsed.toString().replace(/\/$/, parsed.pathname === "/" ? "/" : "");
}

/**
 * Extract the public path prefix from a full site URL.
 *
 * @param siteUrl - Full site URL
 * @returns Prefix like `/blog`, or an empty string when the site is rooted
 */
export function getSitePathPrefix(siteUrl: string): string {
  if (!siteUrl.trim()) return "";
  const parsed = new URL(siteUrl);
  return normalizeSitePathname(parsed.pathname);
}

/**
 * Extract the origin from a full site URL.
 *
 * @param siteUrl - Full site URL
 * @returns Origin like `https://example.com`, or an empty string when missing
 */
export function getSiteOrigin(siteUrl: string): string {
  if (!siteUrl.trim()) return "";
  return new URL(siteUrl).origin;
}

/**
 * Build a normalized public site URL from an origin and optional path prefix.
 *
 * @param siteOrigin - Public site origin, such as `https://example.com`
 * @param sitePathPrefix - Public site path prefix, such as `/blog`
 * @returns Normalized site URL, or an empty string when no origin is configured
 */
export function buildSiteUrl(siteOrigin: string, sitePathPrefix = ""): string {
  const trimmedOrigin = siteOrigin.trim();
  if (!trimmedOrigin) return "";

  const origin = new URL(trimmedOrigin).origin;
  const normalizedPrefix = normalizeSitePathPrefix(sitePathPrefix);
  return normalizeSiteUrl(`${origin}${normalizedPrefix || "/"}`);
}

/**
 * Prefix an internal app path with the public site path prefix.
 *
 * Internal paths are always rooted at `/` and never include the deployment
 * prefix. This helper converts them to public-facing paths.
 *
 * @param path - Internal app path, such as `/settings`
 * @param sitePathPrefix - Public site path prefix, such as `/blog`
 * @returns Public path
 */
export function toPublicPath(path: string, sitePathPrefix = ""): string {
  if (!path) return sitePathPrefix || "/";
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (!sitePathPrefix) return normalizedPath;
  if (
    normalizedPath === sitePathPrefix ||
    normalizedPath.startsWith(`${sitePathPrefix}/`)
  ) {
    return normalizedPath;
  }
  if (normalizedPath === "/") return sitePathPrefix;
  return `${sitePathPrefix}${normalizedPath}`;
}

/**
 * Convert an app-local href to its public path while leaving external URLs
 * unchanged.
 *
 * @param href - Internal app path or external URL
 * @param sitePathPrefix - Public site path prefix
 * @returns Public-facing href
 */
export function toPublicHref(href: string, sitePathPrefix = ""): string {
  if (
    href.startsWith("http://") ||
    href.startsWith("https://") ||
    href.startsWith("//") ||
    href.startsWith("mailto:") ||
    href.startsWith("tel:") ||
    href.startsWith("#")
  ) {
    return href;
  }
  return toPublicPath(href, sitePathPrefix);
}

/**
 * Check whether a path is a safe same-origin redirect target.
 *
 * Accepts only paths that start with a single `/` (no protocol-relative
 * `//host`, no scheme, no control characters). Callers should use this to
 * validate user-supplied `redirect` query parameters before issuing a
 * `Location` header.
 *
 * @param path - Candidate redirect path
 * @returns `true` when the path is safe to use as an internal redirect
 *
 * @example
 * ```ts
 * isSafeInternalRedirect("/settings") // true
 * isSafeInternalRedirect("//evil.example") // false
 * isSafeInternalRedirect("https://evil.example") // false
 * ```
 */
export function isSafeInternalRedirect(
  path: string | null | undefined,
): path is string {
  if (typeof path !== "string") return false;
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  // Disallow backslash-prefixed paths (some browsers treat `/\host` as
  // protocol-relative) and control characters that could smuggle headers.
  if (path.startsWith("/\\")) return false;
  for (let i = 0; i < path.length; i += 1) {
    const code = path.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

/**
 * Remove the site path prefix from a public request pathname.
 *
 * @param pathname - Public request pathname
 * @param sitePathPrefix - Configured public site path prefix
 * @returns Internal pathname, or `null` when the request is outside the site
 */
export function stripSitePathPrefix(
  pathname: string,
  sitePathPrefix: string,
): string | null {
  if (!sitePathPrefix) return pathname || "/";
  if (pathname === sitePathPrefix) return "/";
  if (pathname.startsWith(`${sitePathPrefix}/`)) {
    return pathname.slice(sitePathPrefix.length) || "/";
  }
  return null;
}

/**
 * Convert an internal or public path into an absolute site URL.
 *
 * @param path - Internal app path or already-public path
 * @param siteUrl - Normalized site URL
 * @param sitePathPrefix - Public site path prefix
 * @returns Absolute URL when siteUrl is configured, otherwise the original path
 */
export function toAbsoluteSiteUrl(
  path: string,
  siteUrl: string,
  sitePathPrefix = "",
): string {
  if (!siteUrl) return toPublicPath(path, sitePathPrefix);
  return new URL(toPublicPath(path, sitePathPrefix), siteUrl).toString();
}

/**
 * Resolve a possibly-relative asset URL to an absolute URL, leaving
 * already-absolute (`http(s):`) and protocol-relative (`//host`) URLs
 * untouched. Use for assets — like media — whose stored URL may be either an
 * app-local path or a full CDN URL.
 *
 * @param url - Asset URL: an internal path or an already-absolute URL
 * @param siteUrl - Normalized site URL
 * @param sitePathPrefix - Public site path prefix
 * @returns Absolute URL, or the original value when it is already absolute
 *
 * @example
 * ```ts
 * toAbsoluteAssetUrl("/m/a.png", "https://site.com");   // "https://site.com/m/a.png"
 * toAbsoluteAssetUrl("https://cdn.example/a.png", "x"); // "https://cdn.example/a.png"
 * ```
 */
export function toAbsoluteAssetUrl(
  url: string,
  siteUrl: string,
  sitePathPrefix = "",
): string {
  if (isFullUrl(url) || url.startsWith("//")) return url;
  return toAbsoluteSiteUrl(url, siteUrl, sitePathPrefix);
}
