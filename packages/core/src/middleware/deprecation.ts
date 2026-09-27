/**
 * Deprecated API endpoints.
 *
 * A deprecated endpoint keeps answering exactly as before until the major
 * release that removes it, and says so on every response, errors included:
 * `Deprecation` (RFC 9745) carries when it was deprecated, and `Link` with
 * `rel="successor-version"` names what replaces it. The docs and the release
 * notes say the same thing in words.
 */

import type { MiddlewareHandler } from "hono";
import type { Bindings } from "../types.js";
import type { AppVariables } from "../types/app-context.js";
import { toPublicPath } from "../lib/url.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

/**
 * When 0.9 deprecated the Thread lists that `/api/public/threads` replaces:
 * the `GET /api/public/posts` list and `GET /api/public/archive`.
 */
export const THREAD_LIST_DEPRECATED_AT = Date.UTC(2026, 8, 27) / 1000;

/**
 * Mark every response of a route as deprecated.
 *
 * @param deprecatedAt - Unix seconds the endpoint was deprecated
 * @param successor - The replacement, as a site path (the site path prefix is
 *   added)
 * @returns Hono middleware that sets `Deprecation` and `Link`
 * @example
 * ```ts
 * routes.get("/", deprecated(THREAD_LIST_DEPRECATED_AT, "/api/public/threads"), handler);
 * ```
 */
export function deprecated(
  deprecatedAt: number,
  successor: string,
): MiddlewareHandler<Env> {
  return async (c, next) => {
    await next();
    c.header("Deprecation", `@${deprecatedAt}`);
    c.header(
      "Link",
      `<${toPublicPath(successor, c.var.appConfig.sitePathPrefix)}>; rel="successor-version"`,
    );
  };
}
