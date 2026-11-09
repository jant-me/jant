/**
 * View Counter Middleware
 *
 * Runs after the route and, when the route named what it rendered
 * (`c.var.viewTarget`) and the request was one reader opening that page,
 * files a hit with the process's view buffer. The reader never waits on it:
 * the hit is a map increment, and the write it leads to happens seconds
 * later, behind `waitUntil` on Workers and in the event loop on Node.
 *
 * Everything that decides whether a response counts lives in
 * `lib/view-counting.ts`; everything about when it is written lives in
 * `lib/view-buffer.ts`; what is kept and for how long lives in
 * `services/stats.ts`. This file only connects them to a request.
 */

import type { MiddlewareHandler } from "hono";
import type { Bindings } from "../types.js";
import type { AppVariables } from "../types/app-context.js";
import { now } from "../lib/time.js";
import { viewBuffer, type ViewBuffer } from "../lib/view-buffer.js";
import {
  formatDayKey,
  formatHourKey,
  shouldCountView,
  viewPathKey,
  viewReferrer,
} from "../lib/view-counting.js";
import { viewBasePath } from "../lib/view-language.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

/**
 * Middleware that counts a page view once the route has answered.
 *
 * Mount it after `withConfig()`, since the site's time zone and the stats
 * switch come from the resolved config, and before the page routes, so it
 * wraps them.
 *
 * @param buffer - The buffer hits go to; tests pass their own
 * @returns Hono middleware
 *
 * @example
 * ```ts
 * app.use("*", withConfig());
 * app.use("*", viewCounter());
 * ```
 */
export function viewCounter(
  buffer: ViewBuffer = viewBuffer,
): MiddlewareHandler<Env> {
  return async (c, next) => {
    await next();

    const target = c.get("viewTarget");
    if (!target) return;

    const { appConfig } = c.var;
    if (!appConfig.stats.enabled) return;
    if (
      !shouldCountView({
        method: c.req.method,
        status: c.res.status,
        contentType: c.res.headers.get("content-type"),
        isAuthenticated: c.var.isAuthenticated,
        headers: c.req.raw.headers,
      })
    ) {
      return;
    }

    // `c.req.path` carries no query string: the second page of the home
    // feed and a filtered archive are the page they belong to.
    const page =
      target.kind === "path"
        ? viewPathKey(c.req.path, viewBasePath(c))
        : target.id;
    const { services } = c.var;
    const { dailyLimit } = appConfig.stats;
    const at = now();

    buffer.add(
      {
        siteId: c.var.currentSite.id,
        day: formatDayKey(at, appConfig.timeZone),
        hour: formatHourKey(at, appConfig.timeZone),
        page,
        referrer: viewReferrer({
          referer: c.req.header("referer"),
          requestUrl: c.req.url,
          ownHost: new URL(c.var.publicRequestUrl).hostname,
          fetchSite: c.req.header("sec-fetch-site"),
        }),
      },
      {
        record: (entries) =>
          services.stats.record(entries, {
            dailyLimit,
            today: formatDayKey(now(), "UTC"),
          }),
        keepAlive: (promise) => {
          try {
            c.executionCtx.waitUntil(promise);
          } catch {
            // Node and tests have no ExecutionContext; the timer runs anyway.
          }
        },
      },
    );
  };
}
