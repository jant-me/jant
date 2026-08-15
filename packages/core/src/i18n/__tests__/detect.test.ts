import { describe, it, expect } from "vitest";
import {
  detectLocaleFromHeader,
  getCjkFontFromLanguageTag,
} from "../detect.js";

describe("detectLocaleFromHeader", () => {
  it("returns en for en", () => {
    expect(detectLocaleFromHeader("en")).toBe("en");
  });

  it("returns en for en-US", () => {
    expect(detectLocaleFromHeader("en-US")).toBe("en");
  });

  it("returns en for en-GB", () => {
    expect(detectLocaleFromHeader("en-GB")).toBe("en");
  });

  it("falls back to en for unsupported language", () => {
    expect(detectLocaleFromHeader("fr")).toBe("en");
  });

  it("maps Simplified Chinese browser locales to zh-Hans", () => {
    expect(detectLocaleFromHeader("zh-CN")).toBe("zh-Hans");
    expect(detectLocaleFromHeader("zh-SG")).toBe("zh-Hans");
  });

  it("maps Traditional Chinese browser locales to zh-Hant", () => {
    expect(detectLocaleFromHeader("zh-TW")).toBe("zh-Hant");
    expect(detectLocaleFromHeader("zh-HK")).toBe("zh-Hant");
  });

  it("returns en for undefined", () => {
    expect(detectLocaleFromHeader(undefined)).toBe("en");
  });

  it("returns en for empty string", () => {
    expect(detectLocaleFromHeader("")).toBe("en");
  });

  it("returns en for whitespace-only string", () => {
    expect(detectLocaleFromHeader("   ")).toBe("en");
  });

  it("handles wildcard (*)", () => {
    expect(detectLocaleFromHeader("*")).toBe("en");
  });
});

describe("getCjkFontFromLanguageTag", () => {
  it("maps Simplified Chinese tags to the zh-Hans profile", () => {
    expect(getCjkFontFromLanguageTag("zh-CN")).toBe("zh-Hans");
    expect(getCjkFontFromLanguageTag("zh-SG")).toBe("zh-Hans");
    expect(getCjkFontFromLanguageTag("zh-Hans")).toBe("zh-Hans");
    // Bare `zh` is ambiguous in principle; Simplified is the majority reading.
    expect(getCjkFontFromLanguageTag("zh")).toBe("zh-Hans");
  });

  it("maps Traditional Chinese tags to the zh-Hant profile", () => {
    expect(getCjkFontFromLanguageTag("zh-TW")).toBe("zh-Hant");
    expect(getCjkFontFromLanguageTag("zh-HK")).toBe("zh-Hant");
    expect(getCjkFontFromLanguageTag("zh-MO")).toBe("zh-Hant");
    expect(getCjkFontFromLanguageTag("zh-Hant")).toBe("zh-Hant");
  });

  it("maps Japanese and Korean tags", () => {
    expect(getCjkFontFromLanguageTag("ja")).toBe("ja");
    expect(getCjkFontFromLanguageTag("ja-JP")).toBe("ja");
    expect(getCjkFontFromLanguageTag("ko")).toBe("ko");
    expect(getCjkFontFromLanguageTag("ko-KR")).toBe("ko");
  });

  it("is case-insensitive", () => {
    expect(getCjkFontFromLanguageTag("ZH-CN")).toBe("zh-Hans");
  });

  it("returns nothing for languages with no CJK profile", () => {
    expect(getCjkFontFromLanguageTag("en-US")).toBeUndefined();
    expect(getCjkFontFromLanguageTag("")).toBeUndefined();
    expect(getCjkFontFromLanguageTag("   ")).toBeUndefined();
  });
});
