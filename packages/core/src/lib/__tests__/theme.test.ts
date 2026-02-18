import { describe, it, expect } from "vitest";
import { buildThemeStyle } from "../theme.js";
import { BUILTIN_FONT_THEMES } from "../../ui/font-themes.js";

describe("buildThemeStyle", () => {
  it("returns empty string when no theme and no variables", () => {
    expect(buildThemeStyle(undefined)).toBe("");
    expect(buildThemeStyle(undefined, {})).toBe("");
  });

  it("generates CSS with font overrides only (no color theme)", () => {
    const theme = BUILTIN_FONT_THEMES.find(
      (f) => f.id === "classic-editorial",
    )!;
    const fontOverrides = {
      "--font-body": theme.bodyFontFamily,
      "--font-heading": theme.headingFontFamily,
    };

    const css = buildThemeStyle(undefined, fontOverrides);

    expect(css).toContain(":root:root");
    expect(css).toContain("--font-body:");
    expect(css).toContain("--font-heading:");
    expect(css).toContain("Charter");
    expect(css).toContain(":root.dark");
  });

  it("font override merges with color theme", () => {
    const fakeTheme = {
      id: "test",
      name: "Test",
      light: { "--primary": "oklch(0.5 0.1 200)" },
      dark: { "--primary": "oklch(0.7 0.1 200)" },
    };
    const fontOverrides = {
      "--font-body": "Georgia, serif",
      "--font-heading": "Futura, sans-serif",
    };

    const css = buildThemeStyle(fakeTheme, fontOverrides);

    expect(css).toContain("--primary:");
    expect(css).toContain("--font-body: Georgia, serif");
    expect(css).toContain("--font-heading: Futura, sans-serif");
  });

  it("cssVariables override theme values", () => {
    const fakeTheme = {
      id: "test",
      name: "Test",
      light: { "--font-body": "should-be-overridden" },
      dark: {},
    };
    const overrides = { "--font-body": "Charter, serif" };

    const css = buildThemeStyle(fakeTheme, overrides);

    expect(css).toContain("--font-body: Charter, serif");
    expect(css).not.toContain("should-be-overridden");
  });
});
