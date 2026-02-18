/**
 * Built-in Font Themes
 *
 * Heading + body font pairings using system fonts only — no external font
 * loading required. Each theme sets `--font-heading` and `--font-body`
 * independently to enable classic editorial combinations.
 *
 * Name and description are MessageDescriptor objects for i18n support.
 * Pass them to t() from useLingui() when rendering.
 */

import type { MessageDescriptor } from "@lingui/core";

/**
 * A font theme definition with heading + body pairing.
 */
export interface FontTheme {
  /** Stored in DB settings, e.g. "classic-editorial" */
  id: string;
  /** Display name — pass to t() for translation */
  name: MessageDescriptor;
  /** CSS font-family stack for headings (h1-h6, site logo) */
  headingFontFamily: string;
  /** CSS font-family stack for body text */
  bodyFontFamily: string;
  /** Short description for the picker UI — pass to t() for translation */
  description: MessageDescriptor;
}

/** System sans-serif stack */
const SANS =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Helvetica, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

/**
 * Editorial serif stack
 *
 * ui-serif → New York (macOS 10.15+); Iowan Old Style (macOS/iOS);
 * Charter (macOS); Cambria / Sitka Text (Windows); Georgia (universal)
 */
const EDITORIAL_SERIF =
  'ui-serif, "Iowan Old Style", Charter, "Bitstream Charter", Cambria, "Sitka Text", Georgia, "Songti SC", "Noto Serif CJK SC", "STSong", "SimSun", serif';

/**
 * Classical serif stack
 *
 * Palatino (macOS); Palatino Linotype / Book Antiqua (Windows);
 * Old-style serif with calligraphic warmth
 */
const CLASSICAL_SERIF =
  'Palatino, "Palatino Linotype", "Book Antiqua", "Songti SC", "Noto Serif CJK SC", "STSong", "SimSun", serif';

/**
 * Geometric sans stack
 *
 * Futura (macOS); Century Gothic (Windows); clean geometric proportions
 */
const GEOMETRIC_SANS =
  'Futura, "Century Gothic", "Noto Sans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

export const BUILTIN_FONT_THEMES: FontTheme[] = [
  {
    id: "default",
    name: {
      message: "System Default",
      comment: "@context: Font theme name",
    },
    headingFontFamily: SANS,
    bodyFontFamily: SANS,
    description: {
      message: "Matches your OS native font for consistent reading",
      comment: "@context: Font theme description",
    },
  },
  {
    id: "classic-editorial",
    name: {
      message: "Classic Editorial",
      comment: "@context: Font theme name",
    },
    headingFontFamily: EDITORIAL_SERIF,
    bodyFontFamily: SANS,
    description: {
      message: "Serif headings with clean sans-serif body text",
      comment: "@context: Font theme description",
    },
  },
  {
    id: "modern-editorial",
    name: {
      message: "Modern Editorial",
      comment: "@context: Font theme name",
    },
    headingFontFamily: SANS,
    bodyFontFamily: EDITORIAL_SERIF,
    description: {
      message: "Clean sans-serif headings with elegant serif body text",
      comment: "@context: Font theme description",
    },
  },
  {
    id: "literary",
    name: {
      message: "Literary",
      comment: "@context: Font theme name",
    },
    headingFontFamily: CLASSICAL_SERIF,
    bodyFontFamily: EDITORIAL_SERIF,
    description: {
      message: "Full serif pairing for immersive long-form reading",
      comment: "@context: Font theme description",
    },
  },
  {
    id: "geometric",
    name: {
      message: "Geometric",
      comment: "@context: Font theme name",
    },
    headingFontFamily: GEOMETRIC_SANS,
    bodyFontFamily: SANS,
    description: {
      message: "Bold geometric headings with clean sans-serif body text",
      comment: "@context: Font theme description",
    },
  },
];
