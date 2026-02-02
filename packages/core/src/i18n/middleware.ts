/**
 * i18n Hono Middleware
 */

import type { MiddlewareHandler } from "hono";
import type { I18n } from "@lingui/core";
import { detectLanguage } from "./detect.js";
import { createI18n, isLocale, type Locale } from "./i18n.js";
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
 * Language detection priority:
 * 1. Cookie (user preference)
 * 2. Database SITE_LANGUAGE setting (site default)
 * 3. Accept-Language header
 * 4. Default locale (en)
 */
export function i18nMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    // First try cookie and Accept-Language header
    let lang = detectLanguage(c);

    // If no cookie is set, check database SITE_LANGUAGE setting
    const cookies = c.req.raw.headers.get("Cookie") ?? "";
    const hasCookie = cookies.includes("lang=");

    if (!hasCookie) {
      // Check database setting
      const services = c.get("services") as Services | undefined;
      if (services) {
        try {
          const siteLang = await services.settings.get("SITE_LANGUAGE");
          if (siteLang && isLocale(siteLang)) {
            lang = siteLang;
          }
        } catch {
          // Ignore errors, fall back to detected language
        }
      }
    }

    // Create a new i18n instance for this request to avoid race conditions
    const i18n = createI18n(lang);

    c.set("lang", lang);
    c.set("i18n", i18n);
    await next();
  };
}
