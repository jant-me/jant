/**
 * Public machine-readable content access policies.
 *
 * This guard runs after configuration has been resolved. It keeps public HTML
 * rendering independent from the optional JSON API. Feeds check their own
 * switch where they are rendered; see `feedsPublished`.
 */

import type { MiddlewareHandler } from "hono";
import type { Bindings } from "../types.js";
import type { AppVariables } from "../types/app-context.js";

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
