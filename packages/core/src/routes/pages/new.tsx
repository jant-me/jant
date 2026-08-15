import { Hono } from "hono";
import { msg } from "@lingui/core/macro";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../types/app-context.js";
import { requireAuth } from "../../middleware/auth.js";
import { getNavigationData } from "../../lib/navigation.js";
import { buildPageTitle } from "../../lib/page-title.js";
import { renderPublicPage } from "../../lib/render.js";
import { getI18n } from "../../i18n/index.js";
import { ComposePage } from "../../ui/pages/ComposePage.js";
import { buildComposeLanguages, getViewLang } from "../../lib/view-language.js";
import { SETTINGS_KEYS } from "../../lib/constants.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const newPostRoutes = new Hono<Env>();

newPostRoutes.use("/new", requireAuth());

newPostRoutes.get("/new", async (c) => {
  const navData = await getNavigationData(c);
  const i18n = getI18n(c);
  const allSettings = c.get("allSettings") as Record<string, string>;
  const slashCommandDiscovered = Boolean(
    allSettings[SETTINGS_KEYS.DISCOVERY_SLASH_COMMAND_AT],
  );

  return renderPublicPage(c, {
    title: buildPageTitle(
      i18n._(
        msg({
          message: "New post",
          comment: "@context: Browser page title for the new post page",
        }),
      ),
      navData.siteName,
    ),
    navData,
    showComposeDialog: false,
    showHeader: false,
    content: (
      <ComposePage
        collections={navData.collections}
        uploadMaxFileSize={c.var.appConfig.uploadMaxFileSize}
        closeHref="/"
        slashCommandDiscovered={slashCommandDiscovered}
        languages={buildComposeLanguages(c)}
        contextLanguage={getViewLang(c)}
      />
    ),
  });
});
