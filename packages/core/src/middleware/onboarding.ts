/**
 * Onboarding Middleware
 *
 * Redirects key page routes to /setup while first-run setup is unfinished.
 * Uses an allowlist approach: only explicitly listed page routes are redirected,
 * so static assets, API endpoints, feeds, and other resources always pass through.
 * Caches the result in memory so the DB is only queried once per isolate lifetime.
 *
 * How much is gated depends on how far setup has got:
 *
 * - `pending` — nobody owns the site and it holds nothing. Readers have no
 *   business being anywhere but setup, so the public root is gated too.
 * - `provisioned` — a control plane already created the site and its owner, so
 *   the site is real and must serve readers normally. Only the author's own
 *   entrances are gated, and only once they are signed in, because the one
 *   remaining question is theirs to answer.
 */

import type { MiddlewareHandler } from "hono";
import type { Bindings } from "../types.js";
import type { AppVariables } from "../types/app-context.js";
import { ONBOARDING_STATUS } from "../lib/constants.js";
import { getRuntimeSitePathPrefix } from "../lib/site-resolution.js";
import { toPublicPath } from "../lib/url.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

/** In-memory cache — persists across requests within a Worker isolate */
const completedOnboardingSites = new Set<string>();

/**
 * Middleware that redirects to /setup if onboarding is not complete.
 * Uses module-level caching: once onboarding is confirmed complete,
 * no further DB queries are made for the lifetime of the Worker isolate.
 */
export function requireOnboarding(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const path = new URL(c.req.url).pathname;

    if (completedOnboardingSites.has(c.var.currentSite.id)) {
      return next();
    }

    if (!isGatedPath(path)) {
      return next();
    }

    const status = await c.var.services.settings.getOnboardingStatus();
    if (status === ONBOARDING_STATUS.COMPLETED) {
      completedOnboardingSites.add(c.var.currentSite.id);
      return next();
    }

    if (
      status === ONBOARDING_STATUS.PROVISIONED &&
      !(c.var.isAuthenticated && isAuthorPath(path))
    ) {
      return next();
    }

    const sitePathPrefix = getRuntimeSitePathPrefix({
      env: c.env,
      appConfig: c.var.appConfig,
      currentSiteDomain: c.var.currentSiteDomain,
    });

    return c.redirect(toPublicPath("/setup", sitePathPrefix));
  };
}

/**
 * Only these page routes are ever redirected to /setup.
 * Everything else (assets, API, feeds, media, etc.) passes through.
 */
function isGatedPath(path: string): boolean {
  return path === "/signin" || path === "/reset" || isAuthorPath(path);
}

/** The routes an author uses to reach their own site. */
function isAuthorPath(path: string): boolean {
  return (
    path === "/" || path.startsWith("/settings") || path.startsWith("/compose")
  );
}

/**
 * Reset the onboarding cache. Only for testing.
 * @internal
 */
export function resetOnboardingCache() {
  completedOnboardingSites.clear();
}
