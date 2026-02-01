/**
 * Dashboard Redirects Routes
 */

import { Hono } from "hono";
import { msg } from "@lingui/core/macro";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../app.js";
import { DashLayout } from "../../theme/layouts/index.js";
import { getI18n } from "../../i18n/index.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const redirectsRoutes = new Hono<Env>();

// List redirects
redirectsRoutes.get("/", async (c) => {
  const i18n = getI18n(c);
  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";
  const redirects = await c.var.services.redirects.list();

  return c.html(
    <DashLayout c={c} title={i18n._(msg({ message: "Redirects", comment: "@context: Dashboard page title" }))} siteName={siteName} currentPath="/dash/redirects">
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-semibold">{i18n._(msg({ message: "Redirects", comment: "@context: Dashboard heading" }))}</h1>
        <a href="/dash/redirects/new" class="btn">
          {i18n._(msg({ message: "New Redirect", comment: "@context: Button to create new redirect" }))}
        </a>
      </div>

      {redirects.length === 0 ? (
        <p class="text-muted-foreground">{i18n._(msg({ message: "No redirects configured.", comment: "@context: Empty state message" }))}</p>
      ) : (
        <div class="flex flex-col divide-y">
          {redirects.map((r) => (
            <div key={r.id} class="py-4 flex items-center gap-4">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <code class="text-sm bg-muted px-1 rounded">{r.fromPath}</code>
                  <span class="text-muted-foreground">→</span>
                  <code class="text-sm bg-muted px-1 rounded">{r.toPath}</code>
                  <span class="badge-outline">{r.type}</span>
                </div>
              </div>
              <form method="post" action={`/dash/redirects/${r.id}/delete`}>
                <button type="submit" class="btn-sm-ghost text-destructive">
                  {i18n._(msg({ message: "Delete", comment: "@context: Button to delete redirect" }))}
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
    </DashLayout>
  );
});

// New redirect form
redirectsRoutes.get("/new", async (c) => {
  const i18n = getI18n(c);
  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";

  return c.html(
    <DashLayout c={c} title={i18n._(msg({ message: "New Redirect", comment: "@context: Page title" }))} siteName={siteName} currentPath="/dash/redirects">
      <h1 class="text-2xl font-semibold mb-6">{i18n._(msg({ message: "New Redirect", comment: "@context: Page heading" }))}</h1>

      <form method="post" action="/dash/redirects" class="flex flex-col gap-4 max-w-lg">
        <div class="field">
          <label class="label">{i18n._(msg({ message: "From Path", comment: "@context: Redirect form field" }))}</label>
          <input
            type="text"
            name="fromPath"
            class="input"
            placeholder="/old-path"
            required
          />
          <p class="text-xs text-muted-foreground mt-1">{i18n._(msg({ message: "The path to redirect from", comment: "@context: Redirect from path help text" }))}</p>
        </div>

        <div class="field">
          <label class="label">{i18n._(msg({ message: "To Path", comment: "@context: Redirect form field" }))}</label>
          <input
            type="text"
            name="toPath"
            class="input"
            placeholder="/new-path or https://..."
            required
          />
          <p class="text-xs text-muted-foreground mt-1">{i18n._(msg({ message: "The destination path or URL", comment: "@context: Redirect to path help text" }))}</p>
        </div>

        <div class="field">
          <label class="label">{i18n._(msg({ message: "Type", comment: "@context: Redirect form field" }))}</label>
          <select name="type" class="select">
            <option value="301">{i18n._(msg({ message: "301 (Permanent)", comment: "@context: Redirect type option" }))}</option>
            <option value="302">{i18n._(msg({ message: "302 (Temporary)", comment: "@context: Redirect type option" }))}</option>
          </select>
        </div>

        <div class="flex gap-2">
          <button type="submit" class="btn">
            {i18n._(msg({ message: "Create Redirect", comment: "@context: Button to save new redirect" }))}
          </button>
          <a href="/dash/redirects" class="btn-outline">
            {i18n._(msg({ message: "Cancel", comment: "@context: Button to cancel form" }))}
          </a>
        </div>
      </form>
    </DashLayout>
  );
});

// Create redirect
redirectsRoutes.post("/", async (c) => {
  const formData = await c.req.formData();

  const fromPath = formData.get("fromPath") as string;
  const toPath = formData.get("toPath") as string;
  const type = parseInt(formData.get("type") as string, 10) as 301 | 302;

  await c.var.services.redirects.create(fromPath, toPath, type);

  return c.redirect("/dash/redirects");
});

// Delete redirect
redirectsRoutes.post("/:id/delete", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (!isNaN(id)) {
    await c.var.services.redirects.delete(id);
  }
  return c.redirect("/dash/redirects");
});
