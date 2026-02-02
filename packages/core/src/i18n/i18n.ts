/**
 * i18n Runtime using @lingui/core with Lingui macros
 *
 * Usage:
 *   import { msg } from "@lingui/core/macro";
 *   import { bindI18n } from "@/i18n";
 *
 *   const { i18n } = bindI18n(c.get("i18n"));
 *
 *   // Simple message
 *   i18n._(msg({ message: "Hello", comment: "@context: Greeting" }))
 *
 *   // With interpolation
 *   i18n._(msg({ message: "Welcome, {name}!", comment: "@context: Welcome" }), { name })
 *
 * The msg macro generates hash-based IDs at compile time, which match the compiled catalogs.
 */

import { I18n } from "@lingui/core";
import { locales, baseLocale, isLocale, type Locale } from "./locales.js";
import { messages as messagesEn } from "./locales/en.js";
import { messages as messagesZhHans } from "./locales/zh-Hans.js";
import { messages as messagesZhHant } from "./locales/zh-Hant.js";

export { locales, baseLocale, isLocale, type Locale };

// Export I18n type for convenience
export type { I18n };

/**
 * Create a new i18n instance for a specific locale.
 * IMPORTANT: In Cloudflare Workers (concurrent environment), we must create
 * a new instance per request to avoid race conditions. Never use a global instance!
 */
export function createI18n(locale: Locale): I18n {
  const i18n = new I18n({});

  // Load all catalogs with English as fallback
  i18n.load("en", messagesEn);
  i18n.load("zh-Hans", { ...messagesEn, ...messagesZhHans });
  i18n.load("zh-Hant", { ...messagesEn, ...messagesZhHant });

  // Activate locale after loading messages to avoid warnings
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
