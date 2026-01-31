/**
 * Centralized locale configuration
 */

export const locales = ["en", "zh-Hans", "zh-Hant"] as const;
export type Locale = (typeof locales)[number];
export const baseLocale: Locale = "en";

/**
 * Check if a value is a valid locale
 */
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && locales.includes(value as Locale);
}
