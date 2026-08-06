import { describe, it, expect } from "vitest";
import { hangulToLatin, kanaToRomaji } from "../translit.js";

describe("hangulToLatin", () => {
  it("romanizes basic syllables", () => {
    expect(hangulToLatin("안녕하세요")).toBe("annyeonghaseyo");
  });

  it("applies liaison before silent-ㅇ syllables", () => {
    expect(hangulToLatin("한국어")).toBe("hangugeo");
    expect(hangulToLatin("일지")).toBe("ilji");
  });

  it("drops carried ㅎ in liaison", () => {
    expect(hangulToLatin("좋아")).toBe("joa");
  });

  it("splits compound finals in liaison", () => {
    expect(hangulToLatin("읽어")).toBe("ilgeo");
    expect(hangulToLatin("값이")).toBe("gapsi");
  });

  it("keeps final ㅇ as ng before vowels", () => {
    expect(hangulToLatin("강아지")).toBe("gangaji");
  });

  it("uses phonetic finals", () => {
    expect(hangulToLatin("옷")).toBe("ot");
    expect(hangulToLatin("부엌")).toBe("bueok");
  });

  it("preserves spaces and non-hangul characters", () => {
    expect(hangulToLatin("개발 일지 3일차")).toBe("gaebal ilji 3ilcha");
    expect(hangulToLatin("React 공부")).toBe("React gongbu");
  });

  it("romanizes standalone compatibility jamo", () => {
    expect(hangulToLatin("ㅋㅋㅋ")).toBe("kkk");
    expect(hangulToLatin("ㅠㅠ")).toBe("yuyu");
  });
});

describe("kanaToRomaji", () => {
  it("romanizes hiragana", () => {
    expect(kanaToRomaji("こんにちは")).toBe("konnichiha");
  });

  it("romanizes katakana", () => {
    expect(kanaToRomaji("カタカナタイトル")).toBe("katakanataitoru");
  });

  it("drops the chōonpu long-vowel mark", () => {
    expect(kanaToRomaji("ハンバーガー")).toBe("hanbaga");
    expect(kanaToRomaji("ラーメン")).toBe("ramen");
  });

  it("geminates consonants after sokuon", () => {
    expect(kanaToRomaji("がっこう")).toBe("gakkou");
    expect(kanaToRomaji("きっぷ")).toBe("kippu");
  });

  it("uses tch for sokuon before chi", () => {
    expect(kanaToRomaji("まっちゃ")).toBe("matcha");
  });

  it("handles digraphs", () => {
    expect(kanaToRomaji("きょうと")).toBe("kyouto");
    expect(kanaToRomaji("しゃしん")).toBe("shashin");
    expect(kanaToRomaji("じゅんび")).toBe("junbi");
  });

  it("handles extended katakana combos", () => {
    expect(kanaToRomaji("ファン")).toBe("fan");
    expect(kanaToRomaji("パーティー")).toBe("pati");
    expect(kanaToRomaji("チェック")).toBe("chekku");
    expect(kanaToRomaji("ヴァイオリン")).toBe("vaiorin");
  });

  it("passes non-kana characters through unchanged", () => {
    expect(kanaToRomaji("東京タワー")).toBe("東京tawa");
    expect(kanaToRomaji("abc カフェ")).toBe("abc kafe");
  });

  it("ignores a dangling sokuon", () => {
    expect(kanaToRomaji("あっ")).toBe("a");
  });
});
