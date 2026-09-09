/**
 * Cache-Control Middleware
 *
 * Sets a safe default `Cache-Control` on responses that don't declare one.
 *
 * Almost every Jant page is auth-variant: the same URL renders differently
 * for the signed-in author (nav, the "more" menu, edit affordances) than for
 * an anonymous visitor. A shared/CDN cache keyed only by URL must therefore
 * never store these pages — otherwise it serves a stale or wrong-audience
 * snapshot, which both breaks the UI ("you still look signed out", "your edit
 * didn't take effect") and can leak the authenticated dashboard to the public.
 *
 * Jant is self-hosted software that runs behind whatever reverse proxy or CDN
 * the operator chooses, so it cannot rely on infrastructure config to get
 * this right — it must declare its own cache policy. The critical mistake is
 * emitting `Cache-Control: public`: that word is an explicit invitation for
 * any shared cache to store the response.
 *
 * Routes that serve genuinely public, auth-invariant resources (media, feeds,
 * sitemaps, favicons, manifests, static assets) set their own `Cache-Control`
 * explicitly; this middleware leaves those untouched and only fills in the
 * default for the un-annotated dynamic responses.
 *
 * The default differs by audience, because `no-store` costs more than it
 * looks: it also disables the browser's back/forward cache, so going back
 * re-requests the page, re-renders it and re-runs its scripts instead of
 * restoring it instantly. For an anonymous visitor there is nothing to
 * protect — the page is the public one anybody gets — so they get `no-cache`,
 * which keeps shared caches out exactly as before (that is `private`'s job)
 * while letting the browser hold its own copy and revalidate.
 *
 * A signed-in author keeps `no-store`. The back/forward cache restores a whole
 * page snapshot without asking the server, so a page rendered while signed in
 * would still be there after signing out — on a shared machine that shows the
 * previous session's view. Trading the author's back-button latency for that
 * is not worth it; readers are the traffic that matters here anyway.
 *
 * Credential surfaces are the exception to "anonymous has nothing to protect".
 * A sign-in form, a setup form, a reset page whose URL carries a one-time
 * token, an SSO handoff: all of them are served to someone with no session
 * yet, so the anonymous default would let the browser write them to disk.
 * `noStore()` marks those paths, and `app.tsx` mounts it on every one of them.
 */

import type { MiddlewareHandler } from "hono";
import type { Bindings } from "../types.js";
import type { AppVariables } from "../types/app-context.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

/**
 * Nothing keeps a copy. `private` forbids shared/CDN caches from storing the
 * response; `no-store` prevents any cache — the browser's own, and its
 * back/forward cache — from keeping one either.
 *
 * The default for a signed-in author, and the rule for every credential
 * surface whatever the audience.
 */
const NO_STORE_CACHE_CONTROL = "private, no-store";

/**
 * Default for anonymous responses. `private` still keeps shared/CDN caches
 * out; `no-cache` lets the browser keep a copy it must revalidate before
 * reuse, which is what makes the page eligible for the back/forward cache.
 */
const ANONYMOUS_CACHE_CONTROL = "private, no-cache";

/**
 * Middleware that defaults a missing `Cache-Control` header: `private,
 * no-cache` for anonymous responses, `private, no-store` once signed in.
 *
 * Runs after the route handler: if the handler (or an inner middleware)
 * already set `Cache-Control`, that explicit value wins. Only responses that
 * declare nothing receive the default. Requires `attachSession()` to have run
 * first; without it every response is treated as anonymous, so mount it after.
 *
 * @returns Hono middleware enforcing the default cache policy.
 *
 * @example
 * ```ts
 * app.use("*", attachSession());
 * app.use("*", defaultCacheControl());
 * ```
 */
export function defaultCacheControl(): MiddlewareHandler<Env> {
  return async (c, next) => {
    await next();
    if (c.res.headers.has("Cache-Control")) return;
    c.res.headers.set(
      "Cache-Control",
      c.var.isAuthenticated ? NO_STORE_CACHE_CONTROL : ANONYMOUS_CACHE_CONTROL,
    );
  };
}

/**
 * Middleware for a path that must never be written to any cache.
 *
 * For the credential surfaces: sign-in, sign-out, setup, password reset, the
 * SSO handoff, the dev login, and better-auth's own endpoints. Every one of
 * them is reached without a session, so `defaultCacheControl` would hand them
 * the anonymous `no-cache` — which lets the browser keep the page, and the URL
 * it came from, on disk. A reset link's one-time token then outlives the visit
 * on a shared machine.
 *
 * Unconditional, unlike the default: this is a rule about the path, not a
 * fallback for a path that said nothing. Mount it after
 * `defaultCacheControl()` so the header is already set by the time that one
 * looks, and before the handler it protects — a terminal handler registered
 * first ends the chain and this never runs.
 *
 * @returns Hono middleware forcing `private, no-store`.
 *
 * @example
 * ```ts
 * app.use("/reset", noStore());
 * app.route("/", resetRoutes);
 * ```
 */
export function noStore(): MiddlewareHandler<Env> {
  return async (c, next) => {
    await next();
    c.res.headers.set("Cache-Control", NO_STORE_CACHE_CONTROL);
  };
}
