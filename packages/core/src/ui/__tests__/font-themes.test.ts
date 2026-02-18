import { describe, it, expect } from "vitest";
import { BUILTIN_FONT_THEMES } from "../font-themes.js";

describe("BUILTIN_FONT_THEMES", () => {
  it("contains 5 themes", () => {
    expect(BUILTIN_FONT_THEMES).toHaveLength(5);
  });

  it("has 'default' as the first theme", () => {
    expect(BUILTIN_FONT_THEMES[0].id).toBe("default");
  });

  it("each theme has required fields", () => {
    for (const theme of BUILTIN_FONT_THEMES) {
      expect(theme.id).toBeTruthy();
      expect(theme.name.message).toBeTruthy();
      expect(theme.headingFontFamily).toBeTruthy();
      expect(theme.bodyFontFamily).toBeTruthy();
      expect(theme.description.message).toBeTruthy();
    }
  });

  it("has no duplicate IDs", () => {
    const ids = BUILTIN_FONT_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes expected theme IDs", () => {
    const ids = BUILTIN_FONT_THEMES.map((t) => t.id);
    expect(ids).toContain("default");
    expect(ids).toContain("classic-editorial");
    expect(ids).toContain("modern-editorial");
    expect(ids).toContain("literary");
    expect(ids).toContain("geometric");
  });

  it("default theme uses the same font for heading and body", () => {
    const defaultTheme = BUILTIN_FONT_THEMES.find(
      (t) => t.id === "default",
    ) as (typeof BUILTIN_FONT_THEMES)[number];
    expect(defaultTheme.headingFontFamily).toBe(defaultTheme.bodyFontFamily);
  });

  it("pairing themes have distinct heading and body fonts", () => {
    const pairingIds = ["classic-editorial", "modern-editorial", "literary"];
    for (const id of pairingIds) {
      const theme = BUILTIN_FONT_THEMES.find(
        (t) => t.id === id,
      ) as (typeof BUILTIN_FONT_THEMES)[number];
      expect(theme.headingFontFamily).not.toBe(theme.bodyFontFamily);
    }
  });
});
