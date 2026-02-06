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

function SuccessMessage({ message }: { message: string }) {
  return (
    <div class="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
      {message}
    </div>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <div class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
      {message}
    </div>
  );
}

function SettingsContent({
  siteName,
  siteDescription,
  siteLanguage,
  saved,
  passwordSuccess,
  passwordError,
}: {
  siteName: string;
  siteDescription: string;
  siteLanguage: string;
  saved?: boolean;
  passwordSuccess?: boolean;
  passwordError?: string;
}) {
  const { t } = useLingui();

  return (
    <>
      <h1 class="text-2xl font-semibold mb-6">
        {t({ message: "Settings", comment: "@context: Dashboard heading" })}
      </h1>

      <div class="flex flex-col gap-6 max-w-lg">
        <form method="post" action="/dash/settings">
          {saved && (
            <div class="mb-4">
              <SuccessMessage
                message={t({
                  message: "Settings saved.",
                  comment: "@context: Success message after saving settings",
                })}
              />
            </div>
          )}
          <div class="card">
            <header>
              <h2>
                {t({
                  message: "General",
                  comment: "@context: Settings section heading",
                })}
              </h2>
            </header>
            <section class="flex flex-col gap-4">
              <div class="field">
                <label class="label">
                  {t({
                    message: "Site Name",
                    comment: "@context: Settings form field",
                  })}
                </label>
                <input
                  type="text"
                  name="siteName"
                  class="input"
                  value={siteName}
                  required
                />
              </div>

              <div class="field">
                <label class="label">
                  {t({
                    message: "Site Description",
                    comment: "@context: Settings form field",
                  })}
                </label>
                <textarea name="siteDescription" class="textarea" rows={3}>
                  {siteDescription}
                </textarea>
              </div>

              <div class="field">
                <label class="label">
                  {t({
                    message: "Language",
                    comment: "@context: Settings form field",
                  })}
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

          <button type="submit" class="btn mt-4">
            {t({
              message: "Save Settings",
              comment: "@context: Button to save settings",
            })}
          </button>
        </form>

        <form method="post" action="/dash/settings/password">
          {passwordSuccess && (
            <div class="mb-4">
              <SuccessMessage
                message={t({
                  message: "Password changed successfully.",
                  comment: "@context: Success message after changing password",
                })}
              />
            </div>
          )}
          {passwordError && (
            <div class="mb-4">
              <ErrorMessage message={passwordError} />
            </div>
          )}
          <div class="card">
            <header>
              <h2>
                {t({
                  message: "Change Password",
                  comment: "@context: Settings section heading",
                })}
              </h2>
            </header>
            <section class="flex flex-col gap-4">
              <div class="field">
                <label class="label">
                  {t({
                    message: "Current Password",
                    comment: "@context: Password form field",
                  })}
                </label>
                <input
                  type="password"
                  name="currentPassword"
                  class="input"
                  required
                  autocomplete="current-password"
                />
              </div>

              <div class="field">
                <label class="label">
                  {t({
                    message: "New Password",
                    comment: "@context: Password form field",
                  })}
                </label>
                <input
                  type="password"
                  name="newPassword"
                  class="input"
                  required
                  minlength={8}
                  autocomplete="new-password"
                />
              </div>

              <div class="field">
                <label class="label">
                  {t({
                    message: "Confirm New Password",
                    comment: "@context: Password form field",
                  })}
                </label>
                <input
                  type="password"
                  name="confirmPassword"
                  class="input"
                  required
                  minlength={8}
                  autocomplete="new-password"
                />
              </div>
            </section>
          </div>

          <button type="submit" class="btn mt-4">
            {t({
              message: "Change Password",
              comment: "@context: Button to change password",
            })}
          </button>
        </form>
      </div>
    </>
  );
}

// Settings page
settingsRoutes.get("/", async (c) => {
  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";
  const siteDescription =
    (await c.var.services.settings.get("SITE_DESCRIPTION")) ?? "";
  const siteLanguage =
    (await c.var.services.settings.get("SITE_LANGUAGE")) ?? "en";

  const saved = c.req.query("saved") === "1";
  const passwordSuccess = c.req.query("password") === "1";
  const passwordError = c.req.query("passwordError");

  return c.html(
    <DashLayout
      c={c}
      title="Settings"
      siteName={siteName}
      currentPath="/dash/settings"
    >
      <SettingsContent
        siteName={siteName}
        siteDescription={siteDescription}
        siteLanguage={siteLanguage}
        saved={saved}
        passwordSuccess={passwordSuccess}
        passwordError={passwordError}
      />
    </DashLayout>,
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

// Change password
settingsRoutes.post("/password", async (c) => {
  const formData = await c.req.formData();
  const currentPassword = formData.get("currentPassword") as string;
  const newPassword = formData.get("newPassword") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (newPassword !== confirmPassword) {
    return c.redirect(
      `/dash/settings?passwordError=${encodeURIComponent("Passwords do not match.")}`,
    );
  }

  try {
    await c.var.auth.api.changePassword({
      body: { currentPassword, newPassword, revokeOtherSessions: false },
      headers: c.req.raw.headers,
    });
  } catch {
    return c.redirect(
      `/dash/settings?passwordError=${encodeURIComponent("Current password is incorrect.")}`,
    );
  }

  return c.redirect("/dash/settings?password=1");
});
