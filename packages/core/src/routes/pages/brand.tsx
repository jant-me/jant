/**
 * Brand Page Route
 *
 * Public brand asset page for Jant's default visual system.
 * Uses the Linen theme regardless of the site's current theme and stays
 * noindexed because every Jant site exposes the same resource page.
 */

import { Hono, type Context } from "hono";
import { msg } from "@lingui/core/macro";
import {
  getJantBundledAsset,
  getJantIconHref,
} from "../../lib/jant-branding.js";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { getNavigationData } from "../../lib/navigation.js";
import { buildPageTitle } from "../../lib/page-title.js";
import { renderPublicPage } from "../../lib/render.js";
import { buildThemeStyle } from "../../lib/theme.js";
import { getI18n } from "../../i18n/index.js";
import {
  BUILTIN_COLOR_THEMES,
  type ColorTheme,
} from "../../ui/color-themes.js";
import { BrandPage } from "../../ui/pages/BrandPage.js";
import {
  BUILTIN_FONT_THEMES,
  getFontThemeCssVariables,
} from "../../ui/font-themes.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

function getLinenTheme(): ColorTheme | undefined {
  return (
    BUILTIN_COLOR_THEMES.find((theme) => theme.id === "linen") ??
    BUILTIN_COLOR_THEMES[0]
  );
}

async function renderBrandSpecPage(
  c: Context<Env>,
  options: {
    theme: ColorTheme;
    pageTitle: string;
    description: string;
  },
) {
  const navData = await getNavigationData(c);
  const fontTheme = c.var.appConfig.fontThemeId
    ? BUILTIN_FONT_THEMES.find(
        (theme) => theme.id === c.var.appConfig.fontThemeId,
      )
    : undefined;
  const fontOverrides = fontTheme ? getFontThemeCssVariables(fontTheme) : {};

  c.set("appConfig", {
    ...c.var.appConfig,
    themeId: options.theme.id,
    themeMode: "light",
    noindex: true,
  });
  c.header("X-Robots-Tag", "noindex, nofollow");
  c.set("themeStyle", buildThemeStyle(options.theme, fontOverrides));
  const socialImageUrl = getJantIconHref("socialImage", navData.sitePathPrefix);
  const faviconHref = getJantIconHref("favicon", navData.sitePathPrefix);
  const appleTouchHref = getJantIconHref("appleTouch", navData.sitePathPrefix);

  return renderPublicPage(c, {
    page: "brand",
    title: buildPageTitle(options.pageTitle, navData.siteName),
    description: options.description,
    socialImageUrl,
    faviconHref,
    appleTouchHref,
    navData,
    content: <BrandPage sitePathPrefix={navData.sitePathPrefix} />,
  });
}

export const brandRoutes = new Hono<Env>();

brandRoutes.get("/brand/assets/:filename", async (c) => {
  const asset = getJantBundledAsset(c.req.param("filename"));

  if (!asset) {
    return c.notFound();
  }

  return new Response(asset.body, {
    headers: {
      "Content-Type": asset.contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
});

brandRoutes.get("/brand", async (c) => {
  const i18n = getI18n(c);
  const brandTheme = getLinenTheme();
  if (!brandTheme) {
    return c.notFound();
  }

  return renderBrandSpecPage(c, {
    theme: brandTheme,
    pageTitle: i18n._(
      msg({
        message: "Brand assets",
        comment: "@context: Browser page title for the public brand asset page",
      }),
    ),
    description: i18n._(
      msg({
        message: "Download official Jant logos, icons, and preview assets.",
        comment: "@context: Meta description for the public brand asset page",
      }),
    ),
  });
});
