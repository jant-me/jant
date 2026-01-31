/**
 * Language Detection Utilities
 */

import type { Context } from "hono";
import { locales, baseLocale, isLocale, type Locale } from "./locales.js";

export const LANGUAGE_COOKIE_NAME = "lang";

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

/**
 * Parse Accept-Language header and return best matching locale
 */
export function parseAcceptLanguage(header: string | null): Locale {
  if (!header) return baseLocale;

  // Parse "en-US,en;q=0.9,zh-CN;q=0.8" format
  const languages = header
    .split(",")
    .map((part) => {
      const [lang, qPart] = part.trim().split(";");
      const q = qPart ? parseFloat(qPart.replace("q=", "")) : 1;
      return { lang: lang?.trim() ?? "", q };
    })
    .sort((a, b) => b.q - a.q);

  for (const { lang } of languages) {
    // Direct match
    if (isLocale(lang)) {
      return lang;
    }

    // Map common variants
    const normalized = lang.toLowerCase();
    if (normalized.startsWith("zh-cn") || normalized.startsWith("zh-hans")) {
      return "zh-Hans";
    }
    if (
      normalized.startsWith("zh-tw") ||
      normalized.startsWith("zh-hk") ||
      normalized.startsWith("zh-hant")
    ) {
      return "zh-Hant";
    }
    if (normalized.startsWith("zh")) {
      return "zh-Hans"; // Default Chinese to Simplified
    }
    if (normalized.startsWith("en")) {
      return "en";
    }
  }

  return baseLocale;
}

/**
 * Detect user's preferred language from Hono context
 * Priority: Cookie > Accept-Language header > Default
 */
export function detectLanguage(c: Context): Locale {
  // 1. Check cookie (using getCookie helper)
  const cookies = c.req.raw.headers.get("Cookie") ?? "";
  const cookieMatch = cookies.match(new RegExp(`${LANGUAGE_COOKIE_NAME}=([^;]+)`));
  const cookieLang = cookieMatch?.[1];
  if (cookieLang && isLocale(cookieLang)) {
    return cookieLang;
  }

  // 2. Check Accept-Language header
  const acceptLang = c.req.header("Accept-Language") ?? null;
  return parseAcceptLanguage(acceptLang);
}
