/**
 * Curated list of BCP 47 locale tags surfaced in the language picker.
 *
 * Picker UX is constrained: users select from this list rather than typing
 * arbitrary tags, so the list must cover the realistic long tail of blog
 * audiences. Display names are derived at call time via `Intl.DisplayNames`,
 * coverage is resolved through `resolveCatalogLocale` against the shipped
 * dashboard catalogs.
 *
 * Order is roughly intent: catalog locales first, then world languages, then
 * common regional variants.
 */

import { resolveCatalogLocale, baseLocale } from "./locales.js";
import { SETTINGS_TRANSLATION_COVERAGE } from "./coverage.generated.js";

export const SUPPORTED_LOCALE_TAGS = [
  // Catalog locales — pinned to the top.
  "en",
  "zh-Hans",
  "zh-Hant",

  // Other major world languages.
  "ja",
  "ko",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "ru",
  "ar",
  "hi",
  "bn",
  "ur",
  "tr",
  "vi",
  "th",
  "id",
  "fa",
  "he",

  // European long-tail.
  "nl",
  "pl",
  "sv",
  "da",
  "no",
  "fi",
  "cs",
  "hu",
  "el",
  "ro",
  "uk",

  // Common regional variants worth preselecting. Chinese is offered only via
  // its script subtags (zh-Hans/zh-Hant) above — the region forms (zh-CN/zh-TW/
  // zh-HK) are near-duplicates for `<html lang>` and the W3C recommends script
  // subtags for Chinese, so they are intentionally omitted here. Any stored
  // region tag still resolves and displays correctly via getOrBuildEntry.
  "en-GB",
  "en-US",
  "fr-CA",
  "pt-BR",
  "es-MX",
] as const;

export interface LocaleEntry {
  /** Canonical BCP 47 tag stored in settings. */
  tag: string;
  /** Native display name (e.g. "简体中文", "Suomi"). */
  native: string;
  /** English display name for searching (e.g. "Simplified Chinese"). */
  english: string;
  /**
   * Translation completeness as perceived by a user picking this tag, in
   * [0, 1]. A non-English tag that resolves to the English fallback yields 0
   * because the dashboard would not appear in the user's chosen language.
   */
  coverage: number;
}

let entriesCache: LocaleEntry[] | null = null;

function buildEntry(tag: string): LocaleEntry {
  let native = tag;
  let english = tag;
  try {
    const nativeDn = new Intl.DisplayNames([tag], { type: "language" });
    const fromNative = nativeDn.of(tag);
    if (typeof fromNative === "string" && fromNative.length > 0) {
      native = fromNative;
    }
  } catch {
    // Intl.DisplayNames couldn't parse the tag; keep tag as fallback.
  }
  try {
    const englishDn = new Intl.DisplayNames(["en"], { type: "language" });
    const fromEnglish = englishDn.of(tag);
    if (typeof fromEnglish === "string" && fromEnglish.length > 0) {
      english = fromEnglish;
    }
  } catch {
    // Same fallback.
  }

  return {
    tag,
    native,
    english,
    coverage: getCoverageFor(tag),
  };
}

/**
 * Coverage as seen by a user picking `tag`. Resolves through the catalog
 * fallback chain; tags that fall through to the English base when the user's
 * actual language is not English get 0.
 */
export function getCoverageFor(tag: string): number {
  const catalogLocale = resolveCatalogLocale(tag);
  if (catalogLocale === baseLocale) {
    let userLanguage: string;
    try {
      userLanguage = new Intl.Locale(tag).language;
    } catch {
      // Treat unparseable tags as zero — picker shouldn't surface them anyway.
      return 0;
    }
    if (userLanguage !== baseLocale) return 0;
  }
  return SETTINGS_TRANSLATION_COVERAGE[catalogLocale];
}

/**
 * All curated entries. Built lazily once per process.
 */
export function getSupportedLocaleEntries(): LocaleEntry[] {
  if (entriesCache) return entriesCache;
  entriesCache = SUPPORTED_LOCALE_TAGS.map(buildEntry);
  return entriesCache;
}

/**
 * Pick the curated tag that best matches an `Accept-Language` header.
 *
 * Used to prefill the setup form's content-language field. It only ever
 * suggests: setup renders the result in a visible dropdown the author confirms,
 * so a near miss costs one click rather than a silently wrong `<html lang>`.
 *
 * Matching narrows in three steps — exact tag, then language plus script, then
 * bare language — because `zh-CN` should land on `zh-Hans` rather than falling
 * through to English.
 *
 * @param header - Raw `Accept-Language` header value
 * @returns A tag from the curated list; `baseLocale` when nothing matches
 * @example
 * resolveSupportedLocaleTag("zh-CN,en;q=0.8"); // "zh-Hans"
 * resolveSupportedLocaleTag("pt-BR");          // "pt-BR"
 * resolveSupportedLocaleTag("xx");             // "en"
 */
export function resolveSupportedLocaleTag(
  header: string | undefined | null,
): string {
  if (!header?.trim()) return baseLocale;

  const candidates = header
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().split(";");
      const qParam = params.find((param) =>
        param.trim().toLowerCase().startsWith("q="),
      );
      const q = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1;
      return { tag: tag.trim(), q: Number.isNaN(q) ? 1 : q };
    })
    .filter((entry) => entry.tag && entry.tag !== "*" && entry.q > 0)
    .sort((a, b) => b.q - a.q);

  const supported = getSupportedLocaleEntries();

  for (const { tag } of candidates) {
    let parsed: Intl.Locale;
    try {
      parsed = new Intl.Locale(tag);
    } catch {
      continue;
    }

    const exact = supported.find(
      (entry) => entry.tag.toLowerCase() === parsed.baseName.toLowerCase(),
    );
    if (exact) return exact.tag;

    // `maximize()` fills in the implied script, which is what turns zh-CN into
    // zh-Hans and zh-TW into zh-Hant.
    const maximized = parsed.maximize();
    const withScript = supported.find((entry) => {
      try {
        const entryLocale = new Intl.Locale(entry.tag).maximize();
        return (
          entryLocale.language === maximized.language &&
          entryLocale.script === maximized.script
        );
      } catch {
        return false;
      }
    });
    if (withScript) return withScript.tag;

    const byLanguage = supported.find((entry) => {
      try {
        return new Intl.Locale(entry.tag).language === parsed.language;
      } catch {
        return false;
      }
    });
    if (byLanguage) return byLanguage.tag;
  }

  return baseLocale;
}

/**
 * Find a curated entry by tag, or build one on the fly. Used when the stored
 * setting value is something the picker doesn't list (e.g. a Welsh blogger
 * pre-seeded `cy` via env var).
 */
export function getOrBuildEntry(tag: string): LocaleEntry {
  const trimmed = tag.trim();
  const found = getSupportedLocaleEntries().find((e) => e.tag === trimmed);
  if (found) return found;
  return buildEntry(trimmed);
}
