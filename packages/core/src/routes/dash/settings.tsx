/**
 * Dashboard Settings Routes
 */

import { Hono } from "hono";
import { useLingui } from "../../i18n/index.js";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../app.js";
import { DashLayout } from "../../theme/layouts/index.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const settingsRoutes = new Hono<Env>();

function SettingsContent({
  siteName,
  siteDescription,
  siteLanguage,
}: {
  siteName: string;
  siteDescription: string;
  siteLanguage: string;
}) {
  const { t } = useLingui();

  return (
    <>
      <h1 class="text-2xl font-semibold mb-6">
        {t({ message: "Settings", comment: "@context: Dashboard heading" })}
      </h1>

      <form method="post" action="/dash/settings" class="flex flex-col gap-6 max-w-lg">
        <div class="card">
          <header>
            <h2>{t({ message: "General", comment: "@context: Settings section heading" })}</h2>
          </header>
          <section class="flex flex-col gap-4">
            <div class="field">
              <label class="label">
                {t({ message: "Site Name", comment: "@context: Settings form field" })}
              </label>
              <input type="text" name="siteName" class="input" value={siteName} required />
            </div>

            <div class="field">
              <label class="label">
                {t({ message: "Site Description", comment: "@context: Settings form field" })}
              </label>
              <textarea name="siteDescription" class="textarea" rows={3}>
                {siteDescription}
              </textarea>
            </div>

            <div class="field">
              <label class="label">
                {t({ message: "Language", comment: "@context: Settings form field" })}
              </label>
              <select name="siteLanguage" class="select">
                <option value="en" selected={siteLanguage === "en"}>
                  English
                </option>
                <option value="zh-Hans" selected={siteLanguage === "zh-Hans"}>
                  简体中文
                </option>
                <option value="zh-Hant" selected={siteLanguage === "zh-Hant"}>
                  繁體中文
                </option>
              </select>
            </div>
          </section>
        </div>

        <button type="submit" class="btn">
          {t({ message: "Save Settings", comment: "@context: Button to save settings" })}
        </button>
      </form>
    </>
  );
}

// Settings page
settingsRoutes.get("/", async (c) => {
  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";
  const siteDescription = (await c.var.services.settings.get("SITE_DESCRIPTION")) ?? "";
  const siteLanguage = (await c.var.services.settings.get("SITE_LANGUAGE")) ?? "en";

  return c.html(
    <DashLayout c={c} title="Settings" siteName={siteName} currentPath="/dash/settings">
      <SettingsContent
        siteName={siteName}
        siteDescription={siteDescription}
        siteLanguage={siteLanguage}
      />
    </DashLayout>
  );
});

// Update settings
settingsRoutes.post("/", async (c) => {
  const formData = await c.req.formData();

  const siteName = formData.get("siteName") as string;
  const siteDescription = formData.get("siteDescription") as string;
  const siteLanguage = formData.get("siteLanguage") as string;

  await c.var.services.settings.setMany({
    SITE_NAME: siteName,
    SITE_DESCRIPTION: siteDescription,
    SITE_LANGUAGE: siteLanguage,
  });

  return c.redirect("/dash/settings?saved=1");
});
