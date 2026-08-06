/**
 * Dictionary-free transliteration helpers for slug generation.
 *
 * These converters cover the scripts limax handles poorly:
 *
 * - Korean hangul → Revised Romanization (limax strips hangul entirely)
 * - Japanese kana → Hepburn romaji (limax mangles long vowels and digraphs)
 *
 * Both are pure algorithms over Unicode code points — no dictionaries — so
 * they stay small enough for the Workers bundle and the lazy client chunk.
 * Japanese kanji is intentionally out of scope: readings are context-dependent
 * and need a morphological dictionary, which is why `slugify` falls back to a
 * random ID for kanji-heavy Japanese titles instead of guessing.
 */

/** Matches hiragana, katakana, and the chōonpu (ー) long-vowel mark. */
export const KANA_RE = /[ぁ-ゖァ-ヺー]/u;

/** Matches precomposed hangul syllables and compatibility jamo. */
export const HANGUL_RE = /[가-힣ㄱ-ㆎ]/u;

/** Matches Han (CJK ideograph) characters. */
export const HAN_RE = /\p{Script=Han}/u;

// --- Korean: Revised Romanization ---------------------------------------

const HANGUL_SYLLABLE_BASE = 0xac00;
const HANGUL_SYLLABLE_END = 0xd7a3;
const VOWEL_COUNT = 21;
const FINAL_COUNT = 28;

// prettier-ignore
const RR_INITIALS = [
  "g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s",
  "ss", "", "j", "jj", "ch", "k", "t", "p", "h",
];

// prettier-ignore
const RR_VOWELS = [
  "a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa",
  "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i",
];

// Finals use their phonetic (syllable-final) value, e.g. ㅅ → "t".
// prettier-ignore
const RR_FINALS = [
  "", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l",
  "p", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t",
];

// Liaison: when the next syllable starts with the silent initial ㅇ, the
// final consonant is pronounced as that syllable's initial instead
// (한국어 → han-gu-geo, not han-guk-eo). Each entry is
// [what remains as the final, what carries over as the next initial].
// ㅎ is dropped when carried (좋아 → joa); final ㅇ (ng) never carries.
// prettier-ignore
const RR_LIAISON: readonly (readonly [string, string])[] = [
  ["", ""], ["", "g"], ["", "kk"], ["k", "s"], ["", "n"], ["n", "j"],
  ["n", ""], ["", "d"], ["", "r"], ["l", "g"], ["l", "m"], ["l", "b"],
  ["l", "s"], ["l", "t"], ["l", "p"], ["l", ""], ["", "m"], ["", "b"],
  ["p", "s"], ["", "s"], ["", "ss"], ["ng", ""], ["", "j"], ["", "ch"],
  ["", "k"], ["", "t"], ["", "p"], ["", ""],
];

// Standalone compatibility jamo (ㅋㅋㅋ, ㅠㅠ) — common in informal titles.
const COMPAT_JAMO: Record<string, string> = {
  ㄱ: "g",
  ㄲ: "kk",
  ㄴ: "n",
  ㄷ: "d",
  ㄸ: "tt",
  ㄹ: "r",
  ㅁ: "m",
  ㅂ: "b",
  ㅃ: "pp",
  ㅅ: "s",
  ㅆ: "ss",
  ㅇ: "ng",
  ㅈ: "j",
  ㅉ: "jj",
  ㅊ: "ch",
  ㅋ: "k",
  ㅌ: "t",
  ㅍ: "p",
  ㅎ: "h",
  ㅏ: "a",
  ㅐ: "ae",
  ㅑ: "ya",
  ㅒ: "yae",
  ㅓ: "eo",
  ㅔ: "e",
  ㅕ: "yeo",
  ㅖ: "ye",
  ㅗ: "o",
  ㅘ: "wa",
  ㅙ: "wae",
  ㅚ: "oe",
  ㅛ: "yo",
  ㅜ: "u",
  ㅝ: "wo",
  ㅞ: "we",
  ㅟ: "wi",
  ㅠ: "yu",
  ㅡ: "eu",
  ㅢ: "ui",
  ㅣ: "i",
};

interface HangulSyllable {
  initial: number;
  vowel: number;
  final: number;
}

function decomposeHangul(codePoint: number): HangulSyllable | null {
  if (codePoint < HANGUL_SYLLABLE_BASE || codePoint > HANGUL_SYLLABLE_END) {
    return null;
  }
  const index = codePoint - HANGUL_SYLLABLE_BASE;
  return {
    initial: Math.floor(index / (VOWEL_COUNT * FINAL_COUNT)),
    vowel: Math.floor(index / FINAL_COUNT) % VOWEL_COUNT,
    final: index % FINAL_COUNT,
  };
}

/**
 * Transliterates Korean hangul to Latin using Revised Romanization.
 *
 * Handles precomposed syllables with basic liaison (a final consonant before
 * a silent-ㅇ syllable carries over as its initial) and standalone
 * compatibility jamo. Assimilation sound rules (e.g. 종로 → "Jongno") are
 * intentionally skipped — slugs need recognizable output, not phonetic
 * perfection. Non-hangul characters pass through unchanged.
 *
 * @param text - Input text, possibly mixing hangul with other characters
 * @returns Text with hangul replaced by its romanization
 *
 * @example
 * ```ts
 * hangulToLatin("안녕하세요"); // "annyeonghaseyo"
 * hangulToLatin("한국어");     // "hangugeo" (liaison)
 * hangulToLatin("개발 일지");  // "gaebal ilji"
 * ```
 */
