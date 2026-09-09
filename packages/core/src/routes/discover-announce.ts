/**
 * Announcing a site to its directory, from whichever route just gave it a
 * reason to.
 *
 * Two routes have one: the settings page, whenever the owner turns Discover on
 * or off, and first-run setup, when they answer the same question for the first
 * time. Both send the same thing to the same place, so they send it through the
 * same function rather than through two that drift.
 *
 * The transport lives in `lib/discover-ping.ts` and the protocol in
 * `lib/discover.ts`. What is here is the part that needs a request: the
 * deployment's endpoint, the site's own address, and the runtime's hook for
 * work that outlives the response.
 */

import type { Context } from "hono";
import type { Bindings } from "../types.js";
import type { AppVariables } from "../types/app-context.js";
import { runDeferred } from "../lib/deferred.js";
import {
  getDiscoverFeedPath,
  parseDiscoverSetting,
  resolveDiscoverMode,
} from "../lib/discover.js";
import { getDiscoverDefault, getDiscoverPingUrl } from "../lib/env.js";
import { toAbsoluteSiteUrl } from "../lib/url.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

/**
 * Tell the configured directory where this site's feed is, in the background.
 *
 * Never awaited by its caller. A directory takes up to twelve seconds to give
 * up on, and neither a settings save nor the last screen of setup may hang on
 * one — nor fail because one is down. The outcome is recorded either way, so
 * the owner can tell "announced" from "never got through"; the settings page's
 * status block is where that shows, and it carries a Retry.
 *
 * @param c - Request context, for the runtime's background-work hook
 * @param storedValue - The stored Discover choice. Passed in rather than read
 *   from `c.var.allSettings`, which is the snapshot taken before the request
 *   ran — on the save that triggers this it still holds the previous answer.
 * @returns Whether an announcement was started at all
 */
export function announceInBackground(
  c: Context<Env>,
  storedValue: string | undefined,
): boolean {
  const { appConfig } = c.var;
  const endpoint = getDiscoverPingUrl(c.env);
  if (!endpoint) return false;

  // Read the mode back through the same derivation the feed uses, so a site
  // that cannot actually be polled — feeds switched off, `noindex` set, demo
  // mode — never announces an address that would answer 404.
  const mode = resolveDiscoverMode({
    storedValue,
    defaultValue: getDiscoverDefault(c.env),
    demoMode: appConfig.demoMode,
    noindex: appConfig.noindex,
    rssFeedsEnabled: appConfig.rssFeedsEnabled,
  });
  // A site that has just switched Discover off resolves to `none` and so has
  // no feed of its own to name — but that is exactly the site with something
  // to say, and the declaration a directory needs to read sits in every feed,
  // not only the one it was polling. `/latest/feed` is the address that is
  // always served, so the stop is sent there.
  //
  // Only for an owner's own `off`, never for the other ways a site resolves to
  // `none`: a demo site or one with feeds switched off would be naming an
  // address that answers 404.
  const feedPath =
    getDiscoverFeedPath(mode) ??
    (parseDiscoverSetting(storedValue) === "off" &&
    appConfig.rssFeedsEnabled &&
    !appConfig.demoMode
      ? getDiscoverFeedPath("latest")
      : null);
  if (!feedPath) return false;

  // Deferred, so the caller answers without waiting on a directory. The helper
  // is what keeps the orphaned promise from taking a Node process down with
  // it: `announceToDiscover` already resolves rather than throws, and this is
  // what holds if it ever stops being.
  runDeferred(c, "Discover announcement", async () => {
    await c.var.services.settings.announceToDiscover({
      endpoint,
      feedUrl: toAbsoluteSiteUrl(
        feedPath,
        appConfig.siteUrl,
        appConfig.sitePathPrefix,
      ),
    });
  });
  return true;
}
