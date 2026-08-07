/**
 * Content language detection.
 *
 * The detector is a suggestion engine, so these tests care about two things:
 * that it is right on the cases it claims to be reliable on (Hangul, kana,
 * Simplified vs Traditional over a sentence), and that it refuses rather than
 * guesses everywhere else — a wrong confident answer costs the author an edit
 * they may never notice they need.
 */

import { describe, expect, it } from "vitest";
import {
  detectContentLanguage,
  detectScript,
  suggestPostLanguage,
} from "../lang-detect.js";

describe("detectScript", () => {
  it("reads Hangul as Korean", () => {
    expect(detectScript("안녕하세요, 반갑습니다")).toBe("ko");
  });

  it("reads Korean mixed with hanja as Korean", () => {
    // Korean borrows Han characters but never kana, so Hangul settles it.
    expect(detectScript("韓國語 문법 정리")).toBe("ko");
  });

  it("reads kana as Japanese", () => {
    expect(detectScript("これはテストです")).toBe("ja");
    expect(detectScript("日本語の文章を書く")).toBe("ja");
  });

  it("reads Simplified-only characters as Simplified", () => {
    expect(detectScript("国学说这时会对后")).toBe("zh-Hans");
  });

  it("reads Traditional-only characters as Traditional", () => {
    expect(detectScript("國學說這時會對後")).toBe("zh-Hant");
  });

  it("decides a mixed passage by majority", () => {
    // A Traditional post that quotes a short Simplified phrase.
    expect(detectScript("這篇文章談的是國學說法，裡頭引了一句「这个」")).toBe(
      "zh-Hant",
    );
  });

  it("refuses when the two sides tie", () => {
    // Three distinctive characters each. Guessing here would be a coin toss.
    expect(detectScript("這個說这个说")).toBeNull();
  });

  it("refuses when the Han characters are written the same in both", () => {
    // "我今天很好" is identical in Simplified and Traditional.
    expect(detectScript("我今天很好")).toBeNull();
  });

  it("reads Latin script as Latin, accents included", () => {
    expect(detectScript("Hello there")).toBe("latin");
    expect(detectScript("Café crème à Paris")).toBe("latin");
  });

  it("refuses text with no letters at all", () => {
    expect(detectScript("123 — !!! 🙂")).toBeNull();
    expect(detectScript("")).toBeNull();
  });
});

describe("detectContentLanguage", () => {
  const zhEn = { languages: ["zh-Hans", "en"], fallback: "zh-Hans" };

  it("picks the language matching the detected script", () => {
    expect(detectContentLanguage("这是中文", zhEn)).toBe("zh-Hans");
    expect(detectContentLanguage("This is English", zhEn)).toBe("en");
  });

  it("matches Simplified and Traditional as distinct languages", () => {
    const both = {
      languages: ["zh-Hans", "zh-Hant", "en"],
      fallback: "zh-Hans",
    };

    expect(detectContentLanguage("國學說這時會對後", both)).toBe("zh-Hant");
    expect(detectContentLanguage("国学说这时会对后", both)).toBe("zh-Hans");
  });

  it("matches a language tag that only implies its script", () => {
    // The site configured zh-TW, not zh-Hant.
    expect(
      detectContentLanguage("國學說這時", {
        languages: ["en", "zh-TW"],
        fallback: "en",
      }),
    ).toBe("zh-TW");
  });

  it("will not choose between two non-CJK languages", () => {
    // The Latin alphabet does not distinguish English from French.
    expect(
      detectContentLanguage("Bonjour tout le monde", {
        languages: ["en", "fr", "ja"],
        fallback: "en",
      }),
    ).toBe("en");
  });

  it("falls back when the site does not publish the detected script", () => {
    expect(
      detectContentLanguage("これは日本語です", {
        languages: ["zh-Hans", "en"],
        fallback: "zh-Hans",
      }),
    ).toBe("zh-Hans");
  });

  it("never returns a language outside the configured set", () => {
    const samples = [
      "안녕하세요",
      "これはテスト",
      "國學說這時",
      "国学说这时",
      "Hello",
      "12345",
      "",
    ];

    for (const sample of samples) {
      expect(zhEn.languages, sample).toContain(
        detectContentLanguage(sample, zhEn),
      );
    }
  });
});

describe("suggestPostLanguage", () => {
  const site = { languages: ["zh-Hans", "en"], primary: "zh-Hans" };

  it("reads the language out of the text", () => {
    expect(suggestPostLanguage({ ...site, text: "Hello there" })).toBe("en");
    expect(suggestPostLanguage({ ...site, text: "这是中文" })).toBe("zh-Hans");
  });

  it("falls back to the primary language for empty text", () => {
    expect(suggestPostLanguage({ ...site, text: "   " })).toBe("zh-Hans");
    expect(suggestPostLanguage(site)).toBe("zh-Hans");
  });

  it("returns null on a site that is not multilingual", () => {
    // Nothing is stamped before the author turns the feature on.
    expect(
      suggestPostLanguage({
        languages: [],
        primary: "zh-Hans",
        text: "Hello there",
      }),
    ).toBeNull();
  });
});