export function hangulToLatin(text: string): string {
  const chars = [...text];
  let out = "";
  let carried: string | null = null;

  for (const [i, char] of chars.entries()) {
    const syllable = decomposeHangul(char.codePointAt(0) ?? 0);
    if (!syllable) {
      carried = null;
      out += COMPAT_JAMO[char] ?? char;
      continue;
    }

    const initial = carried ?? RR_INITIALS[syllable.initial] ?? "";
    carried = null;
    const next = decomposeHangul(chars[i + 1]?.codePointAt(0) ?? 0);
    let final = RR_FINALS[syllable.final] ?? "";
    if (syllable.final !== 0 && next && RR_INITIALS[next.initial] === "") {
      const [remains, carry] = RR_LIAISON[syllable.final] ?? ["", ""];
      final = remains;
      carried = carry;
    }
    out += initial + (RR_VOWELS[syllable.vowel] ?? "") + final;
  }
  return out;
}

// --- Japanese: Hepburn romaji -------------------------------------------

// prettier-ignore
const KANA_BASE: Record<string, string> = {
  あ: "a", い: "i", う: "u", え: "e", お: "o",
  か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
  は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
  わ: "wa", ゐ: "i", ゑ: "e", を: "o", ん: "n",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
  ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
  ゔ: "vu",
  ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o",
  ゃ: "ya", ゅ: "yu", ょ: "yo", ゎ: "wa",
};

// Digraphs and extended katakana combos (ファ, ティ, チェ, …). Keys are the
// hiragana-normalized two-character sequences.
// prettier-ignore
const KANA_COMBO: Record<string, string> = {
  きゃ: "kya", きゅ: "kyu", きょ: "kyo",
  ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo",
  しゃ: "sha", しゅ: "shu", しょ: "sho",
  じゃ: "ja", じゅ: "ju", じょ: "jo",
  ちゃ: "cha", ちゅ: "chu", ちょ: "cho",
  ぢゃ: "ja", ぢゅ: "ju", ぢょ: "jo",
  にゃ: "nya", にゅ: "nyu", にょ: "nyo",
  ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo",
  びゃ: "bya", びゅ: "byu", びょ: "byo",
  ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo",
  みゃ: "mya", みゅ: "myu", みょ: "myo",
  りゃ: "rya", りゅ: "ryu", りょ: "ryo",
  ふぁ: "fa", ふぃ: "fi", ふぇ: "fe", ふぉ: "fo",
  てぃ: "ti", でぃ: "di", とぅ: "tu", どぅ: "du",
  うぃ: "wi", うぇ: "we", うぉ: "wo",
  ゔぁ: "va", ゔぃ: "vi", ゔぇ: "ve", ゔぉ: "vo",
  ちぇ: "che", しぇ: "she", じぇ: "je",
  つぁ: "tsa", つぃ: "tsi", つぇ: "tse", つぉ: "tso",
  いぇ: "ye",
};

const KATAKANA_START = 0x30a1;
const KATAKANA_END = 0x30f6;
const KATAKANA_TO_HIRAGANA_SHIFT = 0x60;
const SOKUON = "っ";
const CHOONPU = "ー";

function normalizeToHiragana(char: string): string {
  const codePoint = char.codePointAt(0) ?? 0;
  if (codePoint >= KATAKANA_START && codePoint <= KATAKANA_END) {
    return String.fromCodePoint(codePoint - KATAKANA_TO_HIRAGANA_SHIFT);
  }
  return char;
}

/**
 * Transliterates Japanese kana to macron-less Hepburn romaji.
 *
 * Handles hiragana and katakana, digraphs (きゃ → "kya"), extended katakana
 * loan combos (ファ → "fa"), sokuon gemination (まっちゃ → "matcha"), and
 * drops the chōonpu long-vowel mark (ハンバーガー → "hanbaga"), matching how
 * macrons are conventionally stripped in URLs. Kanji and other non-kana
 * characters pass through unchanged.
 *
 * @param text - Input text, possibly mixing kana with other characters
 * @returns Text with kana replaced by romaji
 *
 * @example
 * ```ts
 * kanaToRomaji("カタカナタイトル"); // "katakanataitoru"
 * kanaToRomaji("ハンバーガー");     // "hanbaga"
 * kanaToRomaji("まっちゃ");         // "matcha"
 * ```
 */
export function kanaToRomaji(text: string): string {
  const chars = [...text].map(normalizeToHiragana);
  let out = "";
  let geminate = false;

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i] ?? "";
    if (char === SOKUON) {
      geminate = true;
      continue;
    }
    if (char === CHOONPU) {
      geminate = false;
      continue;
    }

    const combo = KANA_COMBO[char + (chars[i + 1] ?? "")];
    const romaji = combo ?? KANA_BASE[char];
    if (combo) i++;
    if (romaji === undefined) {
      geminate = false;
      out += char;
      continue;
    }
    if (geminate) {
      geminate = false;
      if (/^[^aeiou]/.test(romaji)) {
        out += romaji.startsWith("ch") ? "t" : (romaji[0] ?? "");
      }
    }
    out += romaji;
  }
  return out;
}
