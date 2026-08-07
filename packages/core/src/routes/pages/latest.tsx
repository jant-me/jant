/**
 * Latest Page Route
 *
 * The homepage is the canonical latest timeline, so /latest redirects to /.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { toViewPath } from "../../lib/view-language.js";
import { defaultFeedRenderer } from "../../lib/feed.js";
import { buildFeedData, parseFormatQuery, renderFeed } from "../feed/feed.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const latestRoutes = new Hono<Env>();

/** `/latest` is an alias for the view's home timeline. */
export function redirectLatestToHome(c: Context<Env>): Response {
  return c.redirect(toViewPath(c, "/"), 302);
}

/**
 * Render the latest Atom feed for the current view language.
 *
 * Accepts `?format=note|link|quote`.
 *
 * @param c - Hono context
 * @returns Atom feed response
 */
export async function renderLatestFeed(c: Context<Env>): Promise<Response> {
  const format = parseFormatQuery(c);
  const feedData = await buildFeedData(c, {
    kind: "latest",
    selfPath: "/latest/feed",
    format,
  });
  return renderFeed(defaultFeedRenderer(feedData));
}

/** Legacy atom.xml suffix → canonical /latest/feed, preserving `?format=`. */
export function redirectLegacyLatestFeed(c: Context<Env>): Response {
  const qs = c.req.url.includes("?")
    ? c.req.url.slice(c.req.url.indexOf("?"))
    : "";
  return c.redirect(`${toViewPath(c, "/latest/feed")}${qs}`, 308);
}

latestRoutes.get("/", redirectLatestToHome);
latestRoutes.get("/feed", renderLatestFeed);
latestRoutes.get("/feed/atom.xml", redirectLegacyLatestFeed);
