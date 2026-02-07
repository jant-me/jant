/**
 * i18n Module
 *
 * IMPORTANT: This module is designed for concurrent environments (Cloudflare Workers).
 * We create a new i18n instance per request to avoid race conditions.
 *
 * This is a custom implementation compatible with Hono JSX (SSR), not React.
 * It provides a React-like API using Lingui macros with a custom context system.
 *
 * Usage:
 * ```tsx
 * import { useLingui, Trans, I18nProvider } from "@/i18n";
 *
 * // Wrap your app in I18nProvider (automatically done by BaseLayout when c is provided)
 * c.html(
 *   <I18nProvider c={c}>
 *     <MyApp />
 *   </I18nProvider>
 * );
 *
 * // Inside components, use useLingui() hook
 * function MyApp() {
 *   const { t } = useLingui();
 *
 *   return (
 *     <div>
 *       <h1>{t({ message: "Dashboard", comment: "@context: Page title" })}</h1>
 *       <Trans comment="@context: Help text">
 *         Read the <a href="/docs">documentation</a>
 *       </Trans>
 *     </div>
 *   );
 * }
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

// I18nProvider and useLingui hook (custom implementation for Hono JSX, SSR-compatible)
export { I18nProvider, useLingui } from "./context.js";

// Trans component (simplified for Hono JSX)
export { Trans } from "./Trans.js";

// Language detection utilities
export {
  isValidLanguage,
  getLanguageDisplayName,
  getSupportedLanguages,
} from "./detect.js";

// Hono middleware
export { i18nMiddleware } from "./middleware.js";
