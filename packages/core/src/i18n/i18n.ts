/**
 * i18n Runtime using @lingui/core
 *
 * The SWC Lingui plugin adds hash-based IDs to t() calls when imports come
 * from @lingui/react/macro. The runtimeConfigModule setting rewrites those
 * imports to our custom Hono JSX implementation at build time.
 */

import type { Messages } from "@lingui/core";
import { I18n } from "@lingui/core";
import { locales, baseLocale, isLocale, type Locale } from "./locales.js";
import { messages as messagesEn } from "./locales/en.js";
import { messages as messagesZhHans } from "./locales/zh-Hans.js";
import { messages as messagesZhHant } from "./locales/zh-Hant.js";

export { locales, baseLocale, isLocale, type Locale };

// Export I18n type for convenience
export type { I18n };

// Pre-compute merged catalogs at module load time (done once, not per request)
// For non-English locales, merge English as fallback so missing translations
// fall back to English rather than showing hash IDs.
const catalogEn: Messages = messagesEn;
const catalogZhHans: Messages = { ...messagesEn, ...messagesZhHans };
const catalogZhHant: Messages = { ...messagesEn, ...messagesZhHant };

/**
 * Create a new i18n instance for a specific locale.
 * IMPORTANT: In Cloudflare Workers (concurrent environment), we must create
 * a new instance per request to avoid race conditions. Never use a global instance!
 */
export function createI18n(locale: Locale): I18n {
  const i18n = new I18n({});

  i18n.load("en", catalogEn);
  i18n.load("zh-Hans", catalogZhHans);
  i18n.load("zh-Hant", catalogZhHant);

  i18n.activate(locale);

  return i18n;
}

/**
 * Helper to get the per-request i18n instance from Hono context.
 * Use this in route handlers.
 *
 * @example
 * import { msg } from "@lingui/core/macro";
 * import { getI18n } from "@/i18n";
 *
 * const i18n = getI18n(c);
 * const title = i18n._(msg({ message: "Dashboard", comment: "@context: Page title" }));
 */
export function getI18n(c: { get(key: "i18n"): I18n }): I18n {
  return c.get("i18n");
}
