/**
 * Dashboard Redirects Routes
 */

import { Hono } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../app.js";
import { DashLayout } from "../../theme/layouts/index.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const redirectsRoutes = new Hono<Env>();

// List redirects
redirectsRoutes.get("/", async (c) => {
  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";
  const redirects = await c.var.services.redirects.list();

  return c.html(
    <DashLayout title="Redirects" siteName={siteName}>
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-semibold">Redirects</h1>
        <a href="/dash/redirects/new" class="btn">
          New Redirect
        </a>
      </div>

      {redirects.length === 0 ? (
        <p class="text-muted-foreground">No redirects configured.</p>
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
                  Delete
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
  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";

  return c.html(
    <DashLayout title="New Redirect" siteName={siteName}>
      <h1 class="text-2xl font-semibold mb-6">New Redirect</h1>

      <form method="post" action="/dash/redirects" class="flex flex-col gap-4 max-w-lg">
        <div class="field">
          <label class="label">From Path</label>
          <input
            type="text"
            name="fromPath"
            class="input"
            placeholder="/old-path"
            required
          />
          <p class="text-xs text-muted-foreground mt-1">The path to redirect from</p>
        </div>

        <div class="field">
          <label class="label">To Path</label>
          <input
            type="text"
            name="toPath"
            class="input"
            placeholder="/new-path or https://..."
            required
          />
          <p class="text-xs text-muted-foreground mt-1">The destination path or URL</p>
        </div>

        <div class="field">
          <label class="label">Type</label>
          <select name="type" class="select">
            <option value="301">301 (Permanent)</option>
            <option value="302">302 (Temporary)</option>
          </select>
        </div>

        <div class="flex gap-2">
          <button type="submit" class="btn">
            Create Redirect
          </button>
          <a href="/dash/redirects" class="btn-outline">
            Cancel
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
