/**
 * i18n Hono Middleware
 */

import type { MiddlewareHandler } from "hono";
import { detectLanguage } from "./detect.js";
import { setLocale, type Locale } from "./i18n.js";

declare module "hono" {
  interface ContextVariableMap {
    lang: Locale;
  }
}

/**
 * Hono middleware for internationalization.
 * Detects the user's preferred language and sets it in the context.
 */
export function i18nMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const lang = detectLanguage(c);
    setLocale(lang);
    c.set("lang", lang);
    await next();
  };
}
