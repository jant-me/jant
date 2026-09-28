/**
 * Theme Sample Route
 *
 * Internal style-guide page for tuning color themes in a real content context.
 */

import { Hono } from "hono";
import { msg } from "@lingui/core/macro";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { getNavigationData } from "../../lib/navigation.js";
import { buildPageTitle } from "../../lib/page-title.js";
import { renderPublicPage } from "../../lib/render.js";
import { buildThemeStyle } from "../../lib/theme.js";
import { getI18n } from "../../i18n/index.js";
import { BUILTIN_COLOR_THEMES } from "../../ui/color-themes.js";
import { ThemeSamplePage } from "../../ui/pages/ThemeSamplePage.js";
import { THEME_MODES, type ThemeMode } from "../../types/config.js";
import {
  BUILTIN_FONT_THEMES,
  getFontThemeCssVariables,
} from "../../ui/font-themes.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

function resolveThemeMode(
  value: string | undefined,
  fallback: ThemeMode,
): ThemeMode {
  return THEME_MODES.includes(value as ThemeMode)
    ? (value as ThemeMode)
    : fallback;
}

export const themeSampleRoutes = new Hono<Env>();

themeSampleRoutes.get("/theme-sample", async (c) => {
  const navData = await getNavigationData(c);
  const i18n = getI18n(c);
  const currentThemeId = c.var.appConfig.themeId;
  const queryThemeId = c.req.query("theme");
  const fallbackTheme = BUILTIN_COLOR_THEMES[0];
  if (!fallbackTheme) {
    return c.notFound();
  }
  const selectedTheme =
    BUILTIN_COLOR_THEMES.find((theme) => theme.id === queryThemeId) ??
    BUILTIN_COLOR_THEMES.find((theme) => theme.id === currentThemeId) ??
    fallbackTheme;

  const selectedMode = resolveThemeMode(
    c.req.query("mode"),
    c.var.appConfig.themeMode,
  );

  const fontTheme = c.var.appConfig.fontThemeId
    ? BUILTIN_FONT_THEMES.find(
        (theme) => theme.id === c.var.appConfig.fontThemeId,
      )
    : undefined;
  const fontOverrides = fontTheme ? getFontThemeCssVariables(fontTheme) : {};

  c.set("appConfig", {
    ...c.var.appConfig,
    themeId: selectedTheme.id,
    themeMode: selectedMode,
    noindex: true,
  });
  c.header("X-Robots-Tag", "noindex, nofollow");
  // The page carries `data-theme-mode={selectedMode}`, which picks the block.
  c.set("themeStyle", buildThemeStyle(selectedTheme, fontOverrides));

  return renderPublicPage(c, {
    page: "theme-sample",
    title: buildPageTitle(
      selectedTheme.name,
      i18n._(
        msg({
          message: "Theme sample",
          comment:
            "@context: Browser page title for the public theme sample page",
        }),
      ),
      navData.siteName,
    ),
    navData,
    content: (
      <ThemeSamplePage
        themes={BUILTIN_COLOR_THEMES}
        selectedTheme={selectedTheme}
        currentMode={selectedMode}
        sitePathPrefix={navData.sitePathPrefix}
      />
    ),
  });
});
