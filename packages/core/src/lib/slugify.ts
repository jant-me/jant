/**
 * Slug generation from free text.
 *
 * Lives apart from `url.ts` on purpose: `limax` drags the whole `pinyin-pro`
 * dictionary (≈390 KB minified) into any bundle that imports it. Keeping the
 * dictionary behind this single module lets the browser load it lazily via
 * `client/lazy-slugify.ts`, while `url.ts` stays cheap enough for the public
 * bundle. The build guard in `vite.shared.ts` fails the client build if
 * `pinyin-pro` ever lands in an entry chunk again.
 */

import limax from "limax";

import {
  HAN_RE,
  HANGUL_RE,
  KANA_RE,
  hangulToLatin,
  kanaToRomaji,
} from "./translit.js";

const HAN_GLOBAL_RE = /\p{Script=Han}/gu;
const CONTENT_CHAR_RE = /[\p{L}\p{N}]/u;
const ASCII_ALNUM_RE = /[a-zA-Z0-9]/;

/**
 * Minimum fraction of a title's letters/digits the transliteration pipeline
 * must handle for the result to be usable. Below this, too much meaning is
 * lost (e.g. mixed kanji+kana Japanese where the semantic core is kanji, or
 * scripts limax drops entirely) and `slugify` returns "" so callers fall back
 * to their random-ID path instead of shipping a garbled slug.
 */
const SLUG_COVERAGE_THRESHOLD = 0.75;

/** Per-character limax probe cache: does this char transliterate to anything? */
const charCoverageCache = new Map<string, boolean>();

function isCharCovered(char: string): boolean {
  if (ASCII_ALNUM_RE.test(char)) return true;
  let covered = charCoverageCache.get(char);
  if (covered === undefined) {
    covered = limax(char, { tone: false }).length > 0;
    charCoverageCache.set(char, covered);
  }
  return covered;
}

function slugCoverage(text: string, japanese: boolean): number {
  let content = 0;
  let covered = 0;
  for (const char of text) {
    if (!CONTENT_CHAR_RE.test(char)) continue;
    content++;
    if (KANA_RE.test(char) || HANGUL_RE.test(char)) {
      covered++;
    } else if (japanese && HAN_RE.test(char)) {
      // Kanji in a kana-containing title is dropped, never pinyin-read.
    } else if (isCharCovered(char)) {
      covered++;
    }
  }
  return content === 0 ? 0 : covered / content;
}

/**
 * Converts text to a URL-friendly slug.
 *
 * Transliterates i18n text to Latin before slugifying: Korean hangul via
 * Revised Romanization, Japanese kana via Hepburn romaji (both in-house, see
 * `translit.ts`), everything else (Han → pinyin, Cyrillic, accents, …) via
 * limax. When the title contains kana it is treated as Japanese and Han
 * characters are dropped rather than misread as Chinese pinyin; Han without
 * kana is treated as Chinese.
 *
 * Returns `""` when transliteration would lose too much of the title (see
 * `SLUG_COVERAGE_THRESHOLD`) — every caller treats an empty base as "no
 * usable title" and falls back to a random ID, which beats publishing a
 * garbled slug.
 *
 * @param text - The text to convert to a slug
 * @returns The slugified string, or `""` when no usable slug can be derived
 *
 * @example
 * ```ts
 * slugify("Hello World! This is a Test.");
 * // Returns: "hello-world-this-is-a-test"
 *
 * slugify("书评");
 * // Returns: "shu-ping"
 *
 * slugify("안녕하세요 세계");
 * // Returns: "annyeonghaseyo-segye"
 *
 * slugify("ハンバーガー");
 * // Returns: "hanbaga"
 *
 * slugify("日本語のタイトルです");
 * // Returns: "" (kanji carries the meaning and can't be transliterated)
 * ```
 */
export function slugify(text: string): string {
  const japanese = KANA_RE.test(text);
  let pre = text;
  if (japanese) {
    pre = kanaToRomaji(pre.replace(HAN_GLOBAL_RE, " "));
  }
  if (HANGUL_RE.test(pre)) {
    pre = hangulToLatin(pre);
  }
  const base = limax(pre, { tone: false }).replace(/_/g, "-");
  if (!base) return "";
  return slugCoverage(text, japanese) >= SLUG_COVERAGE_THRESHOLD ? base : "";
}
