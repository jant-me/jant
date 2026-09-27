/**
 * Public machine-readable content access policies.
 *
 * These guards run after configuration has been resolved. They keep public
 * HTML rendering independent from the optional JSON API and Atom surfaces.
 */

import type { MiddlewareHandler } from "hono";
import type { Bindings } from "../types.js";
import type { AppVariables } from "../types/app-context.js";
import { isRssFeedPath } from "../lib/feed-path.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

/**
 * Return 404 when the dedicated public JSON API is disabled.
 *
 * Unlike shared read endpoints used by the dashboard, `/api/public/*` has an
 * authenticated alternative under `/api/posts`, so session and token auth do
 * not bypass this switch.
 *
 * @returns Hono middleware that makes the public API unavailable when disabled
 * @example
 * ```ts
 * app.use("/api/public/*", requirePublicApiEnabled());
 * ```
 */
export function requirePublicApiEnabled(): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (
      (c.req.method !== "GET" && c.req.method !== "HEAD") ||
      c.var.appConfig.publicApiEnabled
    ) {
      return next();
    }

    return c.notFound();
  };
}

/**
 * Return 404 for Atom endpoints when feed publishing is disabled.
 *
 * @returns Hono middleware that leaves non-feed requests unchanged
 * @example
 * ```ts
 * app.use("*", requireRssFeedsEnabled());
 * ```
 */
export function requireRssFeedsEnabled(): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (
      (c.req.method !== "GET" && c.req.method !== "HEAD") ||
      c.var.appConfig.rssFeedsEnabled ||
      !isRssFeedPath(new URL(c.req.url).pathname)
    ) {
      return next();
    }

    return c.notFound();
  };
}
