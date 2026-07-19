import type { Bindings } from "../types.js";
import { getConfiguredSingleSitePathPrefix } from "./env.js";
import { POST_BODY_HTML_VERSION } from "./post-body-html.js";
import { stripSitePathPrefix } from "./url.js";

const TRACKING_QUERY_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "dclid",
  "msclkid",
  "twclid",
  "_ga",
  "_gl",
] as const;

const AUTH_COOKIE_PATTERN =
  /(?:^|;\s*)(?:__Host-)?(?:__Secure-)?better-auth[.-][^=]+=/;
const BODY_HTML_CACHE_VERSION_PARAM = "__jant_body_html";

type ExecutionContextLike = {
  waitUntil(promise: Promise<unknown>): void;
};

type CacheKey = Request | string | URL;

interface CacheLike {
  match(request: CacheKey): Promise<Response | undefined>;
  put(request: CacheKey, response: Response): Promise<void>;
}

export interface WorkerResponseCacheOptions {
  bindings?: Bindings;
  cache?: CacheLike | null;
  executionCtx?: ExecutionContextLike;
  next: () => Promise<Response>;
  request: Request;
}

/**
 * Check whether a public request path belongs to the phase-one Worker cache.
 *
 * Phase one only caches public feeds, site metadata, and icon assets.
 *
 * @param path - Internal app path with any configured site prefix removed
 * @returns `true` when the request should be eligible for Worker response caching
 */
export function isWorkerResponseCachePath(path: string): boolean {
  if (path === "/feed" || path.startsWith("/feed/")) {
    return true;
  }

  if (path === "/archive/feed" || path.startsWith("/archive/feed/")) {
    return true;
  }

  if (path === "/sitemap.xml" || path === "/robots.txt") {
    return true;
  }

  if (path === "/favicon.ico" || path === "/apple-touch-icon.png") {
    return true;
  }

  if (
    path.endsWith("/feed") &&
    !path.startsWith("/api/") &&
    !path.startsWith("/settings") &&
    !path.startsWith("/compose") &&
    !path.startsWith("/_")
  ) {
    return true;
  }

  return false;
}

/**
 * Normalize a public request URL for Worker cache lookup.
 *
 * Tracking parameters are removed so equivalent feed requests converge on one
 * cache entry while functional filters like `format` remain intact. A private
 * body-HTML contract version invalidates cached feed markup across renderer
 * deployments; it is only used for Cache API lookup and never forwarded.
 *
 * @param requestUrl - Full public request URL
 * @returns Normalized cache key URL
 */
export function normalizeWorkerCacheKeyUrl(requestUrl: string): string {
  const url = new URL(requestUrl);

  for (const param of TRACKING_QUERY_PARAMS) {
    url.searchParams.delete(param);
  }

  url.searchParams.set(
    BODY_HTML_CACHE_VERSION_PARAM,
    String(POST_BODY_HTML_VERSION),
  );
  url.searchParams.sort();
  return url.toString();
}

/**
 * Check whether a request can use the phase-one Worker response cache.
 *
 * @param request - Original public request
 * @param bindings - Runtime bindings for environment detection and path prefix stripping
 * @returns `true` when the request is an anonymous Cloudflare Worker GET for an eligible route
 */
export function shouldUseWorkerResponseCache(
  request: Request,
  bindings?: Bindings,
): boolean {
  if (request.method !== "GET") {
    return false;
  }

  if (!bindings?.DB || bindings.NODE_DATABASE || bindings.NODE_SQLITE) {
    return false;
  }

  if (request.headers.has("Authorization")) {
    return false;
  }

  const cookieHeader = request.headers.get("Cookie");
  if (cookieHeader && AUTH_COOKIE_PATTERN.test(cookieHeader)) {
    return false;
  }

  const url = new URL(request.url);
  const path = stripSitePathPrefix(
    url.pathname,
    getConfiguredSingleSitePathPrefix(bindings),
  );

  if (!path) {
    return false;
  }

  return isWorkerResponseCachePath(path);
}

function getDefaultWorkerCache(): CacheLike | null {
  const cacheStorage = globalThis as typeof globalThis & {
    caches?: {
      default?: CacheLike;
    };
  };

  if (typeof cacheStorage.caches === "undefined") {
    return null;
  }

  return cacheStorage.caches.default ?? null;
}

function canStoreWorkerCacheResponse(response: Response): boolean {
  if (!response.ok || response.headers.has("Set-Cookie")) {
    return false;
  }

  const cacheControl = response.headers.get("Cache-Control") ?? "";
  if (
    !cacheControl ||
    cacheControl.includes("no-store") ||
    !cacheControl.includes("max-age=")
  ) {
    return false;
  }

  return true;
}

/**
 * Serve a public feed, metadata, or icon response from the Cloudflare Cache API when possible.
 *
 * Requests that do not meet the phase-one rules fall through unchanged.
 *
 * @param options - Cache lookup context and downstream handler
 * @returns Cached or freshly rendered response
 */
export async function withWorkerResponseCache(
  options: WorkerResponseCacheOptions,
): Promise<Response> {
  const { bindings, executionCtx, next, request } = options;

  if (!shouldUseWorkerResponseCache(request, bindings)) {
    return next();
  }

  const cache = options.cache ?? getDefaultWorkerCache();
  if (!cache) {
    return next();
  }

  const cacheKey = new Request(normalizeWorkerCacheKeyUrl(request.url));

  try {
    const cached = await cache.match(cacheKey);
    if (cached) {
      return new Response(cached.body, cached);
    }
  } catch {
    return next();
  }

  const response = await next();
  if (!canStoreWorkerCacheResponse(response)) {
    return response;
  }

  const storePromise = cache.put(cacheKey, response.clone()).catch(() => {});
  if (executionCtx) {
    executionCtx.waitUntil(storePromise);
  } else {
    await storePromise;
  }

  return response;
}
