/**
 * Font theme save & read flow test.
 *
 * Verifies that FONT_THEME setting persists and buildThemeStyle generates
 * the correct CSS overrides for typography tokens.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../../__tests__/helpers/db.js";
import { createSettingsService } from "../../../services/settings.js";
import {
  BUILTIN_FONT_THEMES,
  getFontThemeCssVariables,
} from "../../../ui/font-themes.js";
import { buildThemeStyle } from "../../../lib/theme.js";
import type { Database } from "../../../db/index.js";

describe("Font theme save & CSS generation", () => {
  let db: Database;
  let settings: ReturnType<typeof createSettingsService>;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db as unknown as Database;
    settings = createSettingsService(db, DEFAULT_TEST_SITE_ID);
  });

  it("saves and reads FONT_THEME setting", async () => {
    // Initially null
    const initial = await settings.get("FONT_THEME");
    expect(initial).toBeNull();

    // Save system-sans
    await settings.set("FONT_THEME", "system-sans");
    expect(await settings.get("FONT_THEME")).toBe("system-sans");

    // Update to geometric
    await settings.set("FONT_THEME", "geometric");
    expect(await settings.get("FONT_THEME")).toBe("geometric");

    // Switch to classic
    await settings.set("FONT_THEME", "classic");
    expect(await settings.get("FONT_THEME")).toBe("classic");
  });

  it("generates correct CSS with typography overrides", async () => {
    // Save system-sans, then switch to humanist-sans — simulates the middleware flow
    await settings.set("FONT_THEME", "system-sans");
    await settings.set("FONT_THEME", "humanist-sans");

    const fontThemeId = await settings.get("FONT_THEME");
    expect(fontThemeId).toBe("humanist-sans");

    const fontTheme = BUILTIN_FONT_THEMES.find(
      (f) => f.id === fontThemeId,
    ) as (typeof BUILTIN_FONT_THEMES)[number];
    expect(fontTheme).toBeDefined();
    expect(fontTheme.headingFontFamily).toContain("Source Sans 3 Variable");
    expect(fontTheme.bodyFontFamily).toContain("Source Sans 3 Variable");

    const fontOverrides = getFontThemeCssVariables(fontTheme);
    const css = buildThemeStyle(undefined, fontOverrides);

    expect(css).toContain("--font-body:");
    expect(css).toContain("--font-heading:");
    expect(css).toContain("Source Sans 3 Variable");
    expect(css).not.toContain("Charter");
  });

  it("classic theme data uses serif heading and sans body", async () => {
    const fontTheme = BUILTIN_FONT_THEMES.find(
      (f) => f.id === "classic",
    ) as (typeof BUILTIN_FONT_THEMES)[number];

    expect(fontTheme.id).toBe("classic");
    expect(fontTheme.headingFontFamily).toContain("Charter");
    expect(fontTheme.bodyFontFamily).toContain("ui-sans-serif");

    const fontOverrides = getFontThemeCssVariables(fontTheme);
    const css = buildThemeStyle(undefined, fontOverrides);

    expect(css).toContain("--font-heading:");
    expect(css).toContain("Charter");
  });

  it("newsroom uses refined Latin newsroom fonts", async () => {
    await settings.set("FONT_THEME", "modern-editorial");

    const fontThemeId = await settings.get("FONT_THEME");
    const fontTheme = BUILTIN_FONT_THEMES.find(
      (f) => f.id === fontThemeId,
    ) as (typeof BUILTIN_FONT_THEMES)[number];

    expect(fontTheme.headingFontFamily).toContain("News Cycle");
    expect(fontTheme.bodyFontFamily).toContain("Newsreader Variable");
  });
});
