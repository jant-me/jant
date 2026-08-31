/**
 * Language View Routes
 *
 * Every reader-facing surface, served a second time under a language prefix
 * (`/en`, `/zh-hant`). The primary language keeps the unprefixed root, so this
 * group only ever handles the other languages.
 *
 * Two things about how this is wired are load-bearing:
 *
 * 1. **The group is always mounted.** Which prefixes are languages is
 *    per-site configuration loaded by `withConfig()` on each request, and one
 *    app instance serves many sites in hosted mode — so the routing table
 *    cannot encode the language set. The decision is made per request instead.
 *
 * 2. **The decision lives inside each handler, not in middleware.** Hono
 *    middleware cannot decline a route: `next()` proceeds *into* the handlers
 *    that already matched. A gate that has to fall through to the
 *    `path_registry` catch-all therefore has to be the handler itself, which
 *    is what `langGet()` welds on at registration time.
 *
 * Mount this immediately before the catch-all page routes, after every static
 * route group, so `/archive` reaches the archive rather than being read as a
 * language named "archive".
 */

import { Hono } from "hono";
import type { Context, Next } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { resolveLanguageView } from "../../lib/view-language.js";
import {
  redirectLegacyArchiveFeed,
  renderArchiveFeed,
  renderArchiveRoute,
} from "./archive.js";
import {
  renderCollectionSelectionFeedRoute,
  renderCollectionSelectionRoute,
} from "./collection.js";
import { renderCollectionsDirectory } from "./collections.js";
import { renderSubscribePage } from "./subscribe.js";
import {
  redirectLegacyFeaturedFeed,
  renderFeaturedFeed,
  renderFeaturedPage,
} from "./featured.js";
import { renderHomePage } from "./home.js";
import {
  redirectLatestToHome,
  redirectLegacyLatestFeed,
  renderLatestFeed,
} from "./latest.js";
import { renderRegisteredPath } from "./page.js";
import { renderSearchPage } from "./search.js";
import { renderMainFeed } from "../feed/feed.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const languageRoutes = new Hono<Env>();

type ViewHandler = (c: Context<Env>) => Response | Promise<Response>;

/**
 * Register a surface under the language prefix, gated on the prefix actually
 * being one of this site's languages.
 *
 * @param path - Path within the language prefix, such as `/archive`
 * @param handler - The same handler the root namespace uses
 */
function langGet(path: string, handler: ViewHandler): void {
  languageRoutes.get(path, async (c: Context<Env>, next: Next) => {
    const decision = resolveLanguageView(c);

    if (decision.kind === "pass") return next();
    if (decision.kind === "redirect") return c.redirect(decision.to, 301);

    c.set("viewLang", decision.lang);
    // Drives `<html lang>`, the CJK font profile, and feed language tags. The
    // message catalog deliberately stays on the base locale: public chrome is
    // English on every view, exactly as it is at the root.
    c.set("lang", decision.lang);

    return handler(c);
  });
}

langGet("/", renderHomePage);
langGet("/feed", renderMainFeed);

langGet("/latest", redirectLatestToHome);
langGet("/latest/feed", renderLatestFeed);
langGet("/latest/feed/atom.xml", redirectLegacyLatestFeed);

langGet("/featured", renderFeaturedPage);
langGet("/featured/feed", renderFeaturedFeed);
langGet("/featured/feed/atom.xml", redirectLegacyFeaturedFeed);

langGet("/archive", renderArchiveRoute);
langGet("/archive/feed", renderArchiveFeed);
langGet("/archive/feed/atom.xml", redirectLegacyArchiveFeed);

langGet("/search", renderSearchPage);

langGet("/subscribe", renderSubscribePage);

langGet("/collections", renderCollectionsDirectory);
langGet("/collections/:slug", renderCollectionSelectionRoute);
langGet("/collections/:slug/feed", renderCollectionSelectionFeedRoute);

// Registered last: everything else resolves through the path registry, the
// same way the root namespace does. Anything that is not a language prefix
// falls through from here to the root catch-all.
langGet("/*", renderRegisteredPath);
