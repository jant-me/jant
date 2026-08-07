/**
 * Language Detection Utilities
 */

import { locales, baseLocale, isLocale, type Locale } from "./locales.js";

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
 * Map a BCP 47 language tag to a supported locale.
 *
 * @param tag - BCP 47 language tag (e.g. "zh-CN", "en-US")
 * @returns Matching locale, or `undefined` if unsupported
 */
function mapTagToLocale(tag: string): Locale | undefined {
  const normalized = tag.trim().toLowerCase();
  if (!normalized) return undefined;

  const cjkProfile = getCjkFontFromLanguageTag(normalized);
  if (cjkProfile === "zh-Hans" || cjkProfile === "zh-Hant") {
    return cjkProfile;
  }

  const primary = normalized.split("-")[0];
  if (isLocale(primary)) return primary;

  return undefined;
}

/**
 * Detect the best supported locale from an `Accept-Language` HTTP header.
 *
 * @param header - Raw `Accept-Language` header value
 * @returns Best matching locale, or the base locale ("en") if none match
 */
export function detectLocaleFromHeader(header: string | undefined): Locale {
  if (!header || !header.trim()) return baseLocale;

  const entries: Array<{ tag: string; q: number }> = [];

  for (const part of header.split(",")) {
    const segments = part.trim().split(";");
    const tag = segments[0]?.trim();
    if (!tag) continue;

    let q = 1.0;
    for (let i = 1; i < segments.length; i++) {
      const param = segments[i]?.trim();
      if (param?.toLowerCase().startsWith("q=")) {
        const parsed = Number.parseFloat(param.slice(2));
        if (!Number.isNaN(parsed)) q = parsed;
        break;
      }
    }

    if (q <= 0) continue;

    entries.push({ tag, q });
  }

  entries.sort((a, b) => b.q - a.q);

  for (const { tag } of entries) {
    const locale = mapTagToLocale(tag);
    if (locale) return locale;
  }

  return baseLocale;
}

/**
 * CJK typography profiles Jant ships a font stack for.
 *
 * Simplified, Traditional, Japanese and Korean want different Han glyph shapes
 * from the same code points, so each gets its own fallback stack and stylesheet.
 */
export const CJK_FONT_PROFILES = ["zh-Hans", "zh-Hant", "ja", "ko"] as const;
export type CjkFontProfile = (typeof CJK_FONT_PROFILES)[number];

/**
 * Map a BCP 47 language tag to a CJK font profile.
 *
 * @param tag - BCP 47 language tag (e.g. "zh-CN", "ja")
 * @returns CJK font profile, or `undefined` if not a CJK language
 * @example
 * getCjkFontFromLanguageTag("zh-TW") // "zh-Hant"
 */
export function getCjkFontFromLanguageTag(
  tag: string,
): CjkFontProfile | undefined {
  const normalized = tag.trim().toLowerCase();
  if (!normalized) return undefined;

  const primary = normalized.split("-")[0];

  if (primary === "zh") {
    const rest = normalized.slice(3);
    if (rest === "hant" || rest === "tw" || rest === "hk" || rest === "mo")
      return "zh-Hant";
    // zh-Hans, zh-CN, zh-SG, bare "zh" → Simplified
    return "zh-Hans";
  }

  if (primary === "ja") return "ja";
  if (primary === "ko") return "ko";

  return undefined;
}
