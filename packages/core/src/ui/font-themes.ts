/**
 * Built-in Font Themes
 *
 * Heading + body pairings plus typography rhythm overrides. Each theme sets
 * `--font-heading` and `--font-body`, and can optionally tune additional
 * typography tokens so the overall feel is more distinct.
 *
 * Name and description are MessageDescriptor objects for i18n support.
 * Pass them to `i18n._(...)` when rendering.
 */

import type { MessageDescriptor } from "@lingui/core";
import {
  getCjkFontFromLanguageTag,
  type CjkFontProfile,
} from "../i18n/detect.js";

/**
 * A font theme definition with heading + body pairing.
 */
export interface FontTheme {
  /** Stored in DB settings, e.g. "classic-editorial" */
  id: string;
  /** Display name — pass to `i18n._(...)` for translation */
  name: MessageDescriptor;
  /** CSS font-family stack for headings (h1-h6, site logo) */
  headingFontFamily: string;
  /** CSS font-family stack for body text */
  bodyFontFamily: string;
  /** Optional typography token overrides applied with the theme */
  cssVariables?: Record<string, string>;
  /** Short description for the picker UI — pass to `i18n._(...)` for translation */
  description: MessageDescriptor;
}

const HANS_CJK_SERIF_FALLBACK =
  '"Songti SC", STSong, SimSun, "Noto Serif SC", "Noto Serif CJK SC", "Songti TC", PMingLiU, MingLiU, "Noto Serif TC", "Noto Serif CJK TC"';
const HANS_CJK_SANS_FALLBACK =
  '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Noto Sans CJK SC", "PingFang TC", "Hiragino Sans CNS", "Microsoft JhengHei", "Noto Sans TC", "Noto Sans CJK TC"';
const HANT_CJK_SERIF_FALLBACK =
  '"Songti TC", PMingLiU, MingLiU, "Noto Serif TC", "Noto Serif CJK TC", "Songti SC", STSong, SimSun, "Noto Serif SC", "Noto Serif CJK SC"';
const HANT_CJK_SANS_FALLBACK =
  '"PingFang TC", "Hiragino Sans CNS", "Microsoft JhengHei", "Noto Sans TC", "Noto Sans CJK TC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Noto Sans CJK SC"';
const JP_CJK_SERIF_FALLBACK =
  '"Hiragino Mincho ProN", "Hiragino Mincho Pro", "Yu Mincho", YuMincho, "Noto Serif JP", "Noto Serif CJK JP", "MS PMincho", "MS Mincho"';
const JP_CJK_SANS_FALLBACK =
  '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", YuGothic, "Noto Sans JP", "Noto Sans CJK JP", Meiryo';
const KO_CJK_SERIF_FALLBACK =
  'Batang, "Noto Serif KR", "Noto Serif CJK KR", NanumMyeongjo';
const KO_CJK_SANS_FALLBACK =
  '"Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", "Malgun Gothic"';
/*
 * Default stacks for a page whose language names no CJK profile.
 *
 * A font stack cannot express "no opinion": every Latin family in a theme stack
 * lacks Han coverage, and `ui-serif` / `serif` resolve to Times or New York,
 * which lack it too — so a placeholder name leaves Chinese, Japanese and Korean
 * text to the OS last-resort font (PingFang SC on Apple platforms), rendering a
 * serif page in sans. The default therefore has to be real. Simplified comes
 * first because it is the most common CJK content here; a page that knows its
 * language gets the profile stacks above instead, which put the right glyph
 * shapes first.
 */
const DEFAULT_CJK_SERIF_FALLBACK = `${HANS_CJK_SERIF_FALLBACK}, ${JP_CJK_SERIF_FALLBACK}, ${KO_CJK_SERIF_FALLBACK}`;
const DEFAULT_CJK_SANS_FALLBACK = `${HANS_CJK_SANS_FALLBACK}, ${JP_CJK_SANS_FALLBACK}, ${KO_CJK_SANS_FALLBACK}`;
const CJK_SERIF_FALLBACK_VAR = "var(--font-cjk-serif-fallback)";
const CJK_SANS_FALLBACK_VAR = "var(--font-cjk-sans-fallback)";

/** System sans-serif stack */
const SANS = `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Helvetica, Arial, ${CJK_SANS_FALLBACK_VAR}, sans-serif`;

/** Humanist sans stack with self-hosted Latin and system CJK fallback */
const HUMANIST_SANS = `"Source Sans 3 Variable", "Source Sans 3", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Helvetica, Arial, ${CJK_SANS_FALLBACK_VAR}, sans-serif`;

