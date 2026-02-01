/**
 * Dashboard Index Route
 */

import { Hono } from "hono";
import { msg } from "@lingui/core/macro";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../app.js";
import { DashLayout } from "../../theme/layouts/index.js";
import { getI18n } from "../../i18n/index.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const dashIndexRoute = new Hono<Env>();

dashIndexRoute.get("/", async (c) => {
  const i18n = getI18n(c);
  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";

  // Get some stats
  const allPosts = await c.var.services.posts.list({ limit: 1000 });
  const publishedPosts = allPosts.filter((p) => p.visibility !== "draft");
  const draftPosts = allPosts.filter((p) => p.visibility === "draft");

  return c.html(
    <DashLayout c={c} title={i18n._(msg({ message: "Dashboard", comment: "@context: Dashboard page title" }))} siteName={siteName} currentPath="/dash">
      <h1 class="text-2xl font-semibold mb-6">
        {i18n._(msg({ message: "Dashboard", comment: "@context: Dashboard main heading" }))}
      </h1>

      <div class="grid gap-4 md:grid-cols-3">
        <div class="card">
          <header>
            <h2>{i18n._(msg({ message: "Published", comment: "@context: Dashboard stat card - published posts count" }))}</h2>
          </header>
          <section>
            <p class="text-3xl font-bold">{publishedPosts.length}</p>
          </section>
        </div>

        <div class="card">
          <header>
            <h2>{i18n._(msg({ message: "Drafts", comment: "@context: Dashboard stat card - draft posts count" }))}</h2>
          </header>
          <section>
            <p class="text-3xl font-bold">{draftPosts.length}</p>
          </section>
        </div>

        <div class="card">
          <header>
            <h2>{i18n._(msg({ message: "Quick Actions", comment: "@context: Dashboard stat card - quick actions section" }))}</h2>
          </header>
          <section>
            <a href="/dash/posts/new" class="btn w-full">
              {i18n._(msg({ message: "New Post", comment: "@context: Dashboard quick action button to create new post" }))}
            </a>
          </section>
        </div>
      </div>
    </DashLayout>
  );
});
