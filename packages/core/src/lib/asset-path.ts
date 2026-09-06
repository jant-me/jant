/**
 * Static asset path helpers.
 *
 * Build outputs live under an internal `/_assets` directory, while the public
 * asset base path may be prefixed by the site's deployment path, or replaced
 * by an absolute CDN URL. The connection hints a page needs are derived from
 * those same base URLs, so they live here too.
 */

import { toPublicPath } from "./url.js";

export const ASSET_BASE_SEGMENT = "_assets";
export const ASSET_BASE_PATH = `/${ASSET_BASE_SEGMENT}`;
export const ASSET_CHUNK_SEGMENT = "chunks";

function normalizeAssetBasePath(basePath: string): string {
  const trimmed = basePath.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return ASSET_BASE_PATH;
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/**
 * Resolve the public asset base path for the current deployment prefix.
 *
 * @param sitePathPrefix - Public site path prefix, such as `/blog`
 * @returns Public asset base path, such as `/blog/_assets`
 */
export function getPublicAssetBasePath(sitePathPrefix = ""): string {
  return toPublicPath(ASSET_BASE_PATH, sitePathPrefix);
}

/**
 * Prefix a static asset subpath with an asset base path.
 *
 * @param path - Asset path relative to the asset base, with or without `/`
 * @param basePath - Asset base path, defaults to the internal `/_assets`
 * @returns Absolute asset URL path
 *
 * @example
 * ```ts
 * toAssetPath("client.js"); // "/_assets/client.js"
 * toAssetPath("client.js", "/blog/_assets"); // "/blog/_assets/client.js"
 * ```
 */
export function toAssetPath(path: string, basePath = ASSET_BASE_PATH): string {
  const normalizedBasePath = normalizeAssetBasePath(basePath);
  const normalized = path.replace(/^\/+/, "");
  return normalized
    ? `${normalizedBasePath}/${normalized}`
    : normalizedBasePath;
}

/**
 * Returns true when a path points at a static asset namespace.
 *
 * @param path - Request pathname
 * @param basePath - Asset base path, defaults to the internal `/_assets`
 * @returns Whether the pathname is inside the asset namespace
 */
export function isAssetPath(path: string, basePath = ASSET_BASE_PATH): boolean {
  const normalizedBasePath = normalizeAssetBasePath(basePath);
  return (
    path === normalizedBasePath || path.startsWith(`${normalizedBasePath}/`)
  );
}

/** One `<link rel="preconnect">` the layout should emit. */
export interface PreconnectHint {
  /** Origin to open a connection to. */
  href: string;
  /**
   * Whether this is the CORS-mode connection. A browser pools credentialed
   * and uncredentialed connections separately, so an origin serving both a
   * stylesheet (no CORS) and a module script (CORS) needs one of each.
   */
  crossorigin: boolean;
}

/**
 * The origin of `base`, or `null` when it is not a cross-origin absolute URL.
 */
function crossOrigin(base: string | undefined, siteOrigin: string | null) {
  const trimmed = base?.trim();
  if (
    !trimmed ||
    (!trimmed.startsWith("http://") && !trimmed.startsWith("https://"))
  ) {
    return null;
  }
  try {
    const { origin } = new URL(trimmed);
    return origin === siteOrigin ? null : origin;
  } catch {
    return null;
  }
}

/**
 * Origins worth a `<link rel="preconnect">` for the subresources of a page.
 *
 * Only a host the page does not already have a connection to earns a hint:
 * the site's own origin is connected by the time the HTML arrives, and a
 * same-origin base path resolves to it. What is left is a CDN asset host and
 * a media host, and warming DNS, TCP and TLS while the rest of `<head>` parses
 * takes that round trip off the critical path.
 *
 * The asset host serves the render-blocking stylesheet and the module script,
 * so it gets both connection kinds; the media host serves images, so it gets
 * the uncredentialed one. When the two are the same host, the asset hints
 * already cover the images.
 *
 * @param options - Resolved base URLs for the page's subresources
 * @param options.assetBasePath - Public asset base path or absolute CDN URL
 * @param options.mediaBaseUrl - Public media base URL, empty when same-origin
 * @param options.siteUrl - The site's own URL, so its origin is never hinted
 * @returns Hints in the order they should be emitted, possibly empty
 *
 * @example
 * ```ts
 * getPreconnectHints({
 *   assetBasePath: "https://cdn.example.com/a",
 *   mediaBaseUrl: "https://media.example.com",
 *   siteUrl: "https://example.com",
 * });
 * // [
 * //   { href: "https://cdn.example.com", crossorigin: false },
 * //   { href: "https://cdn.example.com", crossorigin: true },
 * //   { href: "https://media.example.com", crossorigin: false },
 * // ]
 * ```
 */
export function getPreconnectHints(options: {
  assetBasePath: string;
  mediaBaseUrl?: string;
  siteUrl?: string;
}): PreconnectHint[] {
  let siteOrigin: string | null = null;
  if (options.siteUrl) {
    try {
      siteOrigin = new URL(options.siteUrl).origin;
    } catch {
      // An unparseable siteUrl tells us nothing; hint the other hosts anyway.
    }
  }

  const assetOrigin = crossOrigin(options.assetBasePath, siteOrigin);
  const mediaOrigin = crossOrigin(options.mediaBaseUrl, siteOrigin);

  const hints: PreconnectHint[] = [];
  if (assetOrigin) {
    hints.push(
      { href: assetOrigin, crossorigin: false },
      { href: assetOrigin, crossorigin: true },
    );
  }
  if (mediaOrigin && mediaOrigin !== assetOrigin) {
    hints.push({ href: mediaOrigin, crossorigin: false });
  }
  return hints;
}

/**
 * Convert an internal asset path into its public deployment path.
 *
 * When `publicAssetBasePath` is an absolute URL (starts with `http://` or
 * `https://`), the internal `/_assets` prefix is replaced with that URL,
 * producing a fully-qualified CDN URL.
 *
 * @param path - Internal or already-public asset path
 * @param publicAssetBasePath - Public asset base path or absolute CDN URL
 * @returns Public-facing asset path or absolute CDN URL
 */
export function toPublicAssetPath(
  path: string,
  publicAssetBasePath: string,
): string {
  const isAbsolute =
    publicAssetBasePath.startsWith("http://") ||
    publicAssetBasePath.startsWith("https://");

  if (isAbsolute) {
    if (!isAssetPath(path)) return path;
    const rel = path.slice(ASSET_BASE_PATH.length).replace(/^\/+/, "");
    const base = publicAssetBasePath.replace(/\/+$/, "");
    return rel ? `${base}/${rel}` : base;
  }

  if (isAssetPath(path, publicAssetBasePath)) {
    return path;
  }
  if (!isAssetPath(path)) {
    return path;
  }

  const relativePath = path.slice(ASSET_BASE_PATH.length).replace(/^\/+/, "");
  return toAssetPath(relativePath, publicAssetBasePath);
}