/** Narrower newsroom sans for headlines and labels */
const NEWSROOM_SANS = `"News Cycle", "Franklin Gothic Medium", "Arial Narrow", "Helvetica Neue", Helvetica, Arial, ${CJK_SANS_FALLBACK_VAR}, sans-serif`;

/**
 * Editorial serif stack
 *
 * ui-serif → New York (macOS 10.15+); Iowan Old Style (macOS/iOS);
 * Charter (macOS); Cambria / Sitka Text (Windows); Georgia (universal)
 */
const EDITORIAL_SERIF = `"New York Small", "New York", "Iowan Old Style", Charter, "Bitstream Charter", "Source Serif 4", Cambria, "Sitka Text", Georgia, ${CJK_SERIF_FALLBACK_VAR}, ui-serif, serif`;

/** Refined newsroom serif with self-hosted Latin text */
const NEWSROOM_SERIF = `"Newsreader Variable", Newsreader, "New York Small", "New York", "Iowan Old Style", Charter, "Bitstream Charter", Cambria, "Sitka Text", Georgia, ${CJK_SERIF_FALLBACK_VAR}, ui-serif, serif`;

/** Library serif with self-hosted Latin text and CJK serif fallback */
const LITERARY_SERIF = `"Literata Variable", Literata, Palatino, "Palatino Linotype", "Book Antiqua", "Source Serif 4", ${CJK_SERIF_FALLBACK_VAR}, ui-serif, serif`;

/**
 * Tufte serif stack
 *
 * Palatino-based old-style serif — closest system match to ET Book.
 * ET Book derives from Bembo; Palatino shares the old-style proportions
 * and is pre-installed on macOS, iOS, and Windows.
 */
const TUFTE_SERIF = `et-book, Palatino, "Palatino Linotype", "Palatino LT STD", "Book Antiqua", "Source Serif 4", ${CJK_SERIF_FALLBACK_VAR}, ui-serif, serif`;

/**
 * Geometric sans stack
 *
 * Futura (macOS); Century Gothic (Windows); clean geometric proportions
 */
const GEOMETRIC_SANS = `"Avenir Next", Avenir, Futura, "Century Gothic", Montserrat, "Noto Sans", ${CJK_SANS_FALLBACK_VAR}, sans-serif`;

/**
 * Resolve all CSS variables a font theme contributes.
 *
 * @param theme - Font theme definition
 * @returns CSS variable map for theme injection or preview rendering
 *
 * @example
 * ```typescript
 * const vars = getFontThemeCssVariables(BUILTIN_FONT_THEMES[0]);
 * // => { "--font-heading": "...", "--font-body": "..." }
 * ```
 */
export function getFontThemeCssVariables(
  theme: FontTheme,
): Record<string, string> {
  return {
    "--font-body": theme.bodyFontFamily,
    "--font-heading": theme.headingFontFamily,
    ...(theme.cssVariables ?? {}),
  };
}

/**
 * Resolve the CJK font profile for a content language.
 *
 * Purely derived from the language — Simplified, Traditional, Japanese and
 * Korean want different Han glyph shapes, and the language tag is the only
 * thing that knows which. The page passes the language it is actually
 * rendering: a post's own language on a post page, the view language on a
 * language-filtered list, the site language otherwise.
 *
 * @param language - BCP 47 content language tag
 * @returns Resolved CJK font profile, or `undefined` to keep the token default
 * @example
 * resolveCjkFontProfile("zh-TW") // "zh-Hant"
 * resolveCjkFontProfile("en")    // undefined
 */
export function resolveCjkFontProfile(
  language?: string,
): CjkFontProfile | undefined {
  return language ? getCjkFontFromLanguageTag(language) : undefined;
}

/**
 * Build serif and sans fallback variables for the resolved language profile.
 *
 * Empty for a language with no profile: `tokens.css` already carries a real
 * script-neutral stack in both variables, so there is nothing to override.
 *
 * @param language - BCP 47 content language tag
 * @returns CSS variables consumed by every font theme, empty when the token
 *   defaults already apply
 * @example
 * getCjkFontCssVariables("zh-Hans")
 * // => { "--font-cjk-serif-fallback": '"Songti SC", ...', ... }
 */
