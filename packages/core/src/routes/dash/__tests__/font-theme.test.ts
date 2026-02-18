/**
 * Font theme save & read flow test.
 *
 * Verifies that FONT_THEME setting persists and buildThemeStyle generates
 * the correct CSS overrides for --font-body and --font-heading.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDatabase } from "../../../__tests__/helpers/db.js";
import { createSettingsService } from "../../../services/settings.js";
import { BUILTIN_FONT_THEMES } from "../../../ui/font-themes.js";
import { buildThemeStyle } from "../../../lib/theme.js";
import type { Database } from "../../../db/index.js";

describe("Font theme save & CSS generation", () => {
  let db: Database;
  let settings: ReturnType<typeof createSettingsService>;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db as unknown as Database;
    settings = createSettingsService(db);
  });

  it("saves and reads FONT_THEME setting", async () => {
    // Initially null
    const initial = await settings.get("FONT_THEME");
    expect(initial).toBeNull();

    // Save classic-editorial
    await settings.set("FONT_THEME", "classic-editorial");
    expect(await settings.get("FONT_THEME")).toBe("classic-editorial");

    // Update to geometric
    await settings.set("FONT_THEME", "geometric");
    expect(await settings.get("FONT_THEME")).toBe("geometric");

    // Remove (reset to default)
    await settings.remove("FONT_THEME");
    expect(await settings.get("FONT_THEME")).toBeNull();
  });

  it("generates correct CSS with both --font-body and --font-heading", async () => {
    // Save classic-editorial, then switch to geometric — simulates the middleware flow
    await settings.set("FONT_THEME", "classic-editorial");
    await settings.set("FONT_THEME", "geometric");

    const fontThemeId = await settings.get("FONT_THEME");
    expect(fontThemeId).toBe("geometric");

    const fontTheme = BUILTIN_FONT_THEMES.find(
      (f) => f.id === fontThemeId,
    ) as (typeof BUILTIN_FONT_THEMES)[number];
    expect(fontTheme).toBeDefined();
    expect(fontTheme.headingFontFamily).toContain("Futura");
    expect(fontTheme.bodyFontFamily).toContain("system-ui");

    const fontOverrides = {
      "--font-body": fontTheme.bodyFontFamily,
      "--font-heading": fontTheme.headingFontFamily,
    };
    const css = buildThemeStyle(undefined, fontOverrides);

    expect(css).toContain("--font-body:");
    expect(css).toContain("--font-heading:");
    expect(css).toContain("Futura");
    expect(css).not.toContain("Charter");
  });

  it("generates no font override when default theme is selected", async () => {
    // Default theme -> no FONT_THEME setting -> no font override
    const fontThemeId = await settings.get("FONT_THEME");
    expect(fontThemeId).toBeNull();

    const fontTheme = fontThemeId
      ? BUILTIN_FONT_THEMES.find((f) => f.id === fontThemeId)
      : undefined;
    expect(fontTheme).toBeUndefined();

    const fontOverrides: Record<string, string> = {};
    if (fontTheme) {
      fontOverrides["--font-body"] = fontTheme.bodyFontFamily;
      fontOverrides["--font-heading"] = fontTheme.headingFontFamily;
    }

    const css = buildThemeStyle(undefined, fontOverrides);
    expect(css).toBe("");
  });

  it("classic-editorial has serif heading and sans body", async () => {
    await settings.set("FONT_THEME", "classic-editorial");

    const fontThemeId = await settings.get("FONT_THEME");
    const fontTheme = BUILTIN_FONT_THEMES.find(
      (f) => f.id === fontThemeId,
    ) as (typeof BUILTIN_FONT_THEMES)[number];

    expect(fontTheme.headingFontFamily).toContain("Charter");
    expect(fontTheme.bodyFontFamily).toContain("system-ui");

    const fontOverrides = {
      "--font-body": fontTheme.bodyFontFamily,
      "--font-heading": fontTheme.headingFontFamily,
    };
    const css = buildThemeStyle(undefined, fontOverrides);

    expect(css).toContain("--font-heading:");
    expect(css).toContain("Charter");
  });
});
