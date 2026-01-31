/**
 * i18n Runtime using @lingui/core
 *
 * Usage:
 *   import { t } from "@/i18n";
 *
 *   // With comment (recommended)
 *   t({ message: "Hello", comment: "@context: Greeting on homepage" })
 *
 *   // With interpolation
 *   t({ message: "Welcome, {name}!", comment: "@context: User welcome message", values: { name } })
 */

import { i18n } from "@lingui/core";
import { locales, baseLocale, isLocale, type Locale } from "./locales.js";

export { locales, baseLocale, isLocale, type Locale };

let currentLocale: Locale = baseLocale;

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
  i18n.activate(locale);
}

/**
 * Base translation options (plain text)
 */
export interface TranslateOptions {
  /** The message to translate (use {name} for interpolation, <0>text</0> for rich text) */
  message: string;
  /** Context comment for translators (required for clarity) */
  comment: string;
  /** Values for interpolation placeholders like {name} */
  values?: Record<string, unknown>;
}

/**
 * Rich text translation options (with JSX components)
 */
export interface RichTranslateOptions extends TranslateOptions {
  /**
   * Component map for rich text placeholders <0>...</0>.
   * When provided, returns JSX array instead of string.
   */
  components: Record<number, (text: string) => unknown>;
}

/**
 * Translate a message (plain text, returns string)
 */
export function t(options: TranslateOptions): string;

/**
 * Translate a message with rich text components (returns JSX array)
 */
export function t(options: RichTranslateOptions): unknown[];

/**
 * Translate a message with required comment for context.
 * Supports both plain text and rich text with JSX components.
 *
 * @example Plain text
 * t({ message: "Hello", comment: "@context: Greeting" })
 *
 * @example With interpolation
 * t({ message: "Welcome, {name}!", comment: "@context: User welcome", values: { name } })
 *
 * @example Rich text with components
 * t({
 *   message: "Read our <0>Terms</0>",
 *   comment: "@context: Terms link",
 *   components: { 0: (text) => <a href="/terms">{text}</a> }
 * })
 */
export function t(options: TranslateOptions | RichTranslateOptions): string | unknown[] {
  const { message, values } = options;
  const components = "components" in options ? options.components : undefined;
  // comment is used at extraction time, not runtime
  const translated = i18n._(message, values);

  // If no components, return plain string
  if (!components) {
    return translated;
  }

  // Parse <0>...</0>, <1>...</1>, etc. patterns for rich text
  const result: unknown[] = [];
  let lastIndex = 0;
  const regex = /<(\d+)>([^<]*)<\/\1>/g;
  let match;

  while ((match = regex.exec(translated)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      result.push(translated.slice(lastIndex, match.index));
    }

    const componentIndex = parseInt(match[1]!, 10);
    const innerText = match[2]!;
    const component = components[componentIndex];

    if (component) {
      result.push(component(innerText));
    } else {
      // Fallback if component not found
      result.push(innerText);
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last match
  if (lastIndex < translated.length) {
    result.push(translated.slice(lastIndex));
  }

  return result;
}

export { i18n };
