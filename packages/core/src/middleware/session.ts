/**
 * Session Middleware
 *
 * Runs once per request (after runtime init) to look up the better-auth
 * session and stash it on `c.var.session` / `c.var.isAuthenticated`.
 *
 * This replaces ad-hoc `auth.api.getSession()` calls scattered across
 * view helpers (e.g. `lib/navigation.ts`) so each request only parses
 * the session cookie once.
 *
 * `getSession` is not purely a read: better-auth re-issues the session cookie
 * with a fresh `Max-Age` once per `updateAge`, and rebuilds the short-lived
 * `session_data` cookie cache whenever it misses. Those live in the endpoint's
 * response headers, which better-call only hands back under `returnHeaders`
 * — without it the cookies are silently dropped, the browser copy expires a
 * fixed 30 days after sign-in however active the user is, and the cookie cache
 * never survives its first 5 minutes. So we take the headers and write them
 * back onto the outgoing response.
 *
 * Never throws — any lookup error is treated as "not authenticated".
 */

import type { Context, MiddlewareHandler } from "hono";
import type { Bindings } from "../types.js";
import type { AppVariables } from "../types/app-context.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

/**
 * Extracts the cookie name from a `Set-Cookie` header value.
 *
 * @param setCookie - A single `Set-Cookie` value, e.g. `a=b; Path=/; Max-Age=1`
 * @returns The cookie name, or the whole trimmed string when there is no `=`
 *
 * @example
 * ```ts
 * readCookieName("__Secure-better-auth.session_token=abc; Path=/"); // "__Secure-better-auth.session_token"
 * ```
 */
function readCookieName(setCookie: string): string {
  const separator = setCookie.indexOf("=");
  return (separator === -1 ? setCookie : setCookie.slice(0, separator)).trim();
}

/**
 * Whether a `Cache-Control` value lets a shared cache store the response.
 *
 * A missing header counts as not shared-cacheable: `defaultCacheControl` fills
 * those in with `private, no-store` later in the chain, and this middleware
 * must stay correct no matter which of the two unwinds first.
 *
 * @param cacheControl - The response's `Cache-Control`, if any
 * @returns `true` when a CDN or proxy is allowed to keep a copy
 *
 * @example
 * ```ts
 * isSharedCacheable("private, no-store");           // false
 * isSharedCacheable("public, max-age=31536000");    // true
 * isSharedCacheable(null);                          // false
 * ```
 */
function isSharedCacheable(cacheControl: string | null): boolean {
  if (!cacheControl) return false;
  const directives = cacheControl.toLowerCase();
  return !directives.includes("no-store") && !directives.includes("private");
}

/**
 * Copies better-auth's refreshed cookies onto the response the route produced.
 *
 * Two things are deliberately skipped:
 *
 * - **Shared-cacheable responses.** `/media/*` answers with
 *   `public, max-age=31536000, immutable`; a session cookie riding along on
 *   that response is a session handed to whoever the CDN serves next.
 *   `Cache-Control: public` is this codebase's explicit marker for
 *   "auth-invariant, safe to store" (see `middleware/cache-control.ts`), so it
 *   is exactly the signal to stay out of.
 * - **Cookie names the route already set.** `/signout` clears the session
 *   cookie after this middleware read (and possibly refreshed) it. Appending
 *   ours last would land after the route's deletion and resurrect the session.
 */
function applyAuthCookies(
  c: Context<Env>,
  authHeaders: Headers | null | undefined,
): void {
  const refreshed = authHeaders?.getSetCookie() ?? [];
  if (refreshed.length === 0) return;
  if (isSharedCacheable(c.res.headers.get("Cache-Control"))) return;

  const alreadySet = new Set(c.res.headers.getSetCookie().map(readCookieName));
  for (const cookie of refreshed) {
    if (alreadySet.has(readCookieName(cookie))) continue;
    c.res.headers.append("Set-Cookie", cookie);
  }
}

export function attachSession(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const read = () =>
      c.var.auth.api.getSession({
        headers: c.req.raw.headers,
        returnHeaders: true,
      });

    let authHeaders: Headers | null = null;
    try {
      // One retry: a blipping database read would otherwise present to the
      // user as a logout, and `requireAuth` would send them back to sign-in
      // with a session that was valid the whole time.
      const { headers, response } = await read().catch(() => read());
      authHeaders = headers;
      c.set("session", response ?? null);
      c.set("isAuthenticated", !!response?.user);
    } catch {
      c.set("session", null);
      c.set("isAuthenticated", false);
    }

    await next();

    applyAuthCookies(c, authHeaders);
  };
}
