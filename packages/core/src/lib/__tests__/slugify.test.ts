import { describe, it, expect } from "vitest";
import { slugify } from "../slugify.js";

describe("slugify", () => {
  it("converts text to lowercase hyphenated slug", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("removes special characters", () => {
    expect(slugify("Hello World! This is a Test.")).toBe(
      "hello-world-this-is-a-test",
    );
  });

  it("collapses multiple spaces", () => {
    expect(slugify("Multiple   Spaces")).toBe("multiple-spaces");
  });

  it("trims leading/trailing whitespace and hyphens", () => {
    expect(slugify("  Multiple   Spaces  ")).toBe("multiple-spaces");
  });

  it("replaces underscores with hyphens", () => {
    expect(slugify("hello_world")).toBe("hello-world");
  });

  it("handles already-slugified text", () => {
    expect(slugify("already-a-slug")).toBe("already-a-slug");
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });

  it("transliterates accented characters", () => {
    expect(slugify("café & résumé")).toBe("cafe-and-resume");
  });

  it("converts Chinese characters to pinyin", () => {
    expect(slugify("书评")).toBe("shu-ping");
  });

  it("handles mixed Chinese and English text", () => {
    expect(slugify("我的 Blog")).toBe("wo-de-blog");
  });

  it("handles CJK characters with spaces", () => {
    expect(slugify("电影 评论")).toBe("dian-ying-ping-lun");
  });

  it("romanizes Korean titles", () => {
    expect(slugify("안녕하세요 세계")).toBe("annyeonghaseyo-segye");
    expect(slugify("개발 일지 3일차")).toBe("gaebal-ilji-3ilcha");
  });

  it("romanizes kana-only Japanese titles", () => {
    expect(slugify("カタカナタイトル")).toBe("katakanataitoru");
    expect(slugify("ハンバーガー")).toBe("hanbaga");
  });

  it("keeps Latin words in mostly-kana Japanese titles", () => {
    expect(slugify("React入門ガイド")).toBe("react-gaido");
  });

  it("returns empty for kanji-heavy Japanese titles instead of garbling them", () => {
    // Kanji carries the meaning; without a reading dictionary any output
    // would be gibberish, so callers should fall back to a random ID.
    expect(slugify("日本語のタイトルです")).toBe("");
    expect(slugify("東京タワーに行った")).toBe("");
    expect(slugify("こんにちは世界")).toBe("");
  });

  it("returns empty for scripts with no usable transliteration", () => {
    expect(slugify("שלום עולם")).toBe("");
    expect(slugify("สวัสดีชาวโลก")).toBe("");
  });

  it("returns empty when most of the title is untransliterable", () => {
    expect(slugify("שלום world")).toBe("");
  });

  it("returns empty for emoji-only titles", () => {
    expect(slugify("🎉🎉")).toBe("");
  });
});
