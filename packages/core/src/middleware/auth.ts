/**
 * Authentication Middleware
 *
 * Protects routes by requiring authentication via session cookies
 * or Bearer API tokens.
 */

import type { Context, MiddlewareHandler } from "hono";
import type { Bindings } from "../types.js";
import type { AppVariables } from "../types/app-context.js";
import { getDevApiToken, getInternalAdminToken } from "../lib/env.js";
import { NotFoundError, UnauthorizedError } from "../lib/errors.js";
import { getRuntimeSitePathPrefix } from "../lib/site-resolution.js";
import { isSafeInternalRedirect, toPublicHref } from "../lib/url.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

/**
 * Checks whether a hostname is local (dev environment).
 *
 * @param hostname - The hostname to check
 * @returns `true` for localhost, 127.0.0.1, ::1, and *.localtest.me
 *
 * @example
 * ```ts
 * isLocalHostname("localhost") // true
 * isLocalHostname("myblog.com") // false
 * ```
 */
export function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localtest.me")
  );
}

function getRequestHostname(
  requestUrl: string,
  requestHost?: string,
): string | null {
  if (requestHost) {
    try {
      return new URL(`http://${requestHost}`).hostname;
    } catch {
      // ignore malformed Host headers and fall back to the request URL
    }
  }

  try {
    return new URL(requestUrl).hostname;
  } catch {
    return null;
  }
}

/**
 * Validates a local-only development token against the current request.
 *
 * @param requestUrl - Full request URL
 * @param requestHost - Original Host header when available
 * @param providedToken - Token supplied by the caller
 * @param expectedToken - Token configured in the environment
 * @returns `true` when the token matches on a local hostname
 */
export function hasValidLocalDevToken(
  requestUrl: string,
  requestHost: string | undefined,
  providedToken: string | undefined,
  expectedToken: string | undefined,
): boolean {
  if (!providedToken || !expectedToken || providedToken !== expectedToken) {
    return false;
  }

  const hostname = getRequestHostname(requestUrl, requestHost);
  return hostname ? isLocalHostname(hostname) : false;
}

/**
 * Paths that should never be used as post-signin redirect targets (would
 * either loop back to signin or hit an unauthenticated endpoint).
 */
const POST_SIGNIN_REDIRECT_BLOCKLIST = new Set([
  "/signin",
  "/signout",
  "/setup",
  "/reset",
  "/__sso",
]);

function getPostSigninRedirect(requestUrl: string): string | null {
  // `c.req.url` is already the app-internal URL — `prepareRequestForRouting`
  // strips any configured site path prefix before Hono sees it, so we just
  // need to preserve pathname + query and validate it as a safe same-origin
  // redirect target.
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }

  const pathname = url.pathname || "/";
  if (POST_SIGNIN_REDIRECT_BLOCKLIST.has(pathname)) return null;
  if (pathname.startsWith("/api/")) return null;

  const candidate = `${pathname}${url.search}`;
  return isSafeInternalRedirect(candidate) ? candidate : null;
}

/**
 * Whether the request's session belongs to a member of the current site.
 *
 * This is the single definition of "signed in *here*", and every entrance must
 * ask it rather than `c.var.isAuthenticated`. That flag only answers "carries a
 * session", which is a weaker claim: better-auth's cookie cache keeps answering
 * from the browser's own copy for minutes after the rows behind it are gone, so
 * a session routinely outlives the site it was issued for — a factory reset and
 * a fresh setup being the obvious way. When a guard requires membership and an
 * entrance settles for a session, the two disagree and bounce the visitor
 * between them until the browser gives up.
 *
 * @param c - The request context, after `attachSession` has run
 * @returns `true` when the session's user is a member of `c.var.currentSite`
 *
 * @example
 * ```ts
 * // /signin only sends someone away if they are signed in to *this* site.
 * if (await isCurrentSiteMember(c)) return c.redirect("/");
 * ```
 */
