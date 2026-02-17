import { describe, it, expect } from "vitest";
import { BUILTIN_FONT_THEMES } from "../font-themes.js";

describe("BUILTIN_FONT_THEMES", () => {
  it("contains 4 themes", () => {
    expect(BUILTIN_FONT_THEMES).toHaveLength(4);
  });

  it("has 'default' as the first theme", () => {
    expect(BUILTIN_FONT_THEMES[0].id).toBe("default");
  });

  it("each theme has required fields", () => {
    for (const theme of BUILTIN_FONT_THEMES) {
      expect(theme.id).toBeTruthy();
      expect(theme.name).toBeTruthy();
      expect(theme.fontFamily).toBeTruthy();
      expect(theme.description).toBeTruthy();
    }
  });

  it("has no duplicate IDs", () => {
    const ids = BUILTIN_FONT_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes expected theme IDs", () => {
    const ids = BUILTIN_FONT_THEMES.map((t) => t.id);
    expect(ids).toContain("default");
    expect(ids).toContain("serif");
    expect(ids).toContain("humanist");
    expect(ids).toContain("mono");
  });
});
