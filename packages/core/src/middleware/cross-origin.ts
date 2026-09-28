/**
 * Cross-origin write protection
 *
 * A browser attaches a `SameSite=Lax` session cookie to any request that
 * starts on the same *site*, and a site is the registrable domain, not the
 * origin. Hosted blogs share one parent domain, so without this check a page
 * on one blog could post to another blog's settings with that blog's author
 * signed in. `c.req.json()` parses a `text/plain` body too, so an ordinary
 * auto-submitting form is enough.
 *
 * A request that changes state and carries a session cookie must therefore
 * come from this site's own origin, or from an origin `CORS_ORIGINS` names.
 * Browsers say where a request started with `Sec-Fetch-Site`, and older ones
 * with `Origin`. A request with neither didn't come from a web page, so no
 * ambient cookie is being borrowed and it passes, as does anything without a
 * session cookie: API tokens travel in a header a page can't make a browser
 * add on its own.
 */

import type { MiddlewareHandler } from "hono";
import type { Bindings } from "../types.js";
import type { AppVariables } from "../types/app-context.js";
import { ForbiddenError } from "../lib/errors.js";
import { getCorsOrigins, getEnvString } from "../lib/env.js";
import { hasSessionCookie } from "../runtime/index.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** What {@link isAllowedWrite} needs to know about one request. */
export interface WriteRequestInfo {
  method: string;
  cookie: string | undefined;
  secFetchSite: string | undefined;
  origin: string | undefined;
  /** Hosts (`host[:port]`) this site answers on. */
  siteHosts: readonly string[];
  /** Origins `CORS_ORIGINS` lists by name; `*` never counts. */
  trustedOrigins: readonly string[];
}

function hostOf(value: string): string | null {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Decides whether a request may go on to a route that could change state.
 *
 * @param info - The request's method, cookie, provenance headers, and the
 *   hosts and origins this site trusts
 * @returns `true` when the request is a read, carries no session, or started
 *   on this site or a trusted origin
 *
 * @example
 * ```ts
 * isAllowedWrite({
 *   method: "POST",
 *   cookie: "better-auth.session_token=abc",
 *   secFetchSite: "same-site",
 *   origin: "https://other.jant.blog",
 *   siteHosts: ["mine.jant.blog"],
 *   trustedOrigins: [],
 * }); // false
 * ```
 */
export function isAllowedWrite(info: WriteRequestInfo): boolean {
  if (SAFE_METHODS.has(info.method.toUpperCase())) return true;
  if (!hasSessionCookie(info.cookie)) return true;

  if (info.origin && info.trustedOrigins.includes(info.origin)) return true;

  const fetchSite = info.secFetchSite?.toLowerCase();
  if (fetchSite) {
    return fetchSite === "same-origin" || fetchSite === "none";
  }

  // Browsers that predate `Sec-Fetch-Site` still send `Origin` on a POST.
  if (!info.origin) return true;
  const originHost = hostOf(info.origin);
  return originHost !== null && info.siteHosts.includes(originHost);
}

/**
 * Refuses a state-changing request that carries a session cookie but started
 * on another site.
 *
 * @returns Hono middleware that throws `ForbiddenError` for such a request
 *
 * @example
 * ```ts
 * app.use("*", rejectCrossOriginWrites());
 * ```
 */
export function rejectCrossOriginWrites(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const corsOrigins = getCorsOrigins(c.env);
    const siteOrigin = getEnvString(c.env, "SITE_ORIGIN");
    const siteHosts = [c.req.url, c.var.publicRequestUrl, siteOrigin]
      .map((value) => (value ? hostOf(value) : null))
      .filter((host): host is string => host !== null);

    const allowed = isAllowedWrite({
      method: c.req.method,
      cookie: c.req.header("cookie"),
      secFetchSite: c.req.header("sec-fetch-site"),
      origin: c.req.header("origin"),
      siteHosts,
      trustedOrigins: Array.isArray(corsOrigins) ? corsOrigins : [],
    });

    if (!allowed) {
      throw new ForbiddenError(
        "This request started on another site, so it was refused. Open the page on this site and try again.",
      );
    }

    await next();
  };
}