export function getCjkFontCssVariables(
  language?: string,
): Record<string, string> {
  switch (resolveCjkFontProfile(language)) {
    case "zh-Hans":
      return {
        "--font-cjk-serif-fallback": HANS_CJK_SERIF_FALLBACK,
        "--font-cjk-sans-fallback": HANS_CJK_SANS_FALLBACK,
      };
    case "zh-Hant":
      return {
        "--font-cjk-serif-fallback": HANT_CJK_SERIF_FALLBACK,
        "--font-cjk-sans-fallback": HANT_CJK_SANS_FALLBACK,
      };
    case "ja":
      return {
        "--font-cjk-serif-fallback": JP_CJK_SERIF_FALLBACK,
        "--font-cjk-sans-fallback": JP_CJK_SANS_FALLBACK,
      };
    case "ko":
      return {
        "--font-cjk-serif-fallback": KO_CJK_SERIF_FALLBACK,
        "--font-cjk-sans-fallback": KO_CJK_SANS_FALLBACK,
      };
    default:
      return {};
  }
}

/** The `--font-cjk-serif-fallback` value `tokens.css` ships as its default. */
export const DEFAULT_FONT_CJK_SERIF_FALLBACK = DEFAULT_CJK_SERIF_FALLBACK;
/** The `--font-cjk-sans-fallback` value `tokens.css` ships as its default. */
export const DEFAULT_FONT_CJK_SANS_FALLBACK = DEFAULT_CJK_SANS_FALLBACK;

export const BUILTIN_FONT_THEMES: FontTheme[] = [
  {
    id: "classic",
    name: {
      id: "Classic",
      message: "Classic",
      comment: "@context: Font theme name",
    },
    headingFontFamily: EDITORIAL_SERIF,
    bodyFontFamily: SANS,
    cssVariables: {
      // Echo the serif heading voice in blockquotes so pull-quotes feel
      // literary alongside the sans body copy. Also restores a type-level
      // distinction for CJK, where italic is disabled.
      "--font-blockquote": EDITORIAL_SERIF,
    },
    description: {
      id: "Warmer serif titles over plainspoken sans body copy",
      message: "Warmer serif titles over plainspoken sans body copy",
      comment: "@context: Font theme description",
    },
  },

  {
    id: "tufte",
    name: {
      id: "Tufte",
      message: "Tufte",
      comment: "@context: Font theme name",
    },
    headingFontFamily: TUFTE_SERIF,
    bodyFontFamily: TUFTE_SERIF,
    cssVariables: {},
    description: {
      id: "Palatino-based old-style serif matching Tufte CSS proportions",
      message: "Palatino-based old-style serif matching Tufte CSS proportions",
      comment: "@context: Font theme description",
    },
  },

  {
    id: "system-sans",
    name: {
      id: "Clean",
      message: "Clean",
      comment: "@context: Font theme name",
    },
    headingFontFamily: SANS,
    bodyFontFamily: SANS,
    cssVariables: {},
    description: {
      id: "Neutral, compact, and close to the platform default",
      message: "Neutral, compact, and close to the platform default",
      comment: "@context: Font theme description",
    },
  },
  {
    id: "humanist-sans",
    name: {
      id: "Friendly",
      message: "Friendly",
      comment: "@context: Font theme name",
    },
    headingFontFamily: HUMANIST_SANS,
    bodyFontFamily: HUMANIST_SANS,
    cssVariables: {},
    description: {
      id: "Open, readable sans with softer shapes and steadier rhythm",
      message: "Open, readable sans with softer shapes and steadier rhythm",
      comment: "@context: Font theme description",
    },
  },
  {
    id: "modern-editorial",
    name: {
      id: "Editorial",
      message: "Editorial",
      comment: "@context: Font theme name",
    },
    headingFontFamily: NEWSROOM_SANS,
    bodyFontFamily: NEWSROOM_SERIF,
    cssVariables: {},
    description: {
      id: "News-cycle headlines over calmer Newsreader body text",
      message: "News-cycle headlines over calmer Newsreader body text",
      comment: "@context: Font theme description",
    },
  },
  {
    id: "literary",
    name: {
      id: "Bookish",
      message: "Bookish",
      comment: "@context: Font theme name",
    },
    headingFontFamily: LITERARY_SERIF,
    bodyFontFamily: LITERARY_SERIF,
    cssVariables: {},
    description: {
      id: "Literata-driven all-serif setting for essays, notes, and quotations",
      message:
        "Literata-driven all-serif setting for essays, notes, and quotations",
      comment: "@context: Font theme description",
    },
  },
  {
    id: "geometric",
    name: {
      id: "Bold",
      message: "Bold",
      comment: "@context: Font theme name",
    },
    headingFontFamily: GEOMETRIC_SANS,
    bodyFontFamily: SANS,
    cssVariables: {
      "--type-label-weight": "var(--fw-semibold)",
      "--type-label-tracking": "0.16em",
    },
    description: {
      id: "High-contrast sans rhythm with tighter titles and louder labels",
      message:
        "High-contrast sans rhythm with tighter titles and louder labels",
      comment: "@context: Font theme description",
    },
  },
];
