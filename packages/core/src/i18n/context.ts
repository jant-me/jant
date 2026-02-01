/**
 * i18n Context for Hono JSX (SSR-compatible)
 *
 * Since Hono JSX doesn't support React hooks and Cloudflare Workers
 * doesn't support AsyncLocalStorage, we use a simple global variable.
 *
 * IMPORTANT: This assumes synchronous rendering (which Hono JSX does).
 * Each request should set the context, render, then clear it.
 */

import type { I18n } from "@lingui/core";

// Global i18n context (set per request, synchronous rendering only)
let currentI18n: I18n | null = null;

/**
 * Set the current i18n instance
 */
export function setI18nContext(i18n: I18n): void {
  currentI18n = i18n;
}

/**
 * Clear the current i18n instance
 */
export function clearI18nContext(): void {
  currentI18n = null;
}

/**
 * Get current i18n instance from context
 */
export function getI18nContext(): I18n {
  if (!currentI18n) {
    throw new Error("useLingui() called outside of I18nProvider");
  }
  return currentI18n;
}

/**
 * Hook to access i18n from context
 * This is a simple implementation that works with Hono JSX SSR
 */
export function useLingui() {
  const i18n = getI18nContext();

  return {
    i18n,
    /**
     * Translation function compatible with Lingui macros
     * The macro transforms t({ message, comment, values }) into a message descriptor
     * that gets passed to i18n._()
     *
     * @example
     * const { t } = useLingui();
     * t({ message: "Hello", comment: "@context: Greeting" })
     * // After macro transformation becomes:
     * // t({ id: "hash", message: "Hello", values })
     */
    t: (descriptor: any) => {
      // Lingui macros transform the call into a message descriptor
      // i18n._() handles the actual translation
      return i18n._(descriptor);
    },
    _: i18n._,
  };
}
