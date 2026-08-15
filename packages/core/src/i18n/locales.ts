/**
 * Locale configuration
 *
 * Two related-but-distinct concepts:
 *
 * - `Locale` (catalog locale): the small enum of locales for which Jant ships
 *   a translation catalog. Used to pick which dashboard translation to render.
 * - Content language: any syntactically valid BCP 47 language tag, used for
 *   `<html lang>`, RSS feed `<language>`, and other metadata. Independent of
 *   whether Jant has a dashboard translation for it — a Finnish blogger should
 *   be able to set `fi` for correct content metadata even though the dashboard
 *   itself falls back to English.
 *
 * The dashboard UI surfaces catalog locales as suggestions, but the underlying
 * setting accepts any BCP 47 tag.
 */

export const locales = ["en", "zh-Hans", "zh-Hant"] as const;
export type Locale = (typeof locales)[number];
export const baseLocale: Locale = "en";

/**
 * Check if `value` is a Locale Jant has a dashboard translation catalog for.
 */
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && locales.includes(value as Locale);
}

/**
 * Check if `value` is a syntactically valid BCP 47 language tag.
 *
 * Accepts any tag the platform's `Intl.Locale` parses, including ones Jant
 * has no dashboard translation for (e.g. `fi`, `ja`, `de`, `fr-CA`).
 */
export function isValidContentLanguage(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    new Intl.Locale(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize a BCP 47 tag to canonical form (`zh-cn` → `zh-CN`,
 * `ZH-HANS` → `zh-Hans`). Returns `value` unchanged if it cannot be parsed.
 */
export function normalizeContentLanguage(value: string): string {
  const trimmed = value.trim();
  try {
    return new Intl.Locale(trimmed).baseName;
  } catch {
    return trimmed;
  }
}

/**
 * URL prefix form of a content language tag.
 *
 * A purely mechanical lowercase of the canonical tag, so it never needs storing
 * separately. Canonical tags are one-to-one with their lowercase forms, so two
 * different languages can never collide on one prefix.
 *
 * @param tag - Canonical BCP 47 tag
 * @returns Lowercase prefix used in `/{prefix}/...` URLs
 * @example
 * toLanguagePrefix("zh-Hant"); // "zh-hant"
 */
export function toLanguagePrefix(tag: string): string {
  return tag.toLowerCase();
}

/**
 * Parse the stored `ADDITIONAL_LANGUAGES` value into canonical tags.
 *
 * Tolerant by design — it reads a settings row that predates any given
 * validation rule. Blank and unparseable entries are dropped, tags are
 * canonicalized, duplicates collapse, and order is preserved because it is the
 * order the language switcher renders in.
 *
 * @param value - Raw comma-separated settings value
 * @returns Canonical tags, deduplicated, in the stored order
 * @example
 * parseLanguageList(" en , ZH-hant ,en "); // ["en", "zh-Hant"]
 */
export function parseLanguageList(value: string | null | undefined): string[] {
  if (!value) return [];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of value.split(",")) {
    const trimmed = token.trim();
    if (!trimmed || !isValidContentLanguage(trimmed)) continue;
    const tag = normalizeContentLanguage(trimmed);
    if (seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }
  return result;
}

/**
 * Serialize canonical tags back into the stored settings form.
 *
 * @param tags - Canonical BCP 47 tags in switcher order
 * @returns Comma-separated value for `ADDITIONAL_LANGUAGES`
 * @example
 * formatLanguageList(["en", "ja"]); // "en,ja"
 */
export function formatLanguageList(tags: readonly string[]): string {
  return tags.join(",");
}

/**
 * Resolve a content language tag to the catalog locale that should drive the
 * dashboard UI for that user.
 *
 * Fallback chain: exact match → language family match (`zh-CN` → `zh-Hans`,
 * `zh-TW` → `zh-Hant`) → `baseLocale`.
 */
export function resolveCatalogLocale(tag: string): Locale {
  const trimmed = tag.trim();
  if (!trimmed) return baseLocale;

  let parsed: Intl.Locale;
  try {
    parsed = new Intl.Locale(trimmed);
  } catch {
    return baseLocale;
  }

  // Exact match against a shipped catalog
  if (isLocale(parsed.baseName)) return parsed.baseName;

  // Language-family fallback
  if (parsed.language === "zh") {
    const region = parsed.region;
    if (
      parsed.script === "Hant" ||
      region === "TW" ||
      region === "HK" ||
      region === "MO"
    ) {
      return "zh-Hant";
    }
    return "zh-Hans";
  }

  return baseLocale;
}

/**
 * Decide whether first-run setup should pin the dashboard's own locale.
 *
 * The dashboard follows the content language unless `DASHBOARD_LANGUAGE` says
 * otherwise, so setup's only job is to notice when the browser knows something
 * following would miss. It knows something in exactly one case: it names a
 * catalog that is neither the fallback nor the one the content language
 * already resolves to.
 *
 * That covers both directions of the mismatch this exists for. Someone writing
 * an English blog from a Chinese browser gets a Chinese dashboard, because the
 * browser is the only thing that said "Chinese". Someone writing a Chinese blog
 * from an English browser keeps a Chinese dashboard, because `en` is what every
 * unconfigured browser reports and is no evidence against the language they
 * just chose by hand.
 *
 * @param contentLanguage - The BCP 47 tag the author chose to publish in
 * @param browserLanguage - What the browser reported, if anything
 * @returns The catalog to pin, or `null` to follow the content language
 * @example
 * resolveFirstRunDashboardLocale("zh-Hans", "en"); // null — follow the content
 * resolveFirstRunDashboardLocale("en", "zh-CN"); // "zh-Hans"
 */
export function resolveFirstRunDashboardLocale(
  contentLanguage: string,
  browserLanguage?: string | null,
): Locale | null {
  const browser = browserLanguage?.trim();
  if (!browser) return null;

  const browserCatalog = resolveCatalogLocale(browser);
  if (browserCatalog === baseLocale) return null;
  if (browserCatalog === resolveCatalogLocale(contentLanguage)) return null;

  return browserCatalog;
}
