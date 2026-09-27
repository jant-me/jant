import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  buildThemeStyle,
  getThemeBrowserColors,
  resolveBuiltinTheme,
} from "../theme.js";
import {
  BUILTIN_FONT_THEMES,
  getFontThemeCssVariables,
} from "../../ui/font-themes.js";
import { BUILTIN_COLOR_THEMES } from "../../ui/color-themes.js";

describe("buildThemeStyle", () => {
  it("returns empty string when no theme and no variables", () => {
    expect(buildThemeStyle(undefined)).toBe("");
    expect(buildThemeStyle(undefined, {})).toBe("");
  });

  it("generates CSS with font overrides only (no color theme)", () => {
    const theme = BUILTIN_FONT_THEMES.find(
      (f) => f.id === "system-sans",
    ) as (typeof BUILTIN_FONT_THEMES)[number];
    const fontOverrides = getFontThemeCssVariables(theme);

    const css = buildThemeStyle(undefined, fontOverrides);

    expect(css).toContain(":root {");
    expect(css).toContain("--font-body:");
    expect(css).toContain("--font-heading:");
    expect(css).toContain("ui-sans-serif");
    expect(css).toContain("prefers-color-scheme: dark");
  });

  it("font override merges with color theme", () => {
    const fakeTheme = {
      id: "test",
      name: "Test",
      light: {
        "--primary": "oklch(0.5 0.1 200)",
        "--site-accent": "oklch(0.58 0.08 210)",
      },
      dark: {
        "--primary": "oklch(0.7 0.1 200)",
        "--site-accent": "oklch(0.76 0.08 210)",
      },
    };
    const fontOverrides = {
      "--font-body": "Georgia, serif",
      "--font-heading": "Futura, sans-serif",
    };

    const css = buildThemeStyle(fakeTheme, fontOverrides);

    expect(css).toContain("--primary:");
    expect(css).toContain("--site-accent:");
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

  it("writes each value on the rung custom CSS overrides with the same selector", () => {
    const fakeTheme = {
      id: "test",
      name: "Test",
      light: { "--primary": "oklch(0.5 0.1 200)" },
      dark: { "--primary": "oklch(0.7 0.1 200)" },
    };

    const css = buildThemeStyle(fakeTheme);

    // Light on `:root`; dark for a site set to dark, and for one following a
    // dark system preference unless set to light. Nothing doubles `:root`,
    // which would put it out of reach of custom CSS that follows it.
    expect(css).toContain(":root {\n  color-scheme: light;");
    expect(css).toContain(
      ':root[data-theme-mode="dark"] {\n  color-scheme: dark;',
    );
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\) \{\n {2}:root:not\(\[data-theme-mode="light"\]\) \{/,
    );
    expect(css).not.toContain(":root:root");
  });

  it("keeps every stylesheet's theme variables within reach of custom CSS", () => {
    // The site stylesheet is linked before the theme and custom CSS, so a
    // default on the same rung loses to both. One above the dark rung would
    // beat them wherever it appears.
    const dir = resolve(import.meta.dirname, "../..");
    for (const file of [
      "preset.css",
      ...readdirSync(join(dir, "styles"))
        .filter((name) => name.endsWith(".css"))
        .map((name) => `styles/${name}`),
    ]) {
      const css = readFileSync(join(dir, file), "utf8").replace(
        /\/\*[\s\S]*?\*\//g,
        "",
      );
      expect(css, file).not.toContain(":root:root");
    }
  });

  it("resolves the active built-in theme from ID", () => {
    expect(resolveBuiltinTheme("linen")?.id).toBe("linen");
    expect(resolveBuiltinTheme("")?.id).toBeUndefined();
    expect(resolveBuiltinTheme("missing")).toBeUndefined();
  });

  it("returns theme-aware browser chrome colors", () => {
    const linen = BUILTIN_COLOR_THEMES.find(
      (theme) => theme.id === "linen",
    ) as (typeof BUILTIN_COLOR_THEMES)[number];

    expect(getThemeBrowserColors(linen)).toEqual({
      light: "#faf7ec",
      dark: "#121211",
    });
    expect(getThemeBrowserColors()).toEqual({
      light: "#ffffff",
      dark: "#0a0a0a",
    });
  });

  it("keeps non-oklch browser chrome colors unchanged", () => {
    expect(
      getThemeBrowserColors({
        id: "custom",
        name: "Custom",
        light: { "--background": "#f4efe5" },
        dark: { "--background": "rgb(18 18 17)" },
      }),
    ).toEqual({
      light: "#f4efe5",
      dark: "rgb(18 18 17)",
    });
  });
});
