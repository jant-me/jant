/**
 * View Counter Middleware
 *
 * Runs after the route and, when the route named what it rendered
 * (`c.var.viewTarget`) and the request was one reader opening that page,
 * writes a signed view token into the page's `<head>`. The view is counted
 * only when the browser posts that token back (`routes/view-confirm.ts`),
 * which the reader bundle does once the page has been in front of the reader
 * for a few seconds or on the first interaction: a request can look exactly
 * like a reader's and still be a crawler running a browser, and what tells
 * them apart happens after the HTML arrives. The reader never waits on any
 * of it.
 *
 * Everything that decides whether a response may count lives in
 * `lib/view-counting.ts`; the token in `lib/view-token.ts`; when a confirmed
 * view is written in `lib/view-buffer.ts`; what is kept and for how long in
 * `services/stats.ts`. This file connects the first two to a response.
 */

import type { Context, MiddlewareHandler } from "hono";
import type { Bindings } from "../types.js";
import type { AppVariables } from "../types/app-context.js";
import { getEnvString } from "../lib/env.js";
import { now } from "../lib/time.js";
import type { ViewSink } from "../lib/view-buffer.js";
import {
  formatDayKey,
  shouldCountView,
  viewPathKey,
  viewReferrer,
} from "../lib/view-counting.js";
import { signViewToken, VIEW_TOKEN_META_NAME } from "../lib/view-token.js";
import { viewBasePath } from "../lib/view-language.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

/**
 * Where a confirmed view's hit goes: the site's stats service, with the
 * flush kept alive past the response on Workers.
 *
 * @param c - The request the hit belongs to
 * @returns The sink for `ViewBuffer.add`
 * @example
 * buffer.add(hit, viewSinkFor(c));
 */
export function viewSinkFor(c: Context<Env>): ViewSink {
  const { services, appConfig } = c.var;
  const { dailyLimit } = appConfig.stats;
  return {
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
  };
}

/**
 * Middleware that marks a page a reader opened with its view token.
 *
 * Mount it after `withConfig()`, since the stats switch comes from the
 * resolved config, and before the page routes, so it wraps them.
 *
 * @returns Hono middleware
 *
 * @example
 * ```ts
 * app.use("*", withConfig());
 * app.use("*", viewCounter());
 * ```
 */
export function viewCounter(): MiddlewareHandler<Env> {
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
    const secret = getEnvString(c.env, "AUTH_SECRET");
    if (!secret) return;

    // `c.req.path` carries no query string: the second page of the home
    // feed and a filtered archive are the page they belong to.
    const page =
      target.kind === "path"
        ? viewPathKey(c.req.path, viewBasePath(c))
        : target.id;
    const token = await signViewToken(
      secret,
      {
        siteId: c.var.currentSite.id,
        page,
        referrer: viewReferrer({
          referer: c.req.header("referer"),
          requestUrl: c.req.url,
          ownHost: new URL(c.var.publicRequestUrl).hostname,
          fetchSite: c.req.header("sec-fetch-site"),
        }),
      },
      now(),
    );

    // The body is a rendered string; reading it consumes it, so the response
    // is rebuilt either way. The token is base64url and hex: safe as-is in
    // an attribute.
    const html = await c.res.text();
    const head = html.indexOf("</head>");
    const body =
      head === -1
        ? html
        : `${html.slice(0, head)}<meta name="${VIEW_TOKEN_META_NAME}" content="${token}">${html.slice(head)}`;
    const headers = new Headers(c.res.headers);
    headers.delete("content-length");
    c.res = new Response(body, {
      status: c.res.status,
      statusText: c.res.statusText,
      headers,
    });
  };
}
