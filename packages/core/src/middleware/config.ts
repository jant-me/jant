/**
 * Config Middleware
 *
 * Loads settings from DB, resolves app config and theme.
 * Apply only to route groups that need config/theme data —
 * skip for /healthz, /media/*, /favicon.ico, /api/auth/*, etc.
 */

import type { Context, MiddlewareHandler } from "hono";
import type { Bindings } from "../types.js";
import type { AppVariables } from "../types/app-context.js";
import { resolveConfig } from "../lib/resolve-config.js";
import {
  getConfiguredSingleSitePathPrefix,
  getConfiguredSingleSiteUrl,
  getSiteResolutionMode,
} from "../lib/env.js";
import { buildThemeStyle, resolveBuiltinTheme } from "../lib/theme.js";
import {
  BUILTIN_FONT_THEMES,
  getFontThemeCssVariables,
} from "../ui/font-themes.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

/**
 * The site's settings for this request, read once.
 *
 * The first caller starts the read and every later one shares it, so the
 * onboarding gate and `withConfig()` cost one query between them. Nothing
 * between the first middleware that asks and the route handler writes a
 * setting, so a request sees one consistent snapshot, as it would if
 * `withConfig()` read them itself.
 *
 * @param c - Hono context
 * @returns Every stored setting, by key
 * @example
 * const allSettings = await loadRequestSettings(c);
 */
export function loadRequestSettings(
  c: Context<Env>,
): Promise<Record<string, string>> {
  const pending = c.var.settingsLoad;
  if (pending) return pending;
  const load = c.var.services.settings.getAll();
  c.set("settingsLoad", load);
  return load;
}

/**
 * Start reading the site's settings without waiting for them.
 *
 * On Workers each read the middleware chain waits on is one more trip to
 * D1, and the reads here are independent: the stored-redirect lookup needs a
 * path, not the settings. Registered ahead of that middleware, this puts the
 * settings read in flight alongside the lookup instead of after it.
 */
export function prefetchSettings(): MiddlewareHandler<Env> {
  return async (c, next) => {
    // A redirect can answer before `withConfig()` awaits the read; a failure
    // nobody awaits must not surface as an unhandled rejection. Whoever does
    // await it still sees the error.
    loadRequestSettings(c).catch(() => {});
    await next();
  };
}

/**
 * Middleware that loads settings, resolves app config, and builds theme CSS.
 *
 * Sets `allSettings`, `appConfig`, and `themeStyle` on the Hono context.
 */
export function withConfig(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const allSettings = await loadRequestSettings(c);
    c.set("allSettings", allSettings);
    const publicRequestOrigin = new URL(c.var.publicRequestUrl).origin;
    const siteUrlOverride =
      getSiteResolutionMode(c.env) === "host-based"
        ? `${publicRequestOrigin}${c.var.currentSiteDomain?.pathPrefix ?? ""}`
        : getConfiguredSingleSiteUrl(c.env) ||
          `${publicRequestOrigin}${getConfiguredSingleSitePathPrefix(c.env)}`;
    const appConfig = resolveConfig(c.env, allSettings, {
      siteUrl: siteUrlOverride,
    });
    c.set("appConfig", appConfig);

    // Resolve active color theme
    const activeTheme = resolveBuiltinTheme(appConfig.themeId);

    // Build font theme CSS variables. The CJK fallback stacks are deliberately
    // NOT resolved here: they depend on the language of the page being
    // rendered — a post's own language, or the language a filtered list view is
    // showing — which this middleware runs too early to know. `BaseLayout`
    // emits them alongside the matching CJK stylesheet instead.
    const fontTheme = BUILTIN_FONT_THEMES.find(
      (f) => f.id === appConfig.fontThemeId,
    );
    const fontOverrides = fontTheme ? getFontThemeCssVariables(fontTheme) : {};

    const themeStyle = buildThemeStyle(activeTheme, fontOverrides);
    c.set("themeStyle", themeStyle);

    await next();
  };
}
