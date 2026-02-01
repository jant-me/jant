/**
 * i18n Module
 *
 * IMPORTANT: This module is designed for concurrent environments (Cloudflare Workers).
 * We create a new i18n instance per request to avoid race conditions.
 *
 * Usage with Lingui macros:
 * ```typescript
 * import { msg } from "@lingui/core/macro";
 * import { getI18n } from "@/i18n";
 *
 * const i18n = getI18n(c);
 * const text = i18n._(msg({ message: "Hello", comment: "@context: Greeting" }));
 * ```
 */

// Core i18n runtime
export {
  createI18n,
  getI18n,
  locales,
  baseLocale,
  isLocale,
  type Locale,
  type I18n,
} from "./i18n.js";

// Language detection utilities
export {
  detectLanguage,
  isValidLanguage,
  parseAcceptLanguage,
  getLanguageDisplayName,
  getSupportedLanguages,
  LANGUAGE_COOKIE_NAME,
} from "./detect.js";

// Hono middleware
export { i18nMiddleware } from "./middleware.js";
