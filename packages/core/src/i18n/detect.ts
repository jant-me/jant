/**
 * Language Detection Utilities
 */

import { locales, isLocale, type Locale } from "./locales.js";

/**
 * Get display name for a language code
 */
export function getLanguageDisplayName(locale: Locale): string {
  const names: Record<Locale, string> = {
    en: "English",
    "zh-Hans": "简体中文",
    "zh-Hant": "繁體中文",
  };
  return names[locale];
}

/**
 * Get all supported languages with display names
 */
export function getSupportedLanguages(): Array<{ code: Locale; name: string }> {
  return locales.map((code) => ({
    code,
    name: getLanguageDisplayName(code),
  }));
}

/**
 * Check if a language code is valid
 */
export function isValidLanguage(lang: unknown): lang is Locale {
  return isLocale(lang);
}
