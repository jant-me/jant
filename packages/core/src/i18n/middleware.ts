/**
 * i18n Hono Middleware
 */

import type { MiddlewareHandler } from "hono";
import type { I18n } from "@lingui/core";
import { createI18n, isLocale, baseLocale, type Locale } from "./i18n.js";
import type { Services } from "../services/index.js";

declare module "hono" {
  interface ContextVariableMap {
    lang: Locale;
    i18n: I18n;
  }
}

/**
 * Hono middleware for internationalization.
 * Creates a per-request i18n instance to avoid race conditions in concurrent environments.
 *
 * Language is determined by the database SITE_LANGUAGE setting (single source of truth).
 * Falls back to the default locale (en) if not set.
 */
export function i18nMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    let lang: Locale = baseLocale;

    const services = c.get("services") as Services | undefined;
    if (services) {
      try {
        const siteLang = await services.settings.get("SITE_LANGUAGE");
        if (siteLang && isLocale(siteLang)) {
          lang = siteLang;
        }
      } catch {
        // Ignore errors, fall back to default locale
      }
    }

    // Create a new i18n instance for this request to avoid race conditions
    const i18n = createI18n(lang);

    c.set("lang", lang);
    c.set("i18n", i18n);
    await next();
  };
}
