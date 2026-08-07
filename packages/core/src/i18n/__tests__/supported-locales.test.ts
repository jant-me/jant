import { describe, it, expect } from "vitest";
import {
  formatLanguageList,
  parseLanguageList,
  toLanguagePrefix,
} from "../locales.js";
import { resolveSupportedLocaleTag } from "../supported-locales.js";

describe("resolveSupportedLocaleTag", () => {
  it("matches a curated tag exactly", () => {
    expect(resolveSupportedLocaleTag("ja")).toBe("ja");
    expect(resolveSupportedLocaleTag("pt-BR")).toBe("pt-BR");
  });

  it("is case-insensitive", () => {
    expect(resolveSupportedLocaleTag("PT-br")).toBe("pt-BR");
  });

  it("resolves a region tag to the right Chinese script", () => {
    // The curated list offers zh by script, not by region, so this has to work
    // or a Chinese browser lands on English.
    expect(resolveSupportedLocaleTag("zh-CN")).toBe("zh-Hans");
    expect(resolveSupportedLocaleTag("zh-SG")).toBe("zh-Hans");
    expect(resolveSupportedLocaleTag("zh-TW")).toBe("zh-Hant");
    expect(resolveSupportedLocaleTag("zh-HK")).toBe("zh-Hant");
  });

  it("falls back to the bare language when the region is unknown", () => {
    expect(resolveSupportedLocaleTag("de-AT")).toBe("de");
  });

  it("respects q-values", () => {
    expect(resolveSupportedLocaleTag("fr;q=0.5,ja;q=0.9,en;q=0.8")).toBe("ja");
  });

  it("skips entries the client excluded", () => {
    expect(resolveSupportedLocaleTag("ja;q=0,fr")).toBe("fr");
  });

  it("falls back to English for anything unrecognized", () => {
    expect(resolveSupportedLocaleTag("*")).toBe("en");
    expect(resolveSupportedLocaleTag("")).toBe("en");
    expect(resolveSupportedLocaleTag(undefined)).toBe("en");
    expect(resolveSupportedLocaleTag("not a locale!!!")).toBe("en");
  });
});

describe("language list settings value", () => {
  it("round-trips canonical tags in order", () => {
    expect(formatLanguageList(parseLanguageList("en,ja"))).toBe("en,ja");
  });

  it("canonicalizes case and trims whitespace", () => {
    expect(parseLanguageList(" en , ZH-hant ")).toEqual(["en", "zh-Hant"]);
  });

  it("drops duplicates while keeping the first position", () => {
    expect(parseLanguageList("ja,en,JA")).toEqual(["ja", "en"]);
  });

  it("drops blank and unparseable entries", () => {
    expect(parseLanguageList("en,,not a locale!!!,ja")).toEqual(["en", "ja"]);
  });

  it("treats missing values as an empty list", () => {
    expect(parseLanguageList(null)).toEqual([]);
    expect(parseLanguageList(undefined)).toEqual([]);
    expect(parseLanguageList("")).toEqual([]);
  });
});

describe("toLanguagePrefix", () => {
  it("lowercases the canonical tag", () => {
    expect(toLanguagePrefix("zh-Hant")).toBe("zh-hant");
    expect(toLanguagePrefix("en")).toBe("en");
  });

  it("maps distinct languages to distinct prefixes", () => {
    const tags = ["en", "zh-Hans", "zh-Hant", "ja", "pt-BR"];
    const prefixes = tags.map(toLanguagePrefix);
    expect(new Set(prefixes).size).toBe(tags.length);
  });
});
