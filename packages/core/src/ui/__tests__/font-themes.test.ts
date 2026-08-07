import { describe, it, expect } from "vitest";
import {
  BUILTIN_FONT_THEMES,
  DEFAULT_FONT_CJK_SANS_FALLBACK,
  DEFAULT_FONT_CJK_SERIF_FALLBACK,
  getCjkFontCssVariables,
  getFontThemeCssVariables,
  resolveCjkFontProfile,
} from "../font-themes.js";

describe("BUILTIN_FONT_THEMES", () => {
  it("contains 6 themes", () => {
    expect(BUILTIN_FONT_THEMES).toHaveLength(7);
  });

  it("has 'classic' as the first theme", () => {
    expect(BUILTIN_FONT_THEMES[0].id).toBe("classic");
  });

  it("each theme has required fields", () => {
    for (const theme of BUILTIN_FONT_THEMES) {
      expect(theme.id).toBeTruthy();
      expect(theme.name.message).toBeTruthy();
      expect(theme.headingFontFamily).toBeTruthy();
      expect(theme.bodyFontFamily).toBeTruthy();
      expect(theme.cssVariables).toBeTruthy();
      expect(theme.description.message).toBeTruthy();
    }
  });

  it("has no duplicate IDs", () => {
    const ids = BUILTIN_FONT_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes expected theme IDs", () => {
    const ids = BUILTIN_FONT_THEMES.map((t) => t.id);
    expect(ids).toContain("classic");
    expect(ids).toContain("system-sans");
    expect(ids).toContain("humanist-sans");
    expect(ids).toContain("modern-editorial");
    expect(ids).toContain("literary");
    expect(ids).toContain("tufte");
    expect(ids).toContain("geometric");
  });

  it("classic theme uses serif heading and sans body", () => {
    const defaultTheme = BUILTIN_FONT_THEMES.find(
      (t) => t.id === "classic",
    ) as (typeof BUILTIN_FONT_THEMES)[number];
    expect(defaultTheme.name.message).toBe("Classic");
    expect(defaultTheme.headingFontFamily).not.toBe(
      defaultTheme.bodyFontFamily,
    );
    expect(defaultTheme.headingFontFamily).toContain("Charter");
    expect(defaultTheme.bodyFontFamily).toContain("ui-sans-serif");
  });

  it("pairing themes have distinct heading and body fonts", () => {
    const pairingIds = ["classic", "modern-editorial"];
    for (const id of pairingIds) {
      const theme = BUILTIN_FONT_THEMES.find(
        (t) => t.id === id,
      ) as (typeof BUILTIN_FONT_THEMES)[number];
      expect(theme.headingFontFamily).not.toBe(theme.bodyFontFamily);
    }
  });

  it("system sans uses the same font for heading and body", () => {
    const theme = BUILTIN_FONT_THEMES.find(
      (item) => item.id === "system-sans",
    ) as (typeof BUILTIN_FONT_THEMES)[number];
    expect(theme.headingFontFamily).toBe(theme.bodyFontFamily);
  });

  it("humanist sans uses Source Sans 3 for both heading and body", () => {
    const theme = BUILTIN_FONT_THEMES.find(
      (item) => item.id === "humanist-sans",
    ) as (typeof BUILTIN_FONT_THEMES)[number];
    expect(theme.headingFontFamily).toBe(theme.bodyFontFamily);
    expect(theme.bodyFontFamily).toContain("Source Sans 3 Variable");
  });

  it("exposes font theme css variables for injection", () => {
    const theme = BUILTIN_FONT_THEMES.find(
      (item) => item.id === "geometric",
    ) as (typeof BUILTIN_FONT_THEMES)[number];
    const variables = getFontThemeCssVariables(theme);

    expect(variables["--font-body"]).toBe(theme.bodyFontFamily);
    expect(variables["--font-heading"]).toBe(theme.headingFontFamily);
    expect(variables["--type-label-weight"]).toBe("var(--fw-semibold)");
  });

  it("routes zh-Hans content to simplified serif and sans fallbacks", () => {
    const variables = getCjkFontCssVariables("zh-Hans");
    const serif = variables["--font-cjk-serif-fallback"];
    const sans = variables["--font-cjk-sans-fallback"];

    expect(serif).toContain('"Songti SC"');
    expect(serif).toContain('"Noto Serif SC"');
    expect(sans.indexOf('"PingFang SC"')).toBeLessThan(
      sans.indexOf('"PingFang TC"'),
    );
  });

  it("routes zh-Hant content to traditional serif and sans fallbacks", () => {
    const variables = getCjkFontCssVariables("zh-Hant");
    const serif = variables["--font-cjk-serif-fallback"];
    const sans = variables["--font-cjk-sans-fallback"];

    expect(serif).toContain('"Songti TC"');
    expect(serif).toContain('"Noto Serif TC"');
    expect(sans.indexOf('"PingFang TC"')).toBeLessThan(
      sans.indexOf('"PingFang SC"'),
    );
  });

  it("routes Japanese content to the Japanese font profile", () => {
    const variables = getCjkFontCssVariables("ja");

    expect(variables["--font-cjk-serif-fallback"]).toContain('"Noto Serif JP"');
    expect(variables["--font-cjk-sans-fallback"]).toContain('"Noto Sans JP"');
  });

  it("routes Korean content to the Korean font profile", () => {
    const variables = getCjkFontCssVariables("ko");

    expect(variables["--font-cjk-serif-fallback"]).toContain('"Noto Serif KR"');
    expect(variables["--font-cjk-sans-fallback"]).toContain('"Noto Sans KR"');
  });

  it("derives the profile from the language alone", () => {
    expect(resolveCjkFontProfile("zh-Hant")).toBe("zh-Hant");
    expect(resolveCjkFontProfile("zh-CN")).toBe("zh-Hans");
    expect(resolveCjkFontProfile("ja-JP")).toBe("ja");
  });

  it("has no profile for a language without CJK typography", () => {
    expect(resolveCjkFontProfile("en")).toBeUndefined();
    expect(resolveCjkFontProfile()).toBeUndefined();
  });

  it("keeps the default profile neutral", () => {
    expect(getCjkFontCssVariables("en")).toEqual({});
    expect(DEFAULT_FONT_CJK_SERIF_FALLBACK).toBe('"Jant Language Fallback"');
    expect(DEFAULT_FONT_CJK_SANS_FALLBACK).toBe('"Jant Language Fallback"');
  });

  it("puts language slots into every serif and sans theme stack", () => {
    for (const theme of BUILTIN_FONT_THEMES) {
      const combined = `${theme.headingFontFamily} ${theme.bodyFontFamily}`;
      expect(combined).toMatch(/var\(--font-cjk-(?:serif|sans)-fallback\)/);
    }
  });
});