export async function isCurrentSiteMember(c: Context<Env>): Promise<boolean> {
  const session = c.var.session;
  if (!session?.user) return false;

  // `siteMembers.get` resolves to `null` for "not a member", so a throw is
  // always infrastructure and is left to propagate. Rewriting a failing
  // database read into "not a member" would read to the user as being randomly
  // signed out.
  const membership = await c.var.services.siteMembers.get(
    c.var.currentSite.id,
    session.user.id,
  );
  return !!membership;
}

/**
 * Middleware that requires authentication.
 * Redirects to signin page if not authenticated.
 * Session-only — Bearer tokens are not accepted for settings pages.
 */
export function requireAuth(redirectTo = "/signin"): MiddlewareHandler<Env> {
  return async (c, next) => {
    const sitePathPrefix = getRuntimeSitePathPrefix({
      env: c.env,
      appConfig: c.var.appConfig,
      currentSiteDomain: c.var.currentSiteDomain,
    });

    const buildRedirectTarget = () => {
      const publicHref = toPublicHref(redirectTo, sitePathPrefix);
      // Only append `?redirect=...` when redirecting to the default signin flow.
      // Callers passing a custom path get it untouched.
      if (redirectTo !== "/signin") return publicHref;

      const postSignin = getPostSigninRedirect(c.req.url);
      if (!postSignin) return publicHref;

      const separator = publicHref.includes("?") ? "&" : "?";
      return `${publicHref}${separator}redirect=${encodeURIComponent(postSignin)}`;
    };

    // Session was already fetched by `attachSession` middleware. The membership
    // read inside `isCurrentSiteMember` and `next()` both stay outside a catch:
    // a failing database read or a route handler blowing up used to be
    // rewritten into a redirect to sign-in, which reads to the user as being
    // randomly signed out and loses whatever they were doing.
    if (!(await isCurrentSiteMember(c))) {
      return c.redirect(buildRedirectTarget());
    }

    await next();
  };
}

/**
 * Middleware for API routes that requires authentication.
 * Tries session auth first, then falls back to Bearer API token.
 * Returns 401 if neither method succeeds.
 */
export function requireAuthApi(): MiddlewareHandler<Env> {
  return async (c, next) => {
    // 1. Try session auth (session is pre-fetched by `attachSession` middleware).
    // Only the membership lookup falls through to Bearer on failure. `next()`
    // must stay outside that catch, or a route handler throwing turns into a
    // 401 and the client treats a server error as an expired login.
    if (await isCurrentSiteMember(c).catch(() => false)) {
      await next();
      return;
    }

    // 2. Try Bearer token auth
    if (await hasValidBearerApiToken(c)) {
      await next();
      return;
    }

    throw new UnauthorizedError();
  };
}

/**
 * Middleware for internal maintenance APIs.
 * Only accepts the environment-provided internal admin token.
 */
export function requireInternalAdminApi(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const expectedToken = getInternalAdminToken(c.env);
    if (!expectedToken) {
      throw new NotFoundError("Internal admin endpoint");
    }

    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedError();
    }

    const providedToken = authHeader.slice(7);
    if (!timingSafeTokenEquals(providedToken, expectedToken)) {
      throw new UnauthorizedError();
    }

    await next();
  };
}

function timingSafeTokenEquals(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < maxLength; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return mismatch === 0;
}

async function hasValidBearerApiToken(c: {
  env: Bindings;
  executionCtx?: { waitUntil: (promise: Promise<unknown>) => void };
  req: {
    header: (name: string) => string | undefined;
    url: string;
  };
  var: {
    services: AppVariables["services"];
  };
}): Promise<boolean> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return false;
  }

  const rawToken = authHeader.slice(7);

  if (
    hasValidLocalDevToken(
      c.req.url,
      c.req.header("host"),
      rawToken,
      getDevApiToken(c.env),
    )
  ) {
    return true;
  }

  const tokenId = await c.var.services.apiTokens.verify(rawToken);
  if (!tokenId) {
    return false;
  }

  const updatePromise = c.var.services.apiTokens.updateLastUsed(tokenId);
  try {
    c.executionCtx?.waitUntil(updatePromise);
  } catch {
    // executionCtx not available (e.g. in tests) — ignore
  }

  return true;
}
